import express from 'express';
import { parseWithSqlGlot } from './sqlglot';
import { isConfigured, readSchema } from './sql-server';

/** Inyectar el lector permite probar la API sin una base de datos real. */
export function createApp(configured = isConfigured, loadSchema = readSchema) {
  const app = express();
  let reading = false;
  app.disable('x-powered-by');
  app.use(express.json({ limit: '52mb' }));
  let analyzing = false;
  app.post('/api/analyze-sql', async (request, response) => {
    if (typeof request.body?.sql !== 'string' || !request.body.sql.trim()) {
      response.status(400).json({ error: 'Envía un script SQL en el campo sql.' });
      return;
    }
    if (analyzing) {
      response.status(429).json({ error: 'Hay otro análisis en curso.' });
      return;
    }
    analyzing = true;
    try {
      response.json(await parseWithSqlGlot(request.body.sql));
    } catch (error) {
      response.status(422).json({ error: (error as Error).message });
    } finally {
      analyzing = false;
    }
  });
  app.get('/api/health', (_request, response) =>
    response.json({ status: 'ok', sqlServerConfigured: configured() }),
  );
  app.get('/api/schema', async (_request, response) => {
    if (!configured()) {
      response.status(503).json({
        error:
          'Configura DB_SERVER, DB_DATABASE, DB_USER y DB_PASSWORD en el servidor. No introduzcas credenciales en el navegador.',
      });
      return;
    }
    if (reading) {
      response
        .status(429)
        .json({ error: 'Ya hay una consulta de metadatos en curso. Espera a que termine.' });
      return;
    }
    reading = true;
    try {
      response.json(await loadSchema());
    } catch {
      response.status(502).json({
        error:
          'No se pudo consultar SQL Server. Revisa conectividad, permisos VIEW DEFINITION y el certificado TLS del servidor.',
      });
    } finally {
      reading = false;
    }
  });
  return app;
}
