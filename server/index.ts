import { createApp } from './app';
const port = Number(process.env['API_PORT'] || 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw Error('API_PORT debe ser un puerto entre 1 y 65535.');
createApp().listen(port, '127.0.0.1', () =>
  console.log(`API de metadatos disponible en puerto ${port}`),
);
