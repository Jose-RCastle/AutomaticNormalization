"""SQLGlot interpreta SQL; nunca ejecutamos sentencias de la entrada."""
import itertools
import json
import re
import sys
import sqlglot
from sqlglot import exp, ErrorLevel

MAX_ROWS = 5000


def table_name(node):
    return '.'.join(part.name for part in node.parts)


def columns(node):
    return [item.name for item in node.expressions]


def constraint(table, node, column=None):
    if isinstance(node, exp.Constraint):
        for item in node.expressions:
            constraint(table, item)
    elif isinstance(node, (exp.PrimaryKey, exp.PrimaryKeyColumnConstraint)):
        table['primaryKey'] = [column] if column else columns(node)
    elif isinstance(node, exp.UniqueColumnConstraint):
        table['uniqueKeys'].append([column] if column else columns(node.this))
    elif isinstance(node, (exp.ForeignKey, exp.Reference)):
        reference = node if isinstance(node, exp.Reference) else node.args['reference']
        table['foreignKeys'].append({'columns': [column] if column else columns(node),
                                    'table': table_name(reference.this.this),
                                    'references': columns(reference.this)})
    elif isinstance(node, (exp.NotNullColumnConstraint, exp.GeneratedAsIdentityColumnConstraint)):
        return
    else:
        table['warnings'].append(f'Restricción no trasladada: {node.sql(dialect="tsql")}')


def add_column(table, node):
    kind = node.args.get('kind')
    if kind is None:
        raise ValueError('Columnas calculadas sin tipo requieren revisión.')
    table['columns'].append({'name': node.name, 'type': kind.sql(dialect='tsql'),
                             'nullable': not any(isinstance(c.kind, (exp.NotNullColumnConstraint, exp.PrimaryKeyColumnConstraint)) for c in node.constraints)})
    for c in node.constraints:
        constraint(table, c.kind, node.name)


def value(node):
    if isinstance(node, exp.Null):
        return None
    if isinstance(node, (exp.Literal, exp.National)):
        return str(node.this)
    if isinstance(node, exp.Neg) and isinstance(node.this, exp.Literal):
        return '-' + str(node.this.this)
    raise ValueError('INSERT admite solo literales y NULL; no se ejecutan expresiones ni consultas.')


def profile(table, rows):
    names = [c['name'] for c in table['columns']]
    nulls = {name: sum(row[name] is None for row in rows) for name in names}
    observed = []
    # Explorar determinantes acotados es una ayuda empírica, nunca una prueba semántica.
    if len(rows) >= 3 and len(names) <= 16:
        for size in range(1, min(3, len(names)) + 1):
            for left in itertools.combinations(names, size):
                if any(nulls[n] for n in left):
                    continue
                buckets = {}
                for row in rows:
                    buckets.setdefault(tuple(row[n] for n in left), []).append(row)
                if len(buckets) == len(rows) or len(buckets) < 2:
                    continue  # Evitar reglas vacías de evidencia: claves accidentales o constantes.
                for right in names:
                    if right in left or nulls[right]:
                        continue
                    if any(set(fd['left']).issubset(left) and fd['right'] == [right] for fd in observed):
                        continue
                    if all(len({r[right] for r in group}) == 1 for group in buckets.values()):
                        observed.append({'left': list(left), 'right': [right]})
    return {'rowCount': len(rows), 'nulls': nulls,
            'duplicateRows': len(rows) - len({tuple(row[n] for n in names) for row in rows}),
            'observedRules': observed,
            'search': 'Determinantes de hasta 3 atributos; máximo 16 columnas. No incluye NULL, constantes o determinantes únicos en la muestra.'}


