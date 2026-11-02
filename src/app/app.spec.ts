import { vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { App } from './app';

describe('Flujo automático', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [App] }).compileComponents();
  });
  afterEach(() => vi.restoreAllMocks());
  const parsed = {
    tables: [
      {
        name: 'P',
        columns: [{ name: 'Id', type: 'INT', nullable: false }],
        primaryKey: ['Id'],
        foreignKeys: [],
        rules: [],
      },
    ],
    warnings: [],
    parser: 'SQLGlot',
  };
  it('normaliza automáticamente todas las etapas sin confirmaciones ni editor de dependencias', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(parsed)));
    const fixture = TestBed.createComponent(App),
      app = fixture.componentInstance;
    app.sql = 'CREATE TABLE P(Id INT PRIMARY KEY);';
    await app.run();
    fixture.detectChanges();
    expect(app.results[0].stages.map((s) => s.label)).toEqual(['1FN', '2FN', '3FN']);
    expect(fixture.nativeElement.textContent).toContain(
      'La transformación se calcula a partir de tu entrada',
    );
    expect(fixture.nativeElement.textContent).toContain('Declarar una dependencia del negocio');
  });
  it('conserva el resultado anterior si SQLGlot rechaza una nueva entrada', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(parsed)));
    const app = TestBed.createComponent(App).componentInstance;
    app.sql = 'sql';
    await app.run();
    fetch.mockResolvedValue(
      new Response(JSON.stringify({ error: 'SQL no soportado' }), { status: 422 }),
    );
    await app.run();
    expect(app.results.length).toBe(1);
    expect(app.error).toBe('SQL no soportado');
  });
  it('normaliza metadatos SQL Server directamente sin reinterpretar su esquema como SQL', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          ...parsed,
          tables: [{ ...parsed.tables[0], name: 'ventas.P', sqlName: ['ventas', 'P'] }],
        }),
      ),
    );
    const app = TestBed.createComponent(App).componentInstance;
    await app.connect();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(app.results[0].source.name).toBe('ventas.P');
    expect(app.results[0].stages.length).toBe(3);
  });
  it('descarta respuestas de análisis cancelados', async () => {
    let finish!: (response: Response) => void;
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const app = TestBed.createComponent(App).componentInstance;
    app.sql = 'sql';
    const pending = app.run();
    app.cancel();
    finish(new Response(JSON.stringify(parsed)));
    await pending;
    expect(app.results.length).toBe(0);
    expect(app.busy).toBe(false);
  });
  it('no duplica el error cuando aparece en el diagnóstico y en el ensamblado del proyecto', async () => {
    const data = structuredClone(parsed);
    Object.assign(data.tables[0], { issues: ['La muestra contradice la clave.'] });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(data)));
    const app = TestBed.createComponent(App).componentInstance;
    app.sql = 'CREATE TABLE P(Id INT PRIMARY KEY);';
    await app.run();
    expect(app.exportErrors).toEqual(['P: La muestra contradice la clave.']);
  });
});
