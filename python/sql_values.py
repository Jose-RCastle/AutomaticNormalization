"""Bounded SQL Server equality model; unsupported comparisons are never certified."""
import re
from decimal import Decimal, InvalidOperation

DEFAULT_COLLATION = 'Latin1_General_100_CI_AS'
TEXT = re.compile(r'^(?:N?VARCHAR|N?CHAR|TEXT|NTEXT)\b', re.I)


def comparison_value(column, value):
    if value is None:
        return None
    kind = column['type'].upper()
    if TEXT.match(kind):
        collation = column.get('collation', '').upper()
        # SQL Server ignores trailing spaces in equality comparisons.
        value = str(value).rstrip(' ')
        if re.fullmatch(r'LATIN1_GENERAL_(?:100_)?BIN2(?:_UTF8)?', collation):
            return value
        if re.fullmatch(r'(?:LATIN1_GENERAL_(?:100_)?|SQL_LATIN1_GENERAL_CP1_)(?:CI|CS)_(?:AI|AS)(?:_SC)?(?:_UTF8)?', collation):
            # Linguistic Unicode weights are engine/version specific. Do not
            # approximate them with casefold/NFKD and claim SQL equivalence.
            if not value.isascii():
                raise ValueError(f"{column['name']}: la comparación Unicode de {collation} necesita validación en SQL Server.")
            return value.lower() if '_CI_' in collation else value
        raise ValueError(f"{column['name']}: intercalación {collation or 'no definida'} no verificada; indica COLLATE compatible o valida en SQL Server.")
    if re.match(r'^(?:TINYINT|SMALLINT|INT|INTEGER|BIGINT|DECIMAL|NUMERIC|MONEY|SMALLMONEY|BIT)\b', kind):
        try:
            number = Decimal(value)
            if not number.is_finite():
                raise InvalidOperation
            return str(number.normalize()) if number else '0'
        except InvalidOperation:
            raise ValueError(f"{column['name']}: literal incompatible con {kind}.")
    return value


def comparison_rows(table, rows):
    result, limitations = [], set()
    for row in rows:
        converted = {}
        for column in table['columns']:
            name = column['name']
            try:
                converted[name] = comparison_value(column, row[name])
            except ValueError as error:
                limitations.add(str(error))
                converted[name] = row[name]
        result.append(converted)
    return result, sorted(limitations)


def compatible_types(left, right):
    def signature(column):
        value = re.sub(r'\s+', '', column['type'].upper())
        value = re.sub(r'^INTEGER\b', 'INT', value)
        value = re.sub(r'^NUMERIC\b', 'DECIMAL', value)
        if value == 'DECIMAL':
            value = 'DECIMAL(18,0)'
        value = re.sub(r'^DECIMAL\((\d+)\)$', r'DECIMAL(\1,0)', value)
        # SQL Server permits different string lengths in corresponding FK columns.
        return re.sub(r'^(N?VARCHAR|N?CHAR|VARBINARY|BINARY)\(\d+\)$', r'\1', value)
    if signature(left) != signature(right):
        return False
    if TEXT.match(left['type']):
        return left.get('collation', '').upper() == right.get('collation', '').upper()
    return True


def record_issues(table, rows):
    issues = []
    for row in rows:
        if any(not c['nullable'] and row[c['name']] is None and not c.get('computed') for c in table['columns']):
            issues.append('Hay NULL o columnas omitidas en atributos NOT NULL. Revisa los registros.')
            break
    compared, limitations = comparison_rows(table, rows)
    if not limitations:
        for key in [table['primaryKey'], *table.get('uniqueKeys', [])]:
            if key and len({tuple(r[n] for n in key) for r in compared}) != len(rows):
                issues.append('Los registros contradicen una clave declarada.')
    return issues
