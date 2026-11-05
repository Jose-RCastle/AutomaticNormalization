import unittest
from sql_analysis import analyze_sql


class IntegrityTests(unittest.TestCase):
    def table(self, sql, **kwargs):
        return analyze_sql(sql, **kwargs)['tables'][0]

    def test_default_only_applies_to_omitted_values(self):
        ddl = 'CREATE TABLE T(Id INT PRIMARY KEY, N INT NOT NULL DEFAULT 5);'
        self.assertTrue(self.table(ddl + 'INSERT INTO T VALUES(1,NULL);')['issues'])
        valid = self.table(ddl + 'INSERT INTO T(Id) VALUES(1);')
        self.assertEqual(valid['issues'], [])
        self.assertEqual(valid['profile']['sampleRows'][0]['N'], '5')
        self.assertTrue(self.table('CREATE TABLE T(Id INT PRIMARY KEY, N INT NOT NULL DEFAULT NULL); INSERT INTO T(Id) VALUES(1);')['issues'])

    def test_unknown_defaults_are_not_known_nulls(self):
        t = self.table('CREATE TABLE T(Id INT PRIMARY KEY, D DATETIME NOT NULL DEFAULT GETDATE()); INSERT INTO T(Id) VALUES(1);')
        self.assertTrue(any('DEFAULT no evaluable' in x for x in t['issues']))

    def test_all_inspected_records_are_available_for_review(self):
        sql = 'CREATE TABLE T(Id INT, V INT); INSERT INTO T VALUES ' + ','.join(f'({1 if i == 1000 else i+1},{i+1})' for i in range(1001))
        p = self.table(sql)['profile']
        self.assertEqual(p['rowCount'], 1001)
        self.assertEqual(len(p['sampleRows']), 1001)
        self.assertEqual(len(p['comparisonRows']), 1001)

    def test_collation_applies_to_keys_and_functional_dependencies(self):
        for suffix, invalid in [('CI_AS', True), ('CS_AS', False), ('BIN2', False)]:
            with self.subTest(suffix=suffix):
                t = self.table(f"CREATE TABLE T(C VARCHAR(10) COLLATE Latin1_General_100_{suffix} PRIMARY KEY); INSERT INTO T VALUES('a'),('A');")
                self.assertEqual(bool(t['issues']), invalid)
        t = self.table("-- @fd T: C -> V\nCREATE TABLE T(Id INT PRIMARY KEY, C VARCHAR(10), V INT); INSERT INTO T VALUES(1,'a',1),(2,'A',2);")
        self.assertTrue(any('contradicen la regla' in i for i in t['issues']))

    def test_sql_padding_and_numeric_equality(self):
        for sql in ["CREATE TABLE T(C VARCHAR(10) PRIMARY KEY); INSERT INTO T VALUES('a'),('a ');",
                    "CREATE TABLE T(C INT PRIMARY KEY); INSERT INTO T VALUES('01'),(1);"]:
            self.assertTrue(self.table(sql)['issues'])

    def test_unknown_and_unicode_linguistic_comparisons_are_not_certified(self):
        for coll, values in [('Turkish_CI_AS', "'I','i'"), ('Latin1_General_100_CI_AS', "'á','Á'")]:
            t = self.table(f'CREATE TABLE T(C VARCHAR(10) COLLATE {coll}); INSERT INTO T VALUES({values.split(",")[0]}),({values.split(",")[1]});')
            self.assertTrue(t['profile']['comparisonIssues'])
            self.assertEqual(t['profile']['observedRules'], [])
            self.assertEqual(t['profile']['keyCandidates'], [])
        t = self.table("CREATE TABLE T(C NVARCHAR(10) COLLATE Latin1_General_100_BIN2 PRIMARY KEY); INSERT INTO T VALUES(N'á'),(N'Á');")
        self.assertEqual(t['issues'], [])
        self.assertEqual(t['profile']['comparisonIssues'], [])

    def test_configured_collation_is_preserved_in_schema(self):
        t = self.table("CREATE TABLE T(C VARCHAR(10) PRIMARY KEY); INSERT INTO T VALUES('a'),('A');", default_collation='Latin1_General_100_CS_AS')
        self.assertEqual(t['issues'], [])
        self.assertEqual(t['columns'][0]['collation'], 'Latin1_General_100_CS_AS')

    def test_foreign_key_types_orphans_nullable_composite_and_order(self):
        for child_type, value, invalid in [('INT','999',True), ('VARCHAR(10)',"'1'",True), ('INT','1',False), ('INT','NULL',False)]:
            tables = analyze_sql(f'CREATE TABLE P(Id INT PRIMARY KEY); CREATE TABLE H(Id INT PRIMARY KEY, Pid {child_type}, FOREIGN KEY(Pid) REFERENCES P(Id)); INSERT INTO P VALUES(1); INSERT INTO H VALUES(1,{value});')['tables']
            self.assertEqual(bool(tables[1]['issues']), invalid)
        sql = 'CREATE TABLE P(A INT, B INT, PRIMARY KEY(A,B)); CREATE TABLE H(Id INT PRIMARY KEY, X INT, Y INT, FOREIGN KEY(X,Y) REFERENCES P(B,A)); INSERT INTO P VALUES(1,2); INSERT INTO H VALUES(1,2,1),(2,99,NULL);'
        self.assertEqual(analyze_sql(sql)['tables'][1]['issues'], [])

    def test_foreign_key_collation_and_lengths(self):
        sql = "CREATE TABLE P(C VARCHAR(10) PRIMARY KEY); CREATE TABLE H(Id INT PRIMARY KEY, C VARCHAR(20), FOREIGN KEY(C) REFERENCES P(C)); INSERT INTO P VALUES('a'); INSERT INTO H VALUES(1,'A');"
        self.assertEqual(analyze_sql(sql)['tables'][1]['issues'], [])

    def test_incomplete_parent_does_not_prove_orphan(self):
        sql = 'CREATE TABLE P(Id INT PRIMARY KEY); CREATE TABLE H(Id INT PRIMARY KEY, Pid INT REFERENCES P(Id)); INSERT INTO P SELECT 1; INSERT INTO H VALUES(1,1);'
        t = analyze_sql(sql)['tables'][1]
        self.assertEqual(t['issues'], [])
        self.assertTrue(t['profile']['comparisonIssues'])


if __name__ == '__main__':
    unittest.main()
