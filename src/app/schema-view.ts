import { Component, Input, OnChanges } from '@angular/core';
import { Table } from '../lib/models';
import { cardinality, exportSVG } from '../lib/exporters';

@Component({
  selector: 'schema-view',
  template: `
    @if (mode === 'diagram') {
      <div class="diagram-scroll" tabindex="0" aria-label="Diagrama desplazable">
        @if (tables.length) {
          <img
            [src]="diagram"
            [style.width]="fit ? zoom + '%' : (width * zoom) / 100 + 'px'"
            [style.max-width.px]="(width * zoom) / 100"
            alt="Diagrama de tablas con claves y cardinalidades"
          />
        } @else {
          <p class="empty">No hay estructuras disponibles en esta etapa.</p>
        }
      </div>
    } @else {
      <div class="entities">
        @for (table of tables; track table.name) {
          <article>
            <header>
              <strong>{{ table.name }}</strong
              ><span>{{ table.columns.length }} columnas</span>
            </header>
            <div class="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Clave</th>
                    <th>Columna</th>
                    <th>Tipo</th>
                    <th>NULL</th>
                  </tr>
                </thead>
                <tbody>
                  @for (c of table.columns; track c.name) {
                    <tr>
                      <td class="tags">{{ flags(table, c.name) }}</td>
                      <td>
                        <b>{{ c.name }}</b>
                        @if (c.identity) {
                          <small>{{ c.identity }}</small>
                        }
                        @if (c.default) {
                          <small>DEFAULT {{ c.default }}</small>
                        }
                        @if (c.expression) {
                          <small>AS {{ c.expression }}</small>
                        }
                      </td>
                      <td>
                        <code>{{ c.type }}</code>
                      </td>
                      <td>{{ c.nullable ? 'Sí' : 'No' }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
            @for (f of table.foreignKeys; track $index) {
              <p class="relation">
                <span>{{ f.columns.join(', ') }}</span> → <b>{{ f.table }}</b> ({{
                  f.references.join(', ')
                }})
                <small
                  >{{ cardinality(table, f).child }} → {{ cardinality(table, f).parent }}</small
                >
              </p>
            }
            @for (check of table.checks || []; track $index) {
              <p class="relation">CHECK {{ check.expression }}</p>
            }
          </article>
        } @empty {
          <p class="empty">No hay estructuras disponibles en esta etapa.</p>
        }
      </div>
    }
  `,
  styles: [
    `
      :host {
        display: block;
        min-width: 0;
      }
      .diagram-scroll {
        overflow: auto;
        min-height: 350px;
        max-height: 70vh;
        padding: 12px;
        background: #fafafa;
      }
      .diagram-scroll img {
        display: block;
        max-width: none;
      }
      .entities {
        display: grid;
        gap: 16px;
        padding: 16px;
      }
      article {
        border: 1px solid #d4d4d4;
        border-radius: 6px;
        overflow: hidden;
        background: #fff;
      }
      header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 10px;
        padding: 13px 14px;
        background: #f5f5f5;
        border-bottom: 1px solid #ddd;
        overflow-wrap: anywhere;
      }
      header span {
        white-space: nowrap;
        color: #737373;
        font-size: 11px;
      }
      .table-scroll {
        overflow: auto;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        text-align: left;
        font-size: 12px;
      }
      th,
      td {
        padding: 9px 12px;
        border-bottom: 1px solid #eee;
        vertical-align: top;
      }
      th {
        font-size: 10px;
        color: #737373;
        font-weight: 500;
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }
      td b {
        font-weight: 500;
      }
      small {
        display: block;
        font-size: 10px;
        color: #737373;
        overflow-wrap: anywhere;
        margin-top: 3px;
      }
      .tags {
        font-size: 10px;
        font-weight: 600;
        white-space: nowrap;
      }
      code {
        font-size: 10px;
        white-space: nowrap;
      }
      .relation {
        font-size: 11px;
        padding: 10px 14px;
        margin: 0;
        border-top: 1px solid #eee;
        overflow-wrap: anywhere;
        color: #525252;
      }
      .relation small {
        display: inline;
        margin-left: 5px;
      }
      .empty {
        padding: 24px;
        color: #737373;
        font-size: 13px;
      }
    `,
  ],
})
export class SchemaView implements OnChanges {
  @Input() tables: Table[] = [];
  @Input() mode: 'diagram' | 'tables' = 'diagram';
  @Input() zoom = 100;
  @Input() fit = true;
  diagram = '';
  width = 440;
  readonly cardinality = cardinality;
  private previous?: Table[];
  ngOnChanges() {
    if (this.previous === this.tables) return;
    this.previous = this.tables;
    const svg = exportSVG(this.tables);
    this.width = Number(svg.match(/width="([\d.]+)"/)?.[1] || 440);
    this.diagram = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }
  flags(t: Table, n: string) {
    return (
      [
        t.primaryKey.includes(n) ? 'PK' : '',
        t.foreignKeys.some((f) => f.columns.includes(n)) ? 'FK' : '',
        (t.uniqueKeys || []).some((k) => k.includes(n)) ? 'UQ' : '',
      ]
        .filter(Boolean)
        .join(' · ') || '—'
    );
  }
}