def analyze_sql(sql):
    if len(sql.encode('utf-8')) > 50 * 1024 * 1024:
        raise ValueError('El límite de entrada es 50 MiB.')
    # Tokenizar antes de quitar GO evita alterar literales y comentarios multilínea.
    chars = list(sql)
    for token in sqlglot.tokenize(sql, read='tsql'):
        if token.text.upper() == 'GO' and re.fullmatch(r'\s*GO\s*', sql.splitlines()[token.line - 1], re.I):
            chars[token.start:token.end + 1] = ' ' * (token.end - token.start + 1)
    statements = sqlglot.parse(''.join(chars), read='tsql', error_level=ErrorLevel.RAISE)
    tables, inserts, alters, warnings = {}, [], [], []
    for statement in statements:
        if statement is None:
            continue
        if isinstance(statement, exp.Create) and statement.args.get('kind') == 'TABLE':
            schema = statement.this
            if not isinstance(schema, exp.Schema):
                raise ValueError('CREATE TABLE AS no está soportado; usa columnas explícitas.')
            name = table_name(schema.this)
            if name.casefold() in tables:
                raise ValueError(f'Tabla duplicada: {name}')
            table = {'name': name, 'sqlName': [p.name for p in schema.this.parts], 'columns': [], 'primaryKey': [], 'uniqueKeys': [], 'foreignKeys': [], 'warnings': [], 'issues': []}
            for node in schema.expressions:
                if isinstance(node, exp.ColumnDef):
                    add_column(table, node)
                else:
                    constraint(table, node)
            tables[name.casefold()] = table
        elif isinstance(statement, exp.Insert):
            inserts.append(statement)
        elif isinstance(statement, exp.Alter):
            alters.append(statement)
        elif isinstance(statement, (exp.Use, exp.Set, exp.Create)):
            warnings.append(f'Instrucción omitida: {statement.key}. Solo se analizan estructuras e INSERT literales.')
        else:
            raise ValueError(f'Instrucción no soportada para análisis seguro: {statement.sql(dialect="tsql")[:100]}')
    if not tables:
        raise ValueError('No se encontraron tablas CREATE TABLE.')
    if len(tables) > 1000:
        raise ValueError('El límite es de 1000 tablas.')
    for statement in alters:
        name = table_name(statement.this)
        if name.casefold() not in tables:
            raise ValueError(f'ALTER sobre tabla desconocida: {name}')
        table = tables[name.casefold()]
        for action in statement.args['actions']:
            if isinstance(action, exp.AddConstraint):
                for node in action.expressions:
                    constraint(table, node)
            elif isinstance(action, exp.ColumnDef):
                add_column(table, action)
            else:
                raise ValueError(f'ALTER no soportado: {action.sql(dialect="tsql")}')
    data = {name: [] for name in tables}
    for statement in inserts:
        target = statement.this
        explicit = isinstance(target, exp.Schema)
        name = table_name(target.this if explicit else target).casefold()
        if name not in tables:
            raise ValueError('INSERT sobre tabla no definida.')
        names = columns(target) if explicit else [c['name'] for c in tables[name]['columns']]
        lookup = {c['name'].casefold(): c['name'] for c in tables[name]['columns']}
        if len(set(n.casefold() for n in names)) != len(names) or any(n.casefold() not in lookup for n in names):
            raise ValueError('Lista de columnas INSERT inválida.')
        names = [lookup[n.casefold()] for n in names]
        if not isinstance(statement.expression, exp.Values):
            raise ValueError('No se ejecutan INSERT SELECT; usa VALUES literales.')
        for row in statement.expression.expressions:
            if len(row.expressions) != len(names):
                raise ValueError('INSERT tiene distinto número de columnas y valores.')
            record = dict.fromkeys(lookup.values())
            record.update(zip(names, map(value, row.expressions)))
            data[name].append(record)
            if len(data[name]) > MAX_ROWS:
                raise ValueError('El perfil admite hasta 5000 filas por tabla; no se analizan muestras truncadas.')
    for key, table in tables.items():
        names = [c['name'] for c in table['columns']]
        if len(names) > 256 or len({n.casefold() for n in names}) != len(names):
            raise ValueError('Columnas duplicadas o más de 256 columnas.')
        lookup = {n.casefold(): n for n in names}
        for field in ['primaryKey', 'uniqueKeys']:
            keys = [table[field]] if field == 'primaryKey' else table[field]
            for k in keys:
                if any(n.casefold() not in lookup for n in k):
                    raise ValueError('Clave con columna inexistente.')
                k[:] = [lookup[n.casefold()] for n in k]
        for c in table['columns']:
            if c['name'] in table['primaryKey']:
                c['nullable'] = False
        for row in data[key]:
            if any(not c['nullable'] and row[c['name']] is None for c in table['columns']):
                table['issues'].append('Hay NULL o columnas omitidas en atributos NOT NULL. Revisa los INSERT.')
        for k in [table['primaryKey'], *table['uniqueKeys']]:
            if not k:
                continue
            seen = set()
            for row in data[key]:
                values = tuple(row[n] for n in k)
                if values in seen:
                    table['issues'].append('Los INSERT contradicen una clave declarada.')
                seen.add(values)
        table['issues'] = list(set(table['issues']))
        table['profile'] = profile(table, data[key])
        table['profile']['possibleLists'] = [n for n in names if any(isinstance(row[n], str) and any(delimiter in row[n] for delimiter in [',', ';', '|']) for row in data[key])]
        table['rules'] = []
    # Anotaciones opcionales transportan reglas del dominio con el propio archivo.
    for token in sqlglot.tokenize(sql, read='tsql'):
        for comment in token.comments:
            for line in comment.splitlines():
                match = re.fullmatch(r'\s*@fd\s+([^:]+):\s*(.+?)\s*', line)
                if match:
                    name, rule = match.groups()
                    if name.strip().casefold() not in tables:
                        raise ValueError('Anotación @fd para tabla desconocida.')
                    tables[name.strip().casefold()]['rules'].append(rule)
    for key, table in tables.items():
        # Contrastar reglas explícitas con las filas presentes. Una contradicción bloquea.
        lookup = {c['name'].casefold(): c['name'] for c in table['columns']}
        for rule in table['rules']:
            sides = re.split(r'->|→', rule)
            if len(sides) != 2:
                raise ValueError('Usa @fd Tabla: columnas -> columnas.')
            resolved = []
            for side in sides:
                expressions = sqlglot.parse_one('SELECT ' + side, read='tsql').expressions
                if not expressions or any(not isinstance(e, exp.Column) or len(e.parts) != 1 or e.name.casefold() not in lookup for e in expressions):
                    raise ValueError('Regla @fd con columna desconocida o expresión inválida.')
                resolved.append([lookup[e.name.casefold()] for e in expressions])
            left, right = resolved
            seen = {}
            for row in data[key]:
                if any(row[n] is None for n in left + right):
                    continue
                determinant = tuple(row[n] for n in left)
                dependent = tuple(row[n] for n in right)
                if determinant in seen and seen[determinant] != dependent:
                    table['issues'].append(f'Los INSERT contradicen la regla declarada: {rule}')
                seen[determinant] = dependent
        for fk in table['foreignKeys']:
            target = tables.get(fk['table'].casefold())
            if target is None:
                matches = [t for t in tables.values() if t['sqlName'][-1].casefold() == fk['table'].casefold()]
                target = matches[0] if len(matches) == 1 else None
            if target:
                fk['table'] = target['name']
                target_columns = {c['name'].casefold(): c['name'] for c in target['columns']}
                if any(n.casefold() not in target_columns for n in fk['references']):
                    table['issues'].append('Referencia a columna inexistente.')
                else:
                    fk['references'] = [target_columns[n.casefold()] for n in fk['references']]
            if any(n.casefold() not in lookup for n in fk['columns']):
                table['issues'].append('Clave foránea con columna inexistente.')
            else:
                fk['columns'] = [lookup[n.casefold()] for n in fk['columns']]
            if len(fk['columns']) != len(fk['references']):
                table['issues'].append('Referencia con distinta cantidad de columnas.')
    return {'tables': list(tables.values()), 'warnings': warnings, 'parser': f'SQLGlot {sqlglot.__version__} · T-SQL'}


if __name__ == '__main__':
    try:
        print(json.dumps(analyze_sql(sys.stdin.read()), ensure_ascii=False))
    except Exception as error:
        print(json.dumps({'error': str(error)}, ensure_ascii=False))
        sys.exit(1)
