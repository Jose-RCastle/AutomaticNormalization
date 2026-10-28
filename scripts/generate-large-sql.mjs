import { createWriteStream, readFileSync } from 'node:fs';
import { once } from 'node:events';

// Mantiene pequeño el repositorio: genera los datos de práctica solo cuando se piden.
const output = process.argv[2] || 'universidad-grande.sql';
const mib = Number(process.argv[3] || 20);
if (!Number.isFinite(mib) || mib < 1 || mib > 49)
  throw Error('El tamaño debe estar entre 1 y 49 MiB.');
const stream = createWriteStream(output, { flags: 'wx' });
stream.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
let written = 0;
async function append(text) {
  written += Buffer.byteLength(text);
  if (!stream.write(text)) await once(stream, 'drain');
}
await append(readFileSync(new URL('../examples/caso-universidad.sql', import.meta.url), 'utf8'));
let id = 301;
while (written < mib * 1024 * 1024) {
  await append(
    `INSERT INTO [dbo].[Docentes] VALUES (${id}, N'Docente de práctica ${id}', N'Dato de prueba; no ejecutar en producción');\n`,
  );
  id++;
}
stream.end();
await once(stream, 'finish');
console.log(`Archivo creado: ${output} (${(written / 1024 / 1024).toFixed(2)} MiB).`);
