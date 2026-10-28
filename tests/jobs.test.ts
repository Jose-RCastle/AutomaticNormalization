import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executeJob } from '../src/lib/jobs';
import { MAX_FILE_BYTES } from '../src/lib/models';

test('archivos: UTF-8, UTF-16LE y UTF-16BE con BOM', async () => {
  const text = 'CREATE TABLE [Niños] ([Código] INT PRIMARY KEY);';
  const le = Buffer.from('\ufeff' + text, 'utf16le');
  const be = Buffer.from(le);
  be.swap16();
  for (const buffer of [Buffer.from(text), le, be]) {
    const result = await executeJob({ type: 'import', file: new File([buffer], 'datos.sql') });
    assert.ok('tables' in result);
    if ('tables' in result) assert.equal(result.tables[0].columns[0].name, 'Código');
  }
});
test('archivos: límite superior y codificación inválida se rechazan', async () => {
  await assert.rejects(
    () => executeJob({ type: 'import', file: { size: MAX_FILE_BYTES + 1 } as File }),
    /50 MiB/,
  );
  await assert.rejects(() =>
    executeJob({ type: 'import', file: new File([new Uint8Array([255, 128, 254])], 'datos.sql') }),
  );
});
