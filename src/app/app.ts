import { Component, ChangeDetectorRef, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Table, FD, parseSQL, parseDependencies, dependencies, analyze, normalize, exportSQL, exportMermaid, firstNormalForm, exportSVG } from '../lib/normalization';
const SAMPLE = `CREATE TABLE DetallePedido (
  PedidoId INT NOT NULL,
  ProductoId INT NOT NULL,
  ClienteId INT NOT NULL,
  ClienteNombre NVARCHAR(100) NOT NULL,
  ProductoNombre NVARCHAR(100) NOT NULL,
  Cantidad INT NOT NULL,
  PRIMARY KEY (PedidoId, ProductoId)
);`;
@Component({ selector: 'app-root', imports: [FormsModule], templateUrl: './app.html', styleUrl: './app.css' })
export class App {
  private readonly cdr = inject(ChangeDetectorRef);
  sql = ''; tables: Table[] = []; selected = 0; fdText: Record<string,string> = {}; atomic = false; complete = false;
  error = ''; notice = ''; busy = false; group = ''; target: '1FN' | '2FN' | '3FN' = '3FN'; results: Table[] = [];
  report: ReturnType<typeof analyze> | null = null;
  get table() { return this.tables[this.selected]; }
  get rules() { return this.table ? this.fdText[this.table.name] || '' : ''; }
  set rules(value: string) { if (this.table) this.fdText[this.table.name] = value; this.invalidate(); }
  invalidate() { this.report = null; this.results = []; this.error = ''; }
  choose(index: number) { this.selected = index; this.atomic = false; this.complete = false; this.group = ''; this.invalidate(); }
  loadSample() { this.sql = SAMPLE; this.importSQL(); this.fdText['DetallePedido'] = 'PedidoId -> ClienteId\nClienteId -> ClienteNombre\nProductoId -> ProductoNombre'; this.notice = 'Ejemplo cargado. Revisa las reglas y confirma los prerrequisitos.'; }
  importSQL() { try { const tables = parseSQL(this.sql); this.tables = tables; this.fdText = {}; this.choose(0); this.notice = `${tables.length} tabla(s) importada(s). El archivo se analizó localmente; no se ejecutó.`; } catch (e) { this.error = (e as Error).message; } }
  async upload(event: Event) { const file = (event.target as HTMLInputElement).files?.[0]; if (!file) return; if (file.size > 1_000_000) { this.error = 'Máximo 1 MB por archivo SQL.'; return; } try { this.sql = await file.text(); this.importSQL(); } catch { this.error = 'No se pudo leer el archivo.'; } finally { this.cdr.markForCheck(); } }
  async connect() {
    this.busy = true; this.error = '';
    try { const r = await fetch('/api/schema'); const data = await r.json(); if (!r.ok) throw Error(data.error); if (!Array.isArray(data) || !data.length) throw Error('La base de datos no contiene tablas visibles.'); if (data.some((t: Table) => t.columns.length > 12)) throw Error('El análisis admite como máximo 12 columnas por tabla. Usa un archivo SQL con una selección más pequeña.'); this.tables = data; this.fdText = {}; this.choose(0); this.notice = 'Metadatos importados de SQL Server. No se han leído ni modificado los datos.'; } catch(e) { this.error = (e as Error).message; } finally { this.busy = false; this.cdr.markForCheck(); }
  }
  run() {
    this.error = ''; this.results = []; this.report = null;
    try {
      if (!this.table) throw Error('Importa al menos una tabla.');
      if (this.target === '1FN') {
        if (!this.atomic) throw Error('Confirma que los demás valores son atómicos.');
        this.results = firstNormalForm(this.table, this.group.split(',').map(s => s.trim()).filter(Boolean));
        this.notice = 'Grupo extraído a una relación hija. Cada valor debe ocupar una fila con su posición; el script crea solo el esquema. Los datos y las dependencias deben revisarse antes de avanzar a 2FN.'; return;
      }
      if (!this.atomic || !this.complete) throw Error('Confirma la atomicidad y las dependencias antes de continuar. No se pueden inferir solo del DDL.');
      if (!this.table.primaryKey.length) throw Error('Declara una PRIMARY KEY en el SQL de entrada.');
      const fds: FD[] = dependencies(this.table, parseDependencies(this.rules, this.table));
      this.report = analyze(this.table, fds, this.atomic);
      this.results = normalize(this.table, fds, this.target);
      this.notice = `Síntesis ${this.target} calculada para ${this.table.name}. Se exporta solo esta tabla descompuesta; no se migran datos ni se conservan automáticamente restricciones externas.`;
    } catch(e) { this.error = (e as Error).message; }
  }
  download(kind: 'sql' | 'mmd' | 'json' | 'svg') {
    if (!this.results.length) return;
    const data = kind === 'sql' ? exportSQL(this.results) : kind === 'mmd' ? exportMermaid(this.results) : kind === 'svg' ? exportSVG(this.results) : JSON.stringify(this.results, null, 2);
    const url = URL.createObjectURL(new Blob([data], {type:'text/plain;charset=utf-8'})); const a = document.createElement('a'); a.href = url; a.download = `normalizacion-${this.target}.${kind}`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  get diagramUrl() { return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(exportSVG(this.results)); }
  relations() { return this.results.flatMap(t => t.foreignKeys.map(f => `${t.name} (${f.columns.join(', ')}) → ${f.table} (${f.references.join(', ')})`)); }
}
