import express from 'express';
import { parseWithSqlGlot } from './sqlglot';
import { ConnectionInput, isConfigured, readSchema } from './sql-server';

/** Inyectar el lector permite probar la API sin una base de datos real. */
export function createApp(configured = isConfigured, loadSchema = readSchema) {
  const app = express();
  let reading = false;
  app.disable('x-powered-by');
  app.use(express.json({ limit: '64mb' }));
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
    const controller = new AbortController();
    response.on('close', () => {
      if (!response.writableEnded) controller.abort();
    });
    try {
      if (Buffer.byteLength(request.body.sql, 'utf8') > 50 * 1024 * 1024)
        throw Error('El límite del SQL es 50 MiB.');
      response.json(
        await parseWithSqlGlot(
          request.body.sql,
          request.body.dialect || 'tsql',
          controller.signal,
          request.body.rules,
        ),
      );
    } catch (error) {
      response.status(422).json({ error: (error as Error).message.replace(/\x1b\[[0-9;]*m/g, '') });
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
      response.json(await loadSchema(undefined, false));
    } catch {
      response.status(502).json({
        error:
          'No se pudo consultar SQL Server. Revisa conectividad, permisos VIEW DEFINITION y el certificado TLS del servidor.',
      });
    } finally {
      reading = false;
    }
  });
  app.post('/api/sql-server', async (request, response) => {
    let connection: ConnectionInput | undefined;
    if (request.body?.connection) {
      const input = request.body.connection;
      if (
        !['server', 'database', 'user', 'password'].every(
          (k) => typeof input[k] === 'string' && input[k].length > 0 && input[k].length < 1024,
        ) ||
        !Number.isInteger(Number(input.port || 1433)) ||
        Number(input.port || 1433) < 1 ||
        Number(input.port || 1433) > 65535
      ) {
        response
          .status(400)
          .json({ error: 'Completa servidor, base, usuario, contraseña y un puerto válido.' });
        return;
      }
      connection = {
        server: input.server,
        database: input.database,
        user: input.user,
        password: input.password,
        port: Number(input.port || 1433),
        auth: input.auth === 'ntlm' ? 'ntlm' : 'sql',
        domain: typeof input.domain === 'string' ? input.domain : undefined,
      };
      if (connection.auth === 'ntlm' && !connection.domain?.trim()) {
        response.status(400).json({
          error: 'La autenticación Windows NTLM necesita el dominio, usuario y contraseña.',
        });
        return;
      }
    } else if (!configured()) {
      response
        .status(503)
        .json({ error: 'Completa la conexión o prepara el servidor local con npm run db:local.' });
      return;
    }
    if (reading) {
      response.status(429).json({ error: 'Ya hay una lectura de SQL Server en curso.' });
      return;
    }
    reading = true;
    const controller = new AbortController();
    response.on('close', () => {
      if (!response.writableEnded) controller.abort();
    });
    try {
      const rules = request.body.rules;
      if (
        rules &&
        (Array.isArray(rules) ||
          typeof rules !== 'object' ||
          Object.values(rules).some((v) => typeof v !== 'string'))
      ) {
        response
          .status(400)
          .json({ error: 'El JSON de reglas debe asociar tablas con cadenas de dependencias.' });
        return;
      }
      const tables = await loadSchema(
        connection,
        request.body.includeData !== false,
        controller.signal,
        rules,
      );
      response.json({ tables, warnings: [], parser: 'SQL Server · catálogo y registros' });
    } catch (error) {
      response.status(502).json({
        error: connectionError(error),
      });
    } finally {
      reading = false;
    }
  });
  app.use(
    (
      error: { type?: string },
      _request: express.Request,
      response: express.Response,
      _next: express.NextFunction,
    ) => {
      response.status(error.type === 'entity.too.large' ? 413 : 400).json({
        error:
          error.type === 'entity.too.large'
            ? 'La solicitud excede el tamaño permitido (SQL hasta 50 MiB).'
            : 'La solicitud no contiene JSON válido.',
      });
    },
  );
  return app;
}
function connectionError(error: unknown) {
  const message = String((error as Error)?.message || '');
  if (/certificate|self.signed|tls|cert_/i.test(message))
    return 'SQL Server rechazó la validación TLS. Configura un certificado confiable o DB_CA_FILE con la CA privada y reinicia la API. La verificación TLS sigue activada.';
  if (/login|ELOGIN|authentication/i.test(message))
    return 'SQL Server rechazó la autenticación. Verifica el modo SQL/NTLM, usuario, contraseña, dominio y acceso a la base.';
  if (/timeout|connect|ESOCKET|ETIMEOUT/i.test(message))
    return 'No se pudo alcanzar SQL Server. Verifica servidor, puerto, servicio activo y acceso de red.';
  return 'No se pudo leer SQL Server. Revisa conexión, permisos VIEW DEFINITION / SELECT y configuración TLS. La API no devuelve credenciales ni detalles internos.';
}
