import { vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { App } from './app';

describe('Mesa de trabajo', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [App] }).compileComponents();
  });
  const create = () => TestBed.createComponent(App);

  it('exige confirmar los prerrequisitos antes de emitir un resultado', async () => {
    const app = create().componentInstance;
    await app.loadSample();
    await app.run();
    expect(app.workspace?.results).toHaveLength(0);
    expect(app.error).toContain('Confirma');
  });
  it('importa, diagnostica y renderiza el ejemplo en 3FN', async () => {
    const fixture = create(),
      app = fixture.componentInstance;
    await app.loadSample();
    app.workspace!.atomic = true;
    app.workspace!.complete = true;
    await app.run();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(app.error).toBe('');
    expect(app.workspace?.report?.form).toBe('1FN');
    expect(app.workspace?.results.length).toBeGreaterThan(1);
    expect(fixture.nativeElement.querySelectorAll('.entity').length).toBe(
      app.workspace?.results.length,
    );
  });
  it('conserva las reglas, confirmaciones y resultados al cambiar de tabla', async () => {
    const app = create().componentInstance;
    app.sql =
      'CREATE TABLE A(Id INT PRIMARY KEY, Nombre VARCHAR(30)); CREATE TABLE B(Id INT PRIMARY KEY)';
    await app.importSQL();
    app.workspace!.rules = 'Id -> Nombre';
    app.workspace!.atomic = true;
    app.workspace!.complete = true;
    await app.run();
    const results = app.workspace!.results;
    app.choose('B');
    expect(app.workspace!.rules).toBe('');
    app.choose('A');
    expect(app.workspace!.rules).toBe('Id -> Nombre');
    expect(app.workspace!.results).toBe(results);
    expect(app.workspace!.complete).toBe(true);
  });
  it('invalida el resultado al modificar la clave de trabajo', async () => {
    const app = create().componentInstance;
    await app.loadSample();
    app.workspace!.atomic = true;
    app.workspace!.complete = true;
    await app.run();
    app.setKey(['PedidoId']);
    expect(app.workspace!.report).toBeNull();
    expect(app.workspace!.results).toHaveLength(0);
    expect(app.workspace!.complete).toBe(false);
  });
  it('conserva el esquema anterior cuando falla una nueva importación', async () => {
    const app = create().componentInstance;
    await app.loadSample();
    app.sql = 'CREATE TABLE Rota (Id INT';
    await app.importSQL();
    expect(app.tables[0].name).toBe('DetallePedido');
    expect(app.error).not.toBe('');
  });
  it('muestra errores asíncronos de SQL Server sin borrar el trabajo', async () => {
    const fixture = create(),
      app = fixture.componentInstance;
    await app.loadSample();
    fixture.detectChanges();
    const mock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ error: 'Configura DB_SERVER' }), { status: 503 }),
      );
    try {
      await app.connect();
      await fixture.whenStable();
      expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent).toContain(
        'Configura DB_SERVER',
      );
      expect(app.tables).toHaveLength(1);
    } finally {
      mock.mockRestore();
    }
  });
  it('cancela una solicitud y descarta su respuesta tardía', async () => {
    const app = create().componentInstance;
    let respond!: (response: Response) => void;
    const mock = vi.spyOn(globalThis, 'fetch').mockImplementation(
      () =>
        new Promise((resolve) => {
          respond = resolve;
        }),
    );
    try {
      const pending = app.connect();
      app.cancel();
      respond(new Response(JSON.stringify([])));
      await pending;
      expect(app.busy).toBe(false);
      expect(app.tables).toHaveLength(0);
      expect(app.error).toBe('');
    } finally {
      mock.mockRestore();
    }
  });
});
