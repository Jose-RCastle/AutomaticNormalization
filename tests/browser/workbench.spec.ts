import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

test('PARCELAS: un clic genera las tres etapas y descarga SQL, SVG, Mermaid e informe', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Probar PARCELAS de clase' }).click();
  await expect(page.getByText('FORMA DE PARTIDA')).toBeVisible();
  await expect(page.locator('.metrics')).toContainText('1FN');
  await expect(page.locator('.entities article')).toHaveCount(3);
  await page.getByRole('button', { name: '2FN', exact: true }).click();
  await expect(page.locator('.entities article')).toHaveCount(2);
  await page.getByRole('button', { name: '1FN', exact: true }).click();
  await expect(page.locator('.entities article')).toHaveCount(1);
  await page.getByRole('button', { name: '3FN', exact: true }).click();
  for (const name of ['Descargar SQL', 'Diagrama SVG', 'Mermaid', 'Informe completo JSON']) {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name, exact: true }).click();
    const download = await pending;
    expect(await download.failure()).toBeNull();
    const content = readFileSync((await download.path())!, 'utf8');
    expect(content.length).toBeGreaterThan(100);
    if (name === 'Descargar SQL') expect(content.match(/CREATE TABLE/g)).toHaveLength(3);
  }
  await page.getByText('Ver diagrama de todas las tablas').click();
  await expect(page.locator('.diagram img')).toHaveJSProperty('naturalWidth', 1060);
  await page.screenshot({ path: '/tmp/normalizadb-sqlglot.png', fullPage: true });
});

test('archivo UTF-16: extrae un grupo repetido sin preguntas y avisa que es supuesto', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles({
    name: 'telefonos.sql',
    mimeType: 'text/plain',
    buffer: Buffer.from(
      '\ufeffCREATE TABLE P(Id INT PRIMARY KEY, Telefono1 VARCHAR(20), Telefono2 VARCHAR(20));',
      'utf16le',
    ),
  });
  await expect(page.locator('.entities')).toContainText('Posicion');
  await expect(
    page.getByText('Grupo supuesto por numeración y tipo:', { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Descargar SQL' })).toBeEnabled();
});

test('sin clave no inventa resultados; un error SQL conserva el análisis previo', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByText('O pega el SQL aquí').click();
  await page.locator('#sql').fill('CREATE TABLE P(A INT, B INT);');
  await page.getByRole('button', { name: 'Analizar y normalizar automáticamente' }).click();
  await expect(page.getByText('No hay PRIMARY KEY', { exact: false }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Descargar SQL' })).toBeDisabled();
  await page.locator('#sql').fill('CREATE TABLE Rota(');
  await page.getByRole('button', { name: 'Analizar y normalizar automáticamente' }).click();
  await expect(page.locator('.table-list')).toContainText('P');
  await expect(page.locator('[role=alert]').first()).toBeVisible();
});

test('descubre dependencias empíricas y muestra NULL sin certificar semántica', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByText('O pega el SQL aquí').click();
  await page
    .locator('#sql')
    .fill(
      'CREATE TABLE P(Id INT PRIMARY KEY, A INT, B INT, C INT); INSERT INTO P VALUES(1,2,3,NULL),(2,2,3,4),(3,5,6,8);',
    );
  await page.getByRole('button', { name: 'Analizar y normalizar automáticamente' }).click();
  await expect(
    page.getByText('Dependencias descubiertas en los INSERT:', { exact: false }),
  ).toBeVisible();
  await expect(page.getByText('C: 1.', { exact: false })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
