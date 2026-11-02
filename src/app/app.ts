import { Component, ChangeDetectorRef, inject, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AnalysisService } from './services/analysis.service';
import { AutomaticResult, ParsedTable } from '../lib/automatic';
import { Table } from '../lib/models';
import { exportSQL, exportSVG, exportMermaid } from '../lib/exporters';
import { assembleProject, ProjectModel } from '../lib/project';
import { SchemaView } from './schema-view';

@Component({
  selector: 'app-root',
  imports: [FormsModule, SchemaView],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnDestroy {
  private readonly worker = inject(AnalysisService);
  private readonly cdr = inject(ChangeDetectorRef);
  private controller?: AbortController;
  private request = 0;
  sql = '';
  dialect = 'tsql';
  busy = false;
  progress = '';
  error = '';
  parser = '';
  warnings: string[] = [];
  results: AutomaticResult[] = [];
  selected = 0;
  stage = 2;
  fileName = '';
  inputMode: 'file' | 'text' | 'server' = 'file';
  view: 'diagram' | 'tables' = 'diagram';
  zoom = 100;
  filter = '';
  customConnection = false;
  includeData = true;
  connection = { server: '', port: 1433, database: '', user: '', password: '' };
  domainRules: Record<string, string> = {};
  rulesName = '';
  beforeTables: Table[] = [];
  afterTables: Table[] = [];
  project: ProjectModel = { tables: [], warnings: [], errors: [], completed: 0 };
  get current() {
    return this.results[this.selected];
  }
  get exportErrors() {
    return [
      ...new Set([
        ...this.results.flatMap((r) =>
          r.error
            ? [`${r.source.name}: ${r.error}`]
            : r.stages[this.stage]?.error
              ? [`${r.source.name}: ${r.stages[this.stage].error}`]
              : [],
        ),
        ...this.project.errors,
      ]),
    ];
  }
  get examinedRows() {
    return this.results.reduce((n, r) => n + (r.source.profile?.rowCount || 0), 0);
  }
  get relationCount() {
    return this.project.tables.reduce((n, t) => n + t.foreignKeys.length, 0);
  }
  get evidence() {
    if (this.results.some((r) => r.source.rules?.length)) return 'Reglas declaradas';
    if (this.results.some((r) => r.source.profile?.observedRules.length))
      return 'Dependencias observadas';
    return 'Claves del esquema';
  }
  refreshProject() {
    this.project = assembleProject(
      this.results.map((r) => r.source),
      new Map(this.results.map((r) => [r.source.name, r.stages[this.stage]?.tables || []])),
    );
    this.beforeTables = this.results
      .filter((r) => !this.filter || r.source.name === this.filter)
      .map((r) => r.source);
    const blocked = new Set(
      this.results.filter((r) => r.error || r.stages[this.stage]?.error).map((r) => r.source.name),
    );
    this.afterTables = this.project.tables.filter(
      (t) =>
        !blocked.has(t.origin || t.name) && (!this.filter || (t.origin || t.name) === this.filter),
    );
  }
  selectStage(stage: number) {
    this.stage = stage;
    this.refreshProject();
  }
  async upload(event: Event) {
    const input = event.target as HTMLInputElement,
      file = input.files?.[0];
    input.value = '';
    if (!file || this.busy) return;
    try {
      if (!/\.sql$/i.test(file.name)) throw Error('Selecciona un archivo .sql.');
      if (file.size > 50 * 1024 * 1024) throw Error('El límite es 50 MiB.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      this.sql = new TextDecoder(
        bytes[0] === 255 && bytes[1] === 254
          ? 'utf-16le'
          : bytes[0] === 254 && bytes[1] === 255
            ? 'utf-16be'
            : 'utf-8',
        { fatal: true },
      ).decode(bytes);
      this.fileName = file.name;
      await this.run();
    } catch (e) {
      this.error = (e as Error).message;
    } finally {
      this.cdr.markForCheck();
    }
  }
  async loadRules(event: Event) {
    const input = event.target as HTMLInputElement,
      file = input.files?.[0];
    input.value = '';
    if (!file || this.busy) return;
    try {
      if (file.size > 1024 * 1024) throw Error('Las reglas deben ocupar menos de 1 MiB.');
      const value = JSON.parse(await file.text());
      if (
        !value ||
        Array.isArray(value) ||
        typeof value !== 'object' ||
        Object.values(value).some((v) => typeof v !== 'string')
      )
        throw Error(
          'Usa un JSON con nombres de tabla y cadenas de dependencias: tabla → "A -> B".',
        );
      this.domainRules = value;
      this.rulesName = file.name;
      if (this.sql.trim() && this.inputMode !== 'server') await this.run();
    } catch (e) {
      this.error = (e as Error).message;
    } finally {
      this.cdr.markForCheck();
    }
  }
  async clearRules() {
    this.domainRules = {};
    this.rulesName = '';
    if (this.sql.trim() && this.inputMode !== 'server') await this.run();
  }
  async connect() {
    await this.run(true);
  }
  private async analyzeTables(tables: ParsedTable[], id = this.request) {
    const results: AutomaticResult[] = [];
    const unmatched = Object.keys(this.domainRules).filter(
      (name) => !tables.some((t) => t.name.toLowerCase() === name.toLowerCase()),
    );
    if (unmatched.length) throw Error('Reglas para tablas ausentes: ' + unmatched.join(', '));
    for (const source of tables) {
      if (id !== this.request) return;
      const table = structuredClone(source);
      this.progress = `Analizando ${table.name} · ${results.length + 1}/${tables.length}`;
      this.cdr.markForCheck();
      results.push((await this.worker.run({ type: 'automatic', table })) as AutomaticResult);
    }
    if (id !== this.request) return;
    this.results = results;
    this.selected = 0;
    this.filter = '';
    this.refreshProject();
  }
  async run(fromServer = false) {
    if (this.busy || (!fromServer && !this.sql.trim())) return;
    const id = ++this.request;
    this.busy = true;
    this.error = '';
    this.progress = fromServer ? 'Conectando y leyendo SQL Server…' : 'Leyendo el archivo SQL…';
    this.controller = new AbortController();
    try {
      const response = await fetch(fromServer ? '/api/sql-server' : '/api/analyze-sql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: this.controller.signal,
        body: JSON.stringify(
          fromServer
            ? {
                connection: this.customConnection ? this.connection : undefined,
                includeData: this.includeData,
                rules: this.domainRules,
              }
            : { sql: this.sql, dialect: this.dialect, rules: this.domainRules },
        ),
      });
      const data = await response.json();
      if (id !== this.request) return;
      if (!response.ok) throw Error(data.error || 'No se pudo completar la lectura.');
      if (!Array.isArray(data.tables) || !data.tables.length)
        throw Error('No hay tablas para analizar.');
      await this.analyzeTables(data.tables, id);
      if (id !== this.request) return;
      if (fromServer) {
        this.fileName = this.customConnection ? this.connection.database : 'SQL Server';
        this.connection.password = '';
      } else if (!this.fileName) this.fileName = 'SQL pegado';
      this.parser = data.parser;
      this.warnings = data.warnings || [];
    } catch (e) {
      if (id === this.request) this.error = (e as Error).message;
    } finally {
      if (id === this.request) {
        this.busy = false;
        this.cdr.markForCheck();
      }
    }
  }
  cancel() {
    ++this.request;
    this.controller?.abort();
    this.worker.cancel();
    this.busy = false;
    this.progress = '';
  }
  download(kind: 'sql' | 'svg' | 'mmd' | 'json', before = false) {
    if (!this.results.length || (!before && kind !== 'json' && this.exportErrors.length)) return;
    const tables = before ? this.results.map((r) => r.source) : this.project.tables;
    const content =
      kind === 'sql'
        ? exportSQL(tables)
        : kind === 'svg'
          ? exportSVG(tables)
          : kind === 'mmd'
            ? exportMermaid(tables)
            : JSON.stringify(
                {
                  parser: this.parser,
                  warnings: this.warnings,
                  results: this.results,
                  project: this.project,
                },
                null,
                2,
              );
    const url = URL.createObjectURL(
      new Blob([content], {
        type:
          kind === 'svg'
            ? 'image/svg+xml'
            : kind === 'json'
              ? 'application/json'
              : 'text/plain;charset=utf-8',
      }),
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${before ? 'original' : 'normalizacion-' + (this.stage + 1) + 'FN'}.${kind}`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  ngOnDestroy() {
    this.cancel();
  }
}
