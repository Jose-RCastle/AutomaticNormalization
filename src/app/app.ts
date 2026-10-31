import { Component, ChangeDetectorRef, inject, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AnalysisService } from './services/analysis.service';
import { AutomaticResult, ParsedTable } from '../lib/automatic';
import { exportSQL, exportSVG, exportMermaid } from '../lib/exporters';
import { assembleProject } from '../lib/project';

@Component({
  selector: 'app-root',
  imports: [FormsModule],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnDestroy {
  private readonly worker = inject(AnalysisService);
  private readonly cdr = inject(ChangeDetectorRef);
  private controller?: AbortController;
  private request = 0;
  sql = '';
  busy = false;
  progress = '';
  error = '';
  parser = '';
  warnings: string[] = [];
  results: AutomaticResult[] = [];
  selected = 0;
  stage = 2;
  fileName = '';
  get current(): AutomaticResult | undefined {
    return this.results[this.selected];
  }
  get project() {
    return assembleProject(
      this.results.map((r) => r.source),
      new Map(this.results.map((r) => [r.source.name, r.stages[this.stage]?.tables || []])),
    );
  }
  get exportErrors() {
    return [
      ...this.results.flatMap((r) => (r.error ? [`${r.source.name}: ${r.error}`] : [])),
      ...this.project.errors,
    ];
  }
  get diagram() {
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(exportSVG(this.project.tables));
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
    } catch (error) {
      this.error = (error as Error).message;
    } finally {
      this.cdr.markForCheck();
    }
  }
  async example() {
    if (this.busy) return;
    try {
      const response = await fetch('examples/parcelas.sql');
      if (!response.ok) throw Error('No se pudo cargar el ejemplo.');
      this.sql = await response.text();
      this.fileName = 'parcelas.sql';
      await this.run();
    } catch (error) {
      this.error = (error as Error).message;
      this.cdr.markForCheck();
    }
  }
  async connect() {
    await this.run(true);
  }
  async run(fromServer = false) {
    if (this.busy || (!fromServer && !this.sql.trim())) return;
    const id = ++this.request;
    this.busy = true;
    this.error = '';
    this.progress = fromServer
      ? 'Leyendo metadatos de SQL Server…'
      : 'Interpretando SQL con SQLGlot…';
    this.controller = new AbortController();
    try {
      const response = await fetch(
        fromServer ? '/api/schema' : '/api/analyze-sql',
        fromServer
          ? { signal: this.controller.signal }
          : {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sql: this.sql }),
              signal: this.controller.signal,
            },
      );
      const payload = await response.json();
      const data =
        fromServer && response.ok
          ? { tables: payload, warnings: [], parser: 'Catálogo SQL Server' }
          : payload;
      if (response.ok && (!Array.isArray(data.tables) || !data.tables.length))
        throw Error('No hay tablas visibles.');
      if (!response.ok) throw Error(data.error || 'No se pudo interpretar el SQL.');
      const results: AutomaticResult[] = [];
      for (const table of data.tables as ParsedTable[]) {
        if (id !== this.request) return;
        this.progress = `Normalizando ${table.name} (${results.length + 1}/${data.tables.length})…`;
        this.cdr.markForCheck();
        results.push((await this.worker.run({ type: 'automatic', table })) as AutomaticResult);
      }
      if (id !== this.request) return;
      if (fromServer) this.fileName = 'Metadatos SQL Server';
      this.results = results;
      this.selected = 0;
      this.stage = 2;
      this.parser = data.parser;
      this.warnings = data.warnings;
    } catch (error) {
      if (id === this.request) this.error = (error as Error).message;
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
  download(kind: 'sql' | 'svg' | 'mmd' | 'json') {
    if (!this.results.length || (kind !== 'json' && this.exportErrors.length)) return;
    const content =
      kind === 'sql'
        ? exportSQL(this.project.tables)
        : kind === 'svg'
          ? exportSVG(this.project.tables)
          : kind === 'mmd'
            ? exportMermaid(this.project.tables)
            : JSON.stringify(
                {
                  parser: this.parser,
                  results: this.results,
                  project: this.project,
                  limitations: [
                    'Propuesta bajo las reglas disponibles, no certificación semántica.',
                    'No migra filas, defaults, índices, triggers ni todas las restricciones del original.',
                  ],
                },
                null,
                2,
              );
    const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `normalizacion-${this.stage + 1}FN.${kind}`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  ngOnDestroy() {
    this.cancel();
  }
}
