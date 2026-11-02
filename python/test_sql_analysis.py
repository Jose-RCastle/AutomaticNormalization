import unittest
from sql_analysis import analyze_sql

class SqlAnalysisTests(unittest.TestCase):
    def test_sqlglot_handles_constraints_alter_and_go_without_touching_literals(self):
        result = analyze_sql("CREATE TABLE dbo.P(Id INT NOT NULL, Nombre NVARCHAR(50));\nGO\nALTER TABLE dbo.P ADD CONSTRAINT PK PRIMARY KEY(Id); INSERT INTO dbo.P VALUES(1,N'GO; CREATE TABLE falsa(x int)');")
        self.assertEqual(len(result['tables']), 1)
        self.assertEqual(result['tables'][0]['primaryKey'], ['Id'])
        self.assertEqual(result['tables'][0]['profile']['rowCount'], 1)

    def test_literal_insert_profile_is_evidence_not_semantics(self):
        table = analyze_sql('CREATE TABLE P(Id INT PRIMARY KEY, A INT, B INT); INSERT INTO P VALUES(1,2,3),(2,2,3),(3,4,5);')['tables'][0]
        self.assertTrue(any(f['left']==['A'] and f['right']==['B'] and f['evidence']['groups']==2 for f in table['profile']['observedRules']))
        self.assertFalse(any(rule['left'] == ['Id'] for rule in table['profile']['observedRules']))

    def test_nulls_and_bad_key_are_reported(self):
        table = analyze_sql('CREATE TABLE P(Id INT PRIMARY KEY, B INT); INSERT INTO P VALUES(1,NULL),(1,3);')['tables'][0]
        self.assertEqual(table['profile']['nulls']['B'], 1)
        self.assertTrue(table['issues'])

    def test_no_expressions_or_unrecognized_changes_are_executed(self):
        self.assertTrue(analyze_sql('CREATE TABLE P(Id INT); INSERT INTO P VALUES(ABS(-1));')['tables'][0]['warnings'])
        for sql in ['CREATE TABLE P(Id INT); DROP TABLE P;', 'CREATE TABLE P(Id INT); ALTER TABLE P DROP COLUMN Id;']:
            with self.subTest(sql=sql):
                self.assertTrue(analyze_sql(sql)['tables'][0]['issues'])

    def test_bad_sql_and_contradicting_rules(self):
        with self.assertRaises(Exception):
            analyze_sql('CREATE TABLE Rota(')
        table = analyze_sql('-- @fd P: A -> B\nCREATE TABLE P(Id INT PRIMARY KEY, A INT, B INT); INSERT INTO P VALUES(1,2,3),(2,2,4);')['tables'][0]
        self.assertTrue(any('contradicen la regla' in issue for issue in table['issues']))

    def test_classroom_file_has_explicit_domain_rules(self):
        with open('examples/parcelas.sql') as source:
            table = analyze_sql(source.read())['tables'][0]
        self.assertEqual(len(table['rules']), 4)
        self.assertEqual(table['uniqueKeys'], [['NombreMunicipio', 'NumeroParcela']])

    def test_explicit_null_is_not_not_null_in_either_dialect(self):
        for dialect in ['tsql', 'mysql']:
            with self.subTest(dialect=dialect):
                result = analyze_sql('CREATE TABLE Q(Id INT PRIMARY KEY, Optional INT NULL, Required INT NOT NULL); INSERT INTO Q VALUES(1,NULL,3);', dialect)
                table = result['tables'][0]
                self.assertEqual([c['nullable'] for c in table['columns']], [False,True,False])
                self.assertEqual(table['issues'], [])
                self.assertEqual(result['dialect'], dialect)

    def test_not_null_and_null_primary_keys_still_report_bad_data(self):
        table = analyze_sql('CREATE TABLE Q(Id INT NULL PRIMARY KEY, Required INT NOT NULL); INSERT INTO Q VALUES(NULL,NULL);')['tables'][0]
        self.assertFalse(table['columns'][0]['nullable'])
        self.assertTrue(table['issues'])

    def test_contact_patterns_are_suspicions_not_address_splitting(self):
        table = analyze_sql("CREATE TABLE Q(Id INT PRIMARY KEY, A VARCHAR(80) NULL, B VARCHAR(80) NULL, C VARCHAR(80)); INSERT INTO Q VALUES(1,'9988-1122, 2550-3344','a@mail.com; b@mail.com','731 Fondren, Houston, TX');")['tables'][0]
        self.assertEqual({c['column'] for c in table['profile']['listCandidates']}, {'A','B'})

    def test_ssms_batches_keep_metadata_and_skip_modules(self):
        sql="""USE Demo;
GO
IF OBJECT_ID(N'dbo.Q',N'U') IS NOT NULL DROP TABLE dbo.Q;
GO
/* metadata */ CREATE TABLE [dbo].[Q]([Id] INT IDENTITY(1,1) NOT NULL, [Text] NVARCHAR(MAX) DEFAULT N'O''Brien', [D] DATETIME2 NULL, [Value] INT NOT NULL CHECK([Value]>0));
GO
ALTER TABLE dbo.Q ADD CONSTRAINT PK_Q PRIMARY KEY CLUSTERED(Id ASC);
GO
INSERT INTO dbo.Q(Text,D,Value) VALUES(N'texto',NULL,1),(N'can''t',NULL,2);
GO
CREATE VIEW dbo.V AS SELECT Id FROM dbo.Q;
GO
CREATE TRIGGER dbo.Tr ON dbo.Q AFTER INSERT AS BEGIN PRINT 'ignored'; END;
GO
CREATE TABLE dbo.Other(Id INT PRIMARY KEY);
"""
        result=analyze_sql(sql)
        self.assertEqual([t['name'] for t in result['tables']],['dbo.Q','dbo.Other'])
        table=result['tables'][0]
        self.assertEqual(table['primaryKey'],['Id'])
        self.assertEqual(table['columns'][0]['identity'],'IDENTITY(1,1)')
        self.assertEqual(table['columns'][1]['default'],"N'O''Brien'")
        self.assertEqual(len(table['checks']),1)
        self.assertFalse(table['issues'])
        self.assertTrue(any('Módulo omitido' in w for w in result['warnings']))

if __name__ == '__main__':
    unittest.main()
