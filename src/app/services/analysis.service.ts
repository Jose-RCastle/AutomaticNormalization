import { Injectable } from '@angular/core';
import { executeJob, Job } from '../../lib/jobs';

@Injectable({ providedIn: 'root' })
export class AnalysisService {
  private worker?: Worker;
  private reject?: (error: Error) => void;
  private timer?: ReturnType<typeof setTimeout>;

  run(job: Job): ReturnType<typeof executeJob> {
    this.cancel();
    // La alternativa permite pruebas unitarias sin APIs de navegador.
    if (typeof Worker === 'undefined') return executeJob(job);
    return new Promise((resolve, reject) => {
      this.reject = reject;
      this.worker = new Worker(new URL('./analysis.worker', import.meta.url), { type: 'module' });
      const finish = () => {
        this.worker?.terminate();
        this.worker = undefined;
        this.reject = undefined;
        clearTimeout(this.timer);
      };
      this.worker.onmessage = ({ data }) => {
        finish();
        data.ok ? resolve(data.result) : reject(Error(data.error));
      };
      this.worker.onerror = () => {
        finish();
        reject(Error('No se pudo completar el análisis. Revisa el archivo y vuelve a intentar.'));
      };
      this.timer = setTimeout(() => {
        finish();
        reject(
          Error(
            'El análisis excedió 60 segundos. Divide el archivo o simplifica las reglas. No se generaron resultados parciales.',
          ),
        );
      }, 60_000);
      this.worker.postMessage(job);
    });
  }
  cancel() {
    this.worker?.terminate();
    this.worker = undefined;
    clearTimeout(this.timer);
    this.reject?.(Error('Operación cancelada.'));
    this.reject = undefined;
  }
}
