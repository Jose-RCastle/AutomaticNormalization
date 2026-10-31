import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sqlglotPython, virtualenvPython } from '../scripts/python-runtime';
import { parseWithSqlGlot } from '../server/sqlglot';

test('usa Scripts/python.exe para Windows y bin/python para Linux/macOS', () => {
  assert.match(virtualenvPython('win32').replaceAll('\\', '/'), /\/\.venv\/Scripts\/python\.exe$/);
  for (const platform of ['linux', 'darwin'] as const)
    assert.match(virtualenvPython(platform).replaceAll('\\', '/'), /\/\.venv\/bin\/python$/);
});

test('inicia el proceso SQLGlot con UTF-8 para nombres y textos de Windows', async () => {
  const result = (await parseWithSqlGlot(
    "CREATE TABLE [Niños](Id INT PRIMARY KEY, [Dirección] NVARCHAR(40)); INSERT INTO [Niños] VALUES(1,N'Tegucigalpa');",
  )) as { tables: { name: string; columns: { name: string }[] }[] };
  assert.equal(result.tables[0].name, 'Niños');
  assert.equal(result.tables[0].columns[1].name, 'Dirección');
});

test('respeta el ejecutable configurado y explica cómo corregir una ruta inexistente', async () => {
  const previous = process.env['SQLGLOT_PYTHON'];
  try {
    process.env['SQLGLOT_PYTHON'] = '/ejecutable-inexistente-normalizadb/python';
    assert.equal(sqlglotPython(), '/ejecutable-inexistente-normalizadb/python');
    await assert.rejects(parseWithSqlGlot('CREATE TABLE P(Id INT);'), /Instala Python 3.10\+/);
  } finally {
    if (previous === undefined) delete process.env['SQLGLOT_PYTHON'];
    else process.env['SQLGLOT_PYTHON'] = previous;
  }
});
