import { vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { App } from './app';
describe('Flujo de normalización', () => {
  beforeEach(async () => { await TestBed.configureTestingModule({ imports: [App] }).compileComponents(); });
  it('exige prerrequisitos antes de sintetizar', () => {
    const app = TestBed.createComponent(App).componentInstance;
    app.loadSample(); app.run();
    expect(app.results).toHaveLength(0); expect(app.error).toContain('Confirma');
  });
  it('importa, diagnostica y renderiza el ejemplo en 3FN', async () => {
    const fixture = TestBed.createComponent(App); const app = fixture.componentInstance;
    app.loadSample(); app.atomic = true; app.complete = true; app.run();
    await fixture.whenStable(); fixture.detectChanges();
    expect(app.error).toBe(''); expect(app.report?.form).toBe('1FN');
    expect(app.results.length).toBeGreaterThan(1);
    expect(fixture.nativeElement.querySelectorAll('.entity').length).toBe(app.results.length);
  });
  it('invalida resultados al cambiar las reglas', () => {
    const app = TestBed.createComponent(App).componentInstance;
    app.loadSample(); app.atomic = true; app.complete = true; app.run(); app.rules = 'ClienteId -> ClienteNombre';
    expect(app.report).toBeNull(); expect(app.results).toHaveLength(0);
  });
});

describe('Operaciones asíncronas', () => {
  it('muestra el error de SQL Server tras finalizar la petición', async () => {
    await TestBed.configureTestingModule({imports:[App]}).compileComponents();
    const fixture = TestBed.createComponent(App); fixture.detectChanges();
    const mock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({error:'Configura DB_SERVER'}),{status:503}));
    try { await fixture.componentInstance.connect(); await fixture.whenStable(); expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent).toContain('Configura DB_SERVER'); } finally { mock.mockRestore(); }
  });
});
