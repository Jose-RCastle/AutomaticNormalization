import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

async function confirmAndRun(page: Page) {
  await page.getByRole('checkbox').nth(0).check();
  await page.getByRole('checkbox').nth(1).check();
  await page.getByRole('button', { name: 'Analizar y normalizar' }).click();
  await expect(page.locator('.diagram')).toBeVisible();
}
test('caso universitario: 34 columnas, resultados por tabla y descargas', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Caso universitario' }).click();
  await expect(page.locator('.table-title h2')).toHaveText('dbo.InscripcionesExtendidas');
  await expect(page.locator('tbody tr')).toHaveCount(34);
  await confirmAndRun(page);
  await expect(page.locator('.result-summary')).toContainText('1FN');
  await expect(page.locator('.entity')).toHaveCount(11);
  await expect(page.locator('.diagram')).toHaveJSProperty('complete', true);
  for (const name of [
    'Script SQL',
    'Diagrama SVG',
    'Mermaid',
    'Esquema JSON',
    'Informe del análisis',
  ]) {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name }).click();
    const download = await pending;
    expect(await download.failure()).toBeNull();
    const path = await download.path();
    expect(readFileSync(path!, 'utf8').length).toBeGreaterThan(100);
  }
  await page.locator('.table-options button').filter({ hasText: 'dbo.Docentes' }).click();
  await page
    .locator('.table-options button')
    .filter({ hasText: 'dbo.InscripcionesExtendidas' })
    .click();
  await expect(page.locator('.diagram')).toBeVisible();
  await page.getByRole('button', { name: 'Editar reglas' }).click();
  await expect(page.locator('#fds')).toHaveValue(/FacultadId/);
  expect(errors).toEqual([]);
});
test('archivo de 15 MiB procesado por trabajador, UTF-16 y error de archivo', async ({ page }) => {
  await page.goto('/');
  const sql =
    'CREATE TABLE Grande(Id INT PRIMARY KEY, Nombre NVARCHAR(80));\n' +
    "INSERT INTO Grande VALUES(1,N'CREATE TABLE NoExiste(Id INT)');\n".repeat(270_000);
  expect(Buffer.byteLength(sql)).toBeGreaterThan(15 * 1024 * 1024);
  await page
    .locator('input[accept=".sql"]')
    .setInputFiles({ name: 'grande.sql', mimeType: 'text/plain', buffer: Buffer.from(sql) });
  await expect(page.locator('.table-title h2')).toHaveText('Grande');
  await expect(page.locator('.table-options button')).toHaveCount(1);
  await page.getByRole('button', { name: 'Importar SQL', exact: false }).click();
  await page.locator('input[accept=".sql"]').setInputFiles({
    name: 'utf16.sql',
    mimeType: 'text/plain',
    buffer: Buffer.from('\ufeffCREATE TABLE [Niños] ([Código] INT PRIMARY KEY);', 'utf16le'),
  });
  await expect(page.locator('.table-title h2')).toHaveText('Niños');
  await page.getByRole('button', { name: 'Importar SQL', exact: false }).click();
  await page.locator('input[accept=".sql"]').setInputFiles({
    name: 'rota.sql',
    mimeType: 'text/plain',
    buffer: Buffer.from('CREATE TABLE Rota (Id INT'),
  });
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByRole('button', { name: 'Analizar tablas' }).click();
  await expect(page.locator('.table-title h2')).toHaveText('Niños');
});
test('1FN, clave manual, informe parcial y vista móvil', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.locator('input[accept=".sql"]').setInputFiles({
    name: 'tablas.sql',
    mimeType: 'text/plain',
    buffer: Buffer.from(
      'CREATE TABLE Contacto(Id INT, Tel1 VARCHAR(30), Tel2 VARCHAR(30));\nCREATE TABLE Rota(Id INT, Id INT);',
    ),
  });
  await expect(page.locator('.table-title h2')).toHaveText('Contacto');
  await expect(page.locator('.diagnostics')).toContainText('duplicadas');
  await page.locator('#key').selectOption(['Id']);
  await page.getByLabel('Forma normal objetivo').selectOption('1FN');
  await page.locator('#group').selectOption(['Tel1', 'Tel2']);
  await page.getByRole('checkbox').nth(0).check();
  await page.getByRole('button', { name: 'Analizar y normalizar' }).click();
  await expect(page.locator('.entity')).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('cancelación real conserva la tabla previa y recuperación sin clave', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Ejemplo básico', exact: true }).click();
  await expect(page.locator('.table-title h2')).toHaveText('DetallePedido');
  await page.getByRole('button', { name: 'Importar SQL', exact: false }).click();
  const content =
    'CREATE TABLE Nueva(Id INT PRIMARY KEY);\n' +
    'INSERT INTO Nueva VALUES(1);\n'.repeat(1_200_000);
  await page
    .locator('input[accept=".sql"]')
    .setInputFiles({ name: 'cancelar.sql', mimeType: 'text/plain', buffer: Buffer.from(content) });
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Operación cancelada');
  await page.getByRole('button', { name: 'Analizar tablas' }).click();
  await expect(page.locator('.table-title h2')).toHaveText('DetallePedido');
});
