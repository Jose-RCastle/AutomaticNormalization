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
        self.assertIn({'left': ['A'], 'right': ['B']}, table['profile']['observedRules'])
        self.assertFalse(any(rule['left'] == ['Id'] for rule in table['profile']['observedRules']))

    def test_nulls_and_bad_key_are_reported(self):
        table = analyze_sql('CREATE TABLE P(Id INT PRIMARY KEY, B INT); INSERT INTO P VALUES(1,NULL),(1,3);')['tables'][0]
        self.assertEqual(table['profile']['nulls']['B'], 1)
        self.assertTrue(table['issues'])

    def test_no_expressions_or_unrecognized_changes_are_executed(self):
        for sql in ['CREATE TABLE P(Id INT); INSERT INTO P VALUES(ABS(-1));', 'CREATE TABLE P(Id INT); DROP TABLE P;', 'CREATE TABLE P(Id INT); ALTER TABLE P DROP COLUMN Id;']:
            with self.subTest(sql=sql), self.assertRaises(ValueError):
                analyze_sql(sql)

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

if __name__ == '__main__':
    unittest.main()
