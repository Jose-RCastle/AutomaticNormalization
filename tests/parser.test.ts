import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  importSQL,
  parseSQL,
  exportSQL,
  dependencies,
  analyze,
  normalize,
  parseDependencies,
} from '../src/lib/normalization';

test('SSMS: GO, USE, SET, opciones de índices y restricciones posteriores', () => {
  const result = importSQL(`USE Demo\nGO\nSET ANSI_NULLS ON\nGO
    CREATE TABLE [dbo].[Padre] ([Id] INT IDENTITY(1,1) NOT NULL, [Codigo] NVARCHAR(40) NOT NULL) ON [PRIMARY]
    GO
    ALTER TABLE [dbo].[Padre] ADD CONSTRAINT PK_P PRIMARY KEY CLUSTERED ([Id] ASC) WITH (PAD_INDEX=OFF) ON [PRIMARY]
    GO
    ALTER TABLE [dbo].[Padre] ADD CONSTRAINT UQ_C UNIQUE NONCLUSTERED ([Codigo] ASC)
    GO
    CREATE TABLE Hija(Id INT PRIMARY KEY, PadreId INT REFERENCES dbo.Padre(Id));`);
  assert.equal(result.tables.length, 2);
  assert.deepEqual(result.tables[0].primaryKey, ['Id']);
  assert.deepEqual(result.tables[0].uniqueKeys, [['Codigo']]);
  assert.equal(result.tables[0].columns[0].identity, 'IDENTITY(1,1)');
  assert.equal(result.tables[1].foreignKeys[0].table, 'dbo.Padre');
  assert.equal(result.diagnostics.filter((d) => d.level === 'error').length, 0);
});
test('comentarios, escapes y cadenas no generan tablas ni alteran delimitadores', () => {
  const result =
    importSQL(`/* comentario /* anidado */ */ CREATE TABLE "Niños" ([Id] INT PRIMARY KEY, [Texto]]extra] NVARCHAR(80) DEFAULT N'-- ) CREATE TABLE Falsa (X INT)');
  INSERT INTO "Niños" VALUES (1, 'CREATE TABLE Otra (Id INT); it''s /* un literal */');`);
  assert.equal(result.tables.length, 1);
  assert.equal(result.tables[0].name, 'Niños');
  assert.equal(result.tables[0].columns[1].name, 'Texto]extra');
  assert.ok(result.diagnostics.some((d) => d.level === 'warning'));
});
test('preserva otras tablas y ubica los errores por tabla y línea', () => {
  const result = importSQL(
    'CREATE TABLE Buena(Id INT PRIMARY KEY);\nCREATE TABLE Mala(Id INT, Id INT);\nCREATE TABLE Otra(Id INT PRIMARY KEY);',
  );
  assert.equal(result.tables.length, 2);
  assert.equal(result.diagnostics[0].line, 2);
  assert.equal(result.diagnostics[0].table, 'Mala');
  assert.equal(result.diagnostics[0].level, 'error');
});
test('ALTER ADD columna y claves compuestas, sin exigir punto y coma', () => {
  const tables = parseSQL(
    `CREATE TABLE T(A INT NOT NULL)\nGO\nALTER TABLE T ADD B INT NOT NULL, C DECIMAL(12, 3) NULL\nGO\nALTER TABLE T ADD PRIMARY KEY(A,B)\nGO`,
  );
  assert.equal(tables[0].columns.length, 3);
  assert.deepEqual(tables[0].primaryKey, ['A', 'B']);
});
test('columnas calculadas y ALTER no interpretados bloquean la síntesis', () => {
  const result = importSQL(
    'CREATE TABLE T(Id INT PRIMARY KEY, Total AS (Id*2)); ALTER TABLE T ALTER COLUMN Id BIGINT;',
  );
  assert.ok(result.tables[0].issues?.length);
  assert.throws(() => normalize(result.tables[0], dependencies(result.tables[0], []), '3FN'));
});
test('detecta claves inválidas y referencias externas sin inventarlas', () => {
  const result = importSQL(
    'CREATE TABLE T(Id INT, PRIMARY KEY(Inexistente), FOREIGN KEY(Id) REFERENCES Externa(Id));',
  );
  assert.ok(result.tables[0].issues?.length);
  assert.ok(result.diagnostics.some((d) => d.message.includes('Referencia externa')));
});
test('exportación de estructuras puede volver a importarse', () => {
  const tables = parseSQL(
    'CREATE TABLE Padre(Id INT PRIMARY KEY); CREATE TABLE Hija(Id INT PRIMARY KEY, PadreId INT, FOREIGN KEY(PadreId) REFERENCES Padre(Id));',
  );
  const roundTrip = parseSQL(exportSQL(tables));
  assert.deepEqual(
    roundTrip.map((t) => ({ pk: t.primaryKey, fks: t.foreignKeys })),
    tables.map((t) => ({ pk: t.primaryKey, fks: t.foreignKeys })),
  );
});
test('UNIQUE nullable no se utiliza como clave relacional', () => {
  const [t] = parseSQL(
    'CREATE TABLE T(Id INT PRIMARY KEY, Codigo INT UNIQUE, Nombre NVARCHAR(50))',
  );
  const rules = dependencies(t, []);
  assert.ok(!rules.some((r) => r.left.includes('Codigo')));
});
test('caso universitario: 12 tablas, 34 atributos y síntesis verificable', () => {
  const result = importSQL(readFileSync('examples/caso-universidad.sql', 'utf8'));
  assert.equal(result.tables.length, 12);
  assert.equal(result.diagnostics.filter((d) => d.level === 'error').length, 0);
  const table = result.tables.find((t) => t.name === 'dbo.InscripcionesExtendidas')!;
  assert.equal(table.columns.length, 34);
  const text = JSON.parse(readFileSync('examples/caso-universidad.reglas.json', 'utf8'))[
    table.name
  ];
  const rules = dependencies(table, parseDependencies(text, table));
  assert.equal(analyze(table, rules, true).form, '1FN');
  const relations = normalize(table, rules, '3FN');
  assert.ok(relations.length >= 10);
  assert.equal(new Set(relations.flatMap((t) => t.columns.map((c) => c.name))).size, 34);
});
test('archivo de más de 10 MiB con INSERT se lee sin confundir datos con DDL', () => {
  const sql =
    'CREATE TABLE T(Id INT PRIMARY KEY, Texto NVARCHAR(MAX));\n' +
    "INSERT INTO T VALUES(1,N'CREATE TABLE Falsa (Id INT);');\n".repeat(200_000);
  assert.ok(Buffer.byteLength(sql) > 10 * 1024 * 1024);
  const result = importSQL(sql);
  assert.equal(result.tables.length, 1);
  assert.equal(result.ignoredStatements, 200_000);
});
test('no confunde columnas con una coma omitida ni oculta modificadores desconocidos', () => {
  const result = importSQL('CREATE TABLE T (Id INT Nombre NVARCHAR(30));');
  assert.ok(result.tables[0].issues?.some((s) => s.includes('Nombre')));
});
test('nombres con puntos y caracteres especiales sobreviven a la exportación', () => {
  const tables = parseSQL(
    'CREATE TABLE [ventas].[Detalle.v2] ([Id] INT PRIMARY KEY, [Texto]]extra] NVARCHAR(40));',
  );
  assert.match(exportSQL(tables), /\[ventas\]\.\[Detalle\.v2\]/);
  assert.deepEqual(parseSQL(exportSQL(tables))[0].columns, tables[0].columns);
});
test('omite DDL dentro de módulos y avisa sobre DROP TABLE', () => {
  const result = importSQL(
    'CREATE PROCEDURE P AS CREATE TABLE Interna(Id INT);\nGO\nCREATE TABLE Real(Id INT PRIMARY KEY); DROP TABLE Real;',
  );
  assert.equal(result.tables.length, 1);
  assert.equal(result.tables[0].name, 'Real');
  assert.ok(result.tables[0].issues?.length);
  assert.ok(result.diagnostics.some((d) => d.message.includes('Módulo')));
});
test('ALTER ADD no puede introducir columnas duplicadas ni claves desconocidas', () => {
  const result = importSQL('CREATE TABLE T(Id INT PRIMARY KEY); ALTER TABLE T ADD Id INT;');
  assert.ok(result.tables[0].issues?.length);
});
test('el límite permite exactamente mil tablas, y rechaza una adicional', () => {
  const sql = Array.from(
    { length: 1000 },
    (_, i) => `CREATE TABLE T${i}(Id INT PRIMARY KEY);`,
  ).join('\n');
  assert.equal(importSQL(sql).tables.length, 1000);
  assert.throws(() => importSQL(sql + 'CREATE TABLE Extra(Id INT);'), /1000/);
});
test('CREATE OR ALTER no descubre tablas internas de procedimientos', () => {
  const result = importSQL(
    'CREATE OR ALTER PROCEDURE P AS CREATE TABLE Interna(Id INT);\nGO\nCREATE TABLE Externa(Id INT PRIMARY KEY);',
  );
  assert.equal(result.tables.length, 1);
  assert.equal(result.tables[0].name, 'Externa');
});
