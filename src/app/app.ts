import { assembleProject } from '../lib/project';
import { ChangeDetectorRef, Component, inject, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  ImportResult,
  Table,
  MAX_FILE_BYTES,
  exportSQL,
  exportMermaid,
  exportSVG,
  analyze,
} from '../lib/normalization';
import { AnalysisService } from './services/analysis.service';
import { BASIC_RULES, BASIC_SQL } from './samples';

type Target = '1FN' | '2FN' | '3FN';
interface TableWorkspace {
  rules: string;
  atomic: boolean;
  complete: boolean;
  target: Target;
  group: string[];
  report: ReturnType<typeof analyze> | null;
  results: Table[];
}
const emptyWorkspace = (): TableWorkspace => ({
  rules: '',
  atomic: false,
  complete: false,
  target: '3FN',
  group: [],
  report: null,
  results: [],
});

@Component({
  selector: 'app-root',
  imports: [FormsModule],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnDestroy {
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly analysis = inject(AnalysisService);
  private request = 0;
  private controller?: AbortController;
  private workspaces = new Map<string, TableWorkspace>();
  sql = '';
  tables: Table[] = [];
  selected = '';
  search = '';
  section: 'import' | 'work' | 'result' | 'project' = 'import';
  importResult: ImportResult | null = null;
  error = '';
  notice = '';
  busy = false;
  busyLabel = '';
  fileName = '';
  fileSize = 0;
  dragged = false;
  determinant: string[] = [];
  consequent: string[] = [];
  diagramUrl = '';
  zoom = 100;
  showSource = false;
  get table() {
    return this.tables.find((t) => t.name === this.selected);
  }
  get workspace() {
    return this.workspaces.get(this.selected);
  }
  get filteredTables() {
    return this.tables.filter((t) => t.name.toLowerCase().includes(this.search.toLowerCase()));
  }
  get totalColumns() {
    return this.tables.reduce((sum, t) => sum + t.columns.length, 0);
  }
  get completed() {
    return [...this.workspaces.values()].filter((w) => w.results.length).length;
  }
  get sizeLabel() {
    return this.fileSize ? `${(this.fileSize / 1024 / 1024).toFixed(2)} MiB` : '';
  }
  get hasImportErrors() {
    return !!this.importResult?.diagnostics.some((d) => d.level === 'error');
  }

  get project() {
    return assembleProject(
      this.tables,
      new Map([...this.workspaces].map(([name, workspace]) => [name, workspace.results])),
    );
  }
  get projectDiagram() {
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(exportSVG(this.project.tables));
  }
  downloadProject(kind: 'sql' | 'svg' | 'mmd' | 'json') {
    const project = this.project;
    if (!project.tables.length) return;
    if (kind !== 'json' && project.errors.length) {
      this.error =
        'Resuelve las referencias del proyecto antes de exportar. Puedes descargar el informe JSON para revisarlas.';
      return;
    }
    const content =
      kind === 'sql'
        ? exportSQL(project.tables)
        : kind === 'svg'
          ? exportSVG(project.tables)
          : kind === 'mmd'
            ? exportMermaid(project.tables)
            : JSON.stringify(
                {
                  ...project,
                  analyses: this.tables.map((table) => ({
                    table: table.name,
                    ...this.workspaces.get(table.name),
                  })),
                  limitations: [
                    'Estructuras vacías; no migra datos.',
                    'Las tablas pendientes conservan su estructura original.',
                    'Diagnóstico relativo a las reglas y atomicidad confirmadas.',
                  ],
                },
                null,
                2,
              );
    this.save(content, `proyecto-normalizacion.${kind}`);
  }

  choose(name: string) {
    this.selected = name;
    this.determinant = [];
    this.consequent = [];
    this.error = '';
    this.updateDiagram();
  }
  private acceptImport(result: ImportResult) {
    this.tables = result.tables;
    this.importResult = result;
    this.workspaces = new Map(this.tables.map((t) => [t.name, emptyWorkspace()]));
    this.search = '';
    this.choose(this.tables[0].name);
    this.section = 'work';
    this.notice = `${this.tables.length} tablas importadas. Las sentencias de datos no se ejecutan. Revisa las advertencias antes de analizar.`;
  }
  async importSQL(file?: File) {
    if (this.busy) return;
    const id = ++this.request;
    this.begin('Leyendo el esquema SQL…');
    try {
      const result = (await this.analysis.run(
        file ? { type: 'import', file } : { type: 'import', sql: this.sql },
      )) as ImportResult;
      if (id !== this.request) return;
      this.acceptImport(result);
      this.fileName = file?.name || 'SQL pegado';
      this.fileSize = file?.size || new Blob([this.sql]).size;
      // No introducimos archivos enormes en un textarea ni guardamos los INSERT.
      if (file) {
        this.sql = '';
        this.showSource = false;
      }
    } catch (error) {
      if (id === this.request) this.error = (error as Error).message;
    } finally {
      if (id === this.request) {
        this.busy = false;
        this.cdr.markForCheck();
      }
    }
  }
  async upload(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) await this.readFile(file);
    input.value = '';
  }
  async drop(event: DragEvent) {
    event.preventDefault();
    this.dragged = false;
    const file = event.dataTransfer?.files[0];
    if (file) await this.readFile(file);
  }
  private async readFile(file: File) {
    if (file.size > MAX_FILE_BYTES) {
      this.error =
        'El límite es de 50 MiB por archivo. Divide los datos en otro script si supera ese tamaño.';
      return;
    }
    if (!/\.sql$/i.test(file.name)) {
      this.error = 'Selecciona un archivo con extensión .sql.';
      return;
    }
    await this.importSQL(file);
  }
  async loadSample(large = false) {
    if (this.busy) return;
    if (!large) {
      this.sql = BASIC_SQL;
      await this.importSQL();
      if (this.workspace && !this.error) this.workspace.rules = BASIC_RULES;
      return;
    }
    const id = ++this.request;
    this.begin('Cargando el caso universitario…');
    this.controller = new AbortController();
    try {
      const [source, rules] = await Promise.all([
        fetch('examples/caso-universidad.sql', { signal: this.controller.signal }),
        fetch('examples/caso-universidad.reglas.json', { signal: this.controller.signal }),
      ]);
      if (!source.ok || !rules.ok)
        throw Error('No se pudo cargar el ejemplo. Puedes abrirlo desde la carpeta examples.');
      const result = (await this.analysis.run({
        type: 'import',
        sql: await source.text(),
      })) as ImportResult;
      const suggestions = (await rules.json()) as Record<string, string>;
      if (id !== this.request) return;
      this.acceptImport(result);
      this.fileName = 'caso-universidad.sql';
      this.fileSize = 0;
      for (const [name, text] of Object.entries(suggestions))
        if (this.workspaces.has(name)) this.workspaces.get(name)!.rules = text;
      this.choose('dbo.InscripcionesExtendidas');
      this.notice =
        'Caso universitario: 12 tablas y una relación de 34 columnas. Las reglas del ejemplo están cargadas; revísalas antes de confirmarlas.';
    } catch (error) {
      if (id === this.request) this.error = (error as Error).message;
    } finally {
      if (id === this.request) {
        this.busy = false;
        this.cdr.markForCheck();
      }
    }
  }
  async connect() {
    if (this.busy) return;
    const id = ++this.request;
    this.begin('Consultando metadatos de SQL Server…');
    this.controller = new AbortController();
    try {
      const response = await fetch('/api/schema', { signal: this.controller.signal });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || 'No se pudieron importar los metadatos.');
      if (!Array.isArray(data) || !data.length)
        throw Error('No hay tablas visibles en la base de datos.');
      // El mismo lector valida los metadatos de ambas fuentes.
      const result = (await this.analysis.run({
        type: 'import',
        sql: exportSQL(data),
      })) as ImportResult;
      for (const table of result.tables) {
        const source = data.find((item: Table) => item.name === table.name);
        if (source?.issues?.length) table.issues = [...(table.issues || []), ...source.issues];
      }
      if (id !== this.request) return;
      this.acceptImport(result);
      this.fileName = 'SQL Server';
      this.fileSize = 0;
    } catch (error) {
      if (id === this.request) this.error = (error as Error).message;
    } finally {
      if (id === this.request) {
        this.busy = false;
        this.cdr.markForCheck();
      }
    }
  }
  invalidate() {
    const workspace = this.workspace;
    if (workspace) {
      workspace.report = null;
      workspace.results = [];
    }
    this.diagramUrl = '';
    this.error = '';
  }
  setKey(columns: string[]) {
    if (!this.table) return;
    this.table.primaryKey = columns;
    for (const column of this.table.columns)
      if (columns.includes(column.name)) column.nullable = false;
    this.invalidate();
    if (this.workspace) {
      this.workspace.atomic = false;
      this.workspace.complete = false;
    }
  }
  addRule() {
    if (!this.workspace || !this.determinant.length || !this.consequent.length) return;
    this.workspace.rules += `${this.workspace.rules.trim() ? '\n' : ''}${this.determinant.map((name) => '[' + name.replace(/]/g, ']]') + ']').join(', ')} -> ${this.consequent.map((name) => '[' + name.replace(/]/g, ']]') + ']').join(', ')}`;
    this.consequent = [];
    this.invalidate();
    this.workspace.complete = false;
  }
  async run() {
    const table = this.table,
      workspace = this.workspace;
    if (!table || !workspace || this.busy) return;
    this.error = '';
    if (!workspace.atomic || (workspace.target !== '1FN' && !workspace.complete)) {
      this.error = 'Confirma la atomicidad y las reglas del negocio antes de normalizar.';
      return;
    }
    if (!table.primaryKey.length) {
      this.error =
        'Selecciona una clave primaria de trabajo. Es una decisión del modelo, no una clave inferida por nombre.';
      return;
    }
    const id = ++this.request;
    this.begin('Calculando claves y descomposición…');
    workspace.report = null;
    workspace.results = [];
    try {
      const result = (await this.analysis.run({
        type: 'normalize',
        table,
        rules: workspace.rules,
        target: workspace.target,
        group: workspace.group,
      })) as { report: ReturnType<typeof analyze> | null; results: Table[] };
      if (id !== this.request) return;
      Object.assign(workspace, result);
      this.updateDiagram();
      this.section = 'result';
      this.notice =
        workspace.target === '1FN'
          ? 'Grupo extraído: cada valor se cargará en una fila de la relación hija. No se han migrado datos.'
          : 'Modelo calculado bajo las dependencias confirmadas. Solo se exporta la tabla de trabajo descompuesta; revisa las relaciones externas.';
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
    this.analysis.cancel();
    this.controller?.abort();
    this.busy = false;
    this.notice = 'Operación cancelada. Se conserva el trabajo anterior.';
  }
  private begin(label: string) {
    this.error = '';
    this.notice = '';
    this.busy = true;
    this.busyLabel = label;
  }
  private updateDiagram() {
    this.diagramUrl = this.workspace?.results.length
      ? 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(exportSVG(this.workspace.results))
      : '';
    this.zoom = 100;
  }
  download(kind: 'sql' | 'mmd' | 'json' | 'svg') {
    const tables = this.workspace?.results;
    if (!tables?.length) return;
    const content =
      kind === 'sql'
        ? exportSQL(tables)
        : kind === 'mmd'
          ? exportMermaid(tables)
          : kind === 'svg'
            ? exportSVG(tables)
            : JSON.stringify(tables, null, 2);
    this.save(
      content,
      `${this.selected.replace(/[^\p{L}\p{N}_-]/gu, '_')}-${this.workspace!.target}.${kind}`,
    );
  }
  downloadReport() {
    if (!this.workspace || !this.table) return;
    this.save(
      JSON.stringify(
        {
          table: this.table.name,
          target: this.workspace.target,
          dependencies: this.workspace.rules,
          atomicityConfirmed: this.workspace.atomic,
          dependenciesConfirmed: this.workspace.complete,
          diagnosis: this.workspace.report,
          relations: this.workspace.results,
          limitations: [
            'No migra datos.',
            'No traslada automáticamente restricciones ni referencias externas.',
          ],
        },
        null,
        2,
      ),
      'informe-normalizacion.json',
    );
  }
  downloadRules() {
    this.save(
      JSON.stringify(
        Object.fromEntries([...this.workspaces].map(([name, w]) => [name, w.rules])),
        null,
        2,
      ),
      'dependencias.json',
    );
  }
  async uploadRules(event: Event) {
    const input = event.target as HTMLInputElement,
      file = input.files?.[0];
    if (!file) return;
    try {
      if (file.size > 1_000_000) throw Error('El archivo de reglas debe ser menor de 1 MB.');
      const data: unknown = JSON.parse(await file.text());
      if (!data || typeof data !== 'object' || Array.isArray(data))
        throw Error('Usa un objeto JSON con nombre de tabla y texto de reglas.');
      const entries = Object.entries(data);
      if (entries.some(([name, value]) => !this.workspaces.has(name) || typeof value !== 'string'))
        throw Error(
          'Hay tablas desconocidas o reglas que no son texto. No se aplicó ningún cambio.',
        );
      for (const [name, value] of entries) {
        const w = this.workspaces.get(name)!;
        w.rules = value as string;
        w.complete = false;
        w.report = null;
        w.results = [];
      }
      this.updateDiagram();
      this.notice = 'Reglas importadas. Revisa y confirma su significado antes de normalizar.';
    } catch (error) {
      this.error = (error as Error).message;
    } finally {
      input.value = '';
      this.cdr.markForCheck();
    }
  }
  private save(content: string, name: string) {
    const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  status(name: string) {
    const w = this.workspaces.get(name);
    return w?.results.length ? w.target : 'Pendiente';
  }
  relations() {
    return (
      this.workspace?.results.flatMap((t) =>
        t.foreignKeys.map(
          (f) => `${t.name} (${f.columns.join(', ')}) → ${f.table} (${f.references.join(', ')})`,
        ),
      ) || []
    );
  }
  ngOnDestroy() {
    this.analysis.cancel();
    this.controller?.abort();
  }
}
