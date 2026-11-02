import { test, expect } from '@playwright/test';
import { randomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';

const tableName = () => `Relacion_${randomInt(10000, 99999)}`;
async function paste(page: import('@playwright/test').Page, sql: string) {
  await page.getByRole('tab', { name: 'Pegar SQL' }).click();
  await page.locator('#sql').fill(sql);
  await page.getByRole('button', { name: 'Analizar y normalizar' }).click();
}
async function approve(page: import('@playwright/test').Page, technical = false) {
  await expect(page.locator('.review-card').first()).toBeVisible();
  await page.getByLabel('Confirmo valores atómicos', { exact: false }).check();
  await page.getByLabel('Confirmo que las reglas declaradas', { exact: false }).check();
  await page.getByRole('button', { name: 'Confirmar simples recomendadas de esta tabla' }).click();
  if (technical)
    await page.getByRole('button', { name: 'Confirmar creación de clave técnica' }).click();
  await page.getByRole('button', { name: 'Aplicar decisiones y recalcular' }).click();
  await expect(page.getByRole('button', { name: 'Descargar SQL', exact: true })).toBeEnabled();
}
test('datos aportados generan comparación antes/después y descargas', async ({ page }) => {
  const name = tableName();
  const rows = Array.from(
    { length: 24 },
    (_, i) => `(${i + 1},${i % 3},'Local ${i % 3}',${i % 2},'Clase ${i % 2}',${100 + i * 7})`,
  );
  const sql = `CREATE TABLE ${name}(Id INT PRIMARY KEY, Centro INT NOT NULL, NombreCentro VARCHAR(30) NOT NULL, Clase INT NOT NULL, NombreClase VARCHAR(30) NOT NULL, Importe INT NOT NULL); INSERT INTO ${name} VALUES ${rows.join(',')};`;
  await page.goto('/');
  await paste(page, sql);
  await expect(page.locator('.result-heading')).toContainText('SQL pegado');
  await expect(page.locator('.result-heading')).toContainText('SQL Server (tsql)');
  await expect(page.locator('.badge')).toContainText('observadas');
  await approve(page);
  await expect(page.locator('.before img')).toHaveJSProperty('complete', true);
  await expect(page.locator('.after img')).toHaveJSProperty('complete', true);
  await page.getByRole('button', { name: 'Tablas', exact: true }).click();
  await expect(page.locator('.before article')).toHaveCount(1);
  expect(await page.locator('.after article').count()).toBeGreaterThan(1);
  for (const name of ['Descargar SQL', 'Diagrama SVG', 'Mermaid', 'Informe JSON']) {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name, exact: true }).click();
    const download = await pending;
    expect(await download.failure()).toBeNull();
    expect(readFileSync((await download.path())!, 'utf8').length).toBeGreaterThan(100);
  }
  await page.getByRole('button', { name: 'Diagrama', exact: true }).click();
  await page.screenshot({ path: '/tmp/normalizadb-comparacion.png', fullPage: true });
});
test('UTF-16 y grupos compuestos mantienen las columnas emparejadas', async ({ page }) => {
  const name = tableName();
  await page.goto('/');
  await page.locator('input[accept=".sql"]').setInputFiles({
    name: 'entrada.sql',
    mimeType: 'text/plain',
    buffer: Buffer.from(
      `\ufeffCREATE TABLE ${name}(Id INT PRIMARY KEY, Producto1 VARCHAR(20) NULL, Cantidad1 INT NULL, Producto2 VARCHAR(20) NULL, Cantidad2 INT NULL); INSERT INTO ${name} VALUES(1,'A',NULL,NULL,NULL),(2,'B',3,'C',4);`,
      'utf16le',
    ),
  });
  await page.getByRole('button', { name: 'Tablas', exact: true }).click();
  await expect(page.locator('.before article')).toHaveCount(1);
  await expect(page.locator('.after article')).toHaveCount(2);
  await expect(page.locator('.before tr').filter({ hasText: 'Producto1' })).toContainText('Sí');
  const child = page.locator('.after article').filter({ hasText: 'Posicion' });
  await expect(child).toContainText('Producto');
  await expect(child).toContainText('Cantidad');
});
test('texto con comas y tabla sin clave; error SQL conserva el resultado previo', async ({
  page,
}) => {
  await page.goto('/');
  const name = tableName();
  await paste(
    page,
    `CREATE TABLE ${name}(Direccion VARCHAR(80)); INSERT INTO ${name} VALUES('Calle 1, casa 2');`,
  );
  await approve(page, true);
  await page.getByRole('button', { name: 'Tablas', exact: true }).click();
  await expect(page.locator('.after article')).toContainText('__RowId');
  await paste(page, 'CREATE TABLE Rota(');
  await expect(page.locator('[role=alert]').first()).toBeVisible();
  await expect(page.locator('.before article')).toContainText(name);
});
test('reglas adicionales son entrada del usuario y móvil conserva la comparación', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const name = tableName();
  await paste(page, `CREATE TABLE ${name}(Id INT PRIMARY KEY, A INT NOT NULL, B INT NOT NULL);`);
  await expect(page.locator('.badge')).toHaveText('Claves del esquema');
  await expect(page.getByRole('button', { name: 'Analizar y normalizar' })).toBeEnabled();
  await page.getByText('Reglas del negocio · opcional', { exact: true }).click();
  await page.locator('input[accept=".json"]').setInputFiles({
    name: 'reglas.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ [name]: 'A -> B' })),
  });
  await expect(page.locator('.badge')).toContainText('declaradas');
  await approve(page);
  await page.getByRole('button', { name: 'Tablas', exact: true }).click();
  await expect(page.locator('.after article')).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/normalizadb-movil.png', fullPage: true });
});
