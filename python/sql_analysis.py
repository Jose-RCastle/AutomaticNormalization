"""SQLGlot interpreta SQL; nunca ejecutamos sentencias de la entrada."""
import itertools
import json
import re
import sys
import time
from decimal import Decimal, InvalidOperation
import sqlglot
from sqlglot import exp, ErrorLevel

MAX_ROWS = 10000


def table_name(node):
    return '.'.join(part.name for part in node.parts)


def columns(node):
    items = node if isinstance(node, list) else node.expressions
    return [(item.this if isinstance(item, exp.Ordered) else item).name for item in items]


def constraint(table, node, column=None):
    if isinstance(node, exp.Constraint):
        # SQLGlot represents PRIMARY KEY CLUSTERED as two sibling constraints.
        clustered = next((c for c in node.expressions if isinstance(c, (exp.ClusteredColumnConstraint, exp.NonClusteredColumnConstraint))), None)
        if clustered is not None and any(isinstance(c, exp.PrimaryKeyColumnConstraint) for c in node.expressions):
            table['primaryKey'] = columns(clustered.this)
            return
        for item in node.expressions:
            constraint(table, item, column)
    elif isinstance(node, (exp.PrimaryKey, exp.PrimaryKeyColumnConstraint)):
        table['primaryKey'] = [column] if column else columns(node)
    elif isinstance(node, exp.UniqueColumnConstraint):
        table['uniqueKeys'].append([column] if column else columns(node.this))
    elif isinstance(node, (exp.ForeignKey, exp.Reference)):
        reference = node if isinstance(node, exp.Reference) else node.args['reference']
        fk = {'columns': [column] if column else columns(node),
                                    'table': table_name(reference.this.this),
                                    'references': columns(reference.this)}
        for option in reference.args.get('options') or []:
            match = re.fullmatch(r'ON (DELETE|UPDATE) (CASCADE|SET NULL|SET DEFAULT|NO ACTION|RESTRICT)', str(option), re.I)
            if match:
                fk['on' + match[1].title()] = match[2].upper().replace('RESTRICT', 'NO ACTION')
        table['foreignKeys'].append(fk)
    elif isinstance(node, exp.CheckColumnConstraint):
        table.setdefault('checks', []).append({'expression': node.this.sql(dialect='tsql'), 'columns': list(dict.fromkeys(c.name for c in node.this.find_all(exp.Column)))})
    elif isinstance(node, (exp.NotNullColumnConstraint, exp.GeneratedAsIdentityColumnConstraint, exp.DefaultColumnConstraint, exp.CollateColumnConstraint, exp.ComputedColumnConstraint, exp.AutoIncrementColumnConstraint)):
        return
    else:
        table['warnings'].append(f'Restricción no trasladada: {node.sql(dialect="tsql")}')


def add_column(table, node):
    kind = node.args.get('kind')
    computed = next((c.kind for c in node.constraints if isinstance(c.kind, exp.ComputedColumnConstraint)), None)
    if kind is None and computed is None:
        raise ValueError('Columnas calculadas sin tipo requieren revisión.')
    col = {'name': node.name, 'type': kind.sql(dialect='tsql') if kind else 'CALCULADA',
           'nullable': not any(isinstance(c.kind, exp.PrimaryKeyColumnConstraint) or
                               (isinstance(c.kind, exp.NotNullColumnConstraint) and not c.kind.args.get('allow_null'))
                               for c in node.constraints)}
    if kind and kind.sql().upper() in ('SERIAL', 'BIGSERIAL', 'SMALLSERIAL'):
        col.update(type={'SERIAL':'INT','BIGSERIAL':'BIGINT','SMALLSERIAL':'SMALLINT'}[kind.sql().upper()], identity='IDENTITY(1,1)', nullable=False)
    for c in node.constraints:
        k = c.kind
        if isinstance(k, exp.GeneratedAsIdentityColumnConstraint):
            start, step = k.args.get('start'), k.args.get('increment')
            col['identity'] = f'IDENTITY({start.sql() if start is not None else "1"},{step.sql() if step is not None else "1"})'
            col['nullable'] = False
        elif isinstance(k, exp.AutoIncrementColumnConstraint):
            col['identity'] = 'IDENTITY(1,1)'
            col['nullable'] = False
        elif isinstance(k, exp.DefaultColumnConstraint):
            col['default'] = ('1' if k.this.this else '0') if isinstance(k.this, exp.Boolean) else k.this.sql(dialect='tsql')
        elif isinstance(k, exp.CollateColumnConstraint):
            col['collation'] = k.this.sql(dialect='tsql')
        elif isinstance(k, exp.ComputedColumnConstraint):
            col.update(computed=True, expression=k.this.sql(dialect='tsql'), persisted=bool(k.args.get('persisted')), expressionColumns=list(dict.fromkeys(c.name for c in k.this.find_all(exp.Column))))
    table['columns'].append(col)
    for c in node.constraints:
        constraint(table, c.kind, node.name)


def value(node):
    if isinstance(node, exp.Null):
        return None
    if isinstance(node, (exp.Literal, exp.National)):
        if isinstance(node, exp.Literal) and not node.is_string:
            try:
                return str(Decimal(str(node.this)).normalize())
            except InvalidOperation:
                pass
        return str(node.this)
    if isinstance(node, exp.Neg) and isinstance(node.this, exp.Literal):
        return '-' + str(node.this.this)
    if isinstance(node, (exp.Cast, exp.TryCast, exp.Paren)):
        return value(node.this)
    if isinstance(node, exp.Boolean):
        return '1' if node.this else '0'
    raise ValueError('Expresión INSERT no evaluable sin ejecutar SQL.')


def profile(table, rows, total=None):
    names = [c['name'] for c in table['columns']]
    nulls = {name: sum(row[name] is None for row in rows) for name in names}
    observed = []
    # Explorar determinantes acotados es una ayuda empírica, nunca una prueba semántica.
    # Same profiler is used for file records and records read from SQL Server.
    eligible = [n for n in names if not nulls[n] and len({r[n] for r in rows}) > 1]
    deadline, visited, limited = time.monotonic() + 8, 0, False
    if len(rows) >= 3:
        for size in range(1, min(3, len(eligible)) + 1):
            for left in itertools.combinations(eligible, size):
                visited += 1
                if visited > 10000 or time.monotonic() > deadline:
                    limited = True
                    break
                if any(nulls[n] for n in left):
                    continue
                buckets = {}
                for row in rows:
                    buckets.setdefault(tuple(row[n] for n in left), []).append(row)
                if len(buckets) == len(rows) or len(buckets) < 2:
                    continue  # Evitar reglas vacías de evidencia: claves accidentales o constantes.
                for right in eligible:
                    if right in left or nulls[right]:
                        continue
                    if any(set(fd['left']).issubset(left) and fd['right'] == [right] for fd in observed):
                        continue
                    if all(len({r[right] for r in group}) == 1 for group in buckets.values()):
                        observed.append({'left': list(left), 'right': [right], 'evidence': {'rows': len(rows), 'groups': len(buckets), 'repeatedGroups': sum(len(g) > 1 for g in buckets.values())}})
            if limited:
                break
    list_candidates = []
    for name in names:
        for separator in [',', ';', '|']:
            split_values = [r[name].split(separator) for r in rows if isinstance(r[name], str) and separator in r[name]]
            if not split_values:
                continue
            values = [v.strip() for parts in split_values for v in parts]
            email = all(re.fullmatch(r'[^\s@,;|]+@[^\s@,;|]+\.[^\s@,;|]+', v) for v in values)
            phone = all(re.fullmatch(r'[+\d() .-]+', v) and 1 <= len(re.sub(r'\D', '', v)) <= 15 for v in values)
            if email or phone:
                list_candidates.append({'column': name, 'kind': 'correos' if email else 'teléfonos', 'separator': separator})
    key_candidates = [[n] for n in names if len(rows) > 1 and not nulls[n] and len({r[n] for r in rows}) == len(rows)]
    return {'rowCount': len(rows), 'totalRows': total if total is not None else len(rows), 'sampled': total is not None and total > len(rows), 'searchLimited': limited, 'nulls': nulls,
            'sampleRows': rows[:1000], 'keyCandidates': key_candidates,
            'listCandidates': list_candidates,
            'duplicateRows': len(rows) - len({tuple(row[n] for n in names) for row in rows}),
            'observedRules': observed,
            'search': f'Determinantes de hasta 3 atributos; {visited} combinaciones examinadas. Se excluyen NULL, constantes y determinantes únicos. ' + ('Búsqueda limitada por tiempo o presupuesto; pueden faltar reglas.' if limited else 'Las dependencias observadas describen los registros examinados, no garantizan los futuros.')}


def check_rules(table, rows):
    lookup = {c['name'].casefold(): c['name'] for c in table['columns']}
    for rule in table.get('rules') or []:
        sides = re.split(r'->|→', rule)
        if len(sides) != 2:
            raise ValueError('Usa columnas -> columnas en las reglas.')
        resolved = []
        for side in sides:
            expressions = sqlglot.parse_one('SELECT ' + side, read='tsql').expressions
            if not expressions or any(not isinstance(e, exp.Column) or len(e.parts) != 1 or e.name.casefold() not in lookup for e in expressions):
                raise ValueError('Regla con columna desconocida o expresión inválida: ' + rule)
            resolved.append([lookup[e.name.casefold()] for e in expressions])
        left, right = resolved
        seen = {}
        for row in rows:
            if any(row[n] is None for n in left + right):
                continue
            determinant, dependent = tuple(row[n] for n in left), tuple(row[n] for n in right)
            if determinant in seen and seen[determinant] != dependent:
                table.setdefault('issues', []).append(f'Los registros contradicen la regla declarada: {rule}')
                break
            seen[determinant] = dependent


def analyze_sql(sql, dialect='tsql', domain_rules=None):
    if len(sql.encode('utf-8')) > 50 * 1024 * 1024:
        raise ValueError('El límite de entrada es 50 MiB.')
    # Tokenizar antes de quitar GO evita alterar literales y comentarios multilínea.
    if dialect not in ('tsql', 'postgres', 'mysql', 'sqlite'):
        raise ValueError('Dialecto SQL desconocido.')
    chars, lines = list(sql), sql.splitlines()
    boundaries = [0]
    tokens = sqlglot.tokenize(sql, read=dialect)
    for token in tokens:
        if token.text.upper() == 'GO' and re.fullmatch(r'\s*GO\s*(?:--.*)?', lines[token.line - 1], re.I):
            boundaries.extend([token.start,token.end+1])
            chars[token.start:token.end + 1] = ' ' * (token.end - token.start + 1)
        if token.text.upper() in ('CLUSTERED', 'NONCLUSTERED') and token.token_type.name not in ('IDENTIFIER', 'STRING', 'NATIONAL_STRING'):
            chars[token.start:token.end + 1] = ' ' * (token.end - token.start + 1)
    prepared=''.join(chars)
    boundaries.append(len(prepared))
    statements, warnings = [], []
    for start,end in zip(boundaries,boundaries[1:]):
        batch=prepared[start:end]
        meaningful=re.sub(r'/\*.*?\*/|--[^\n]*',' ',batch,flags=re.S).strip()
        if not meaningful:
            continue
        if re.match(r'CREATE\s+(?:OR\s+ALTER\s+)?(?:TRIGGER|PROC(?:EDURE)?|FUNCTION|VIEW)\b',meaningful,re.I):
            warnings.append('Módulo omitido (no se ejecuta ni se transforma): '+meaningful[:100])
            continue
        try:
            statements.extend(sqlglot.parse(batch, read=dialect,error_level=ErrorLevel.RAISE))
        except sqlglot.errors.ParseError:
            # Recover independent statements; never discover DDL inside a module body.
            parts=sqlglot.tokenize(batch,read=dialect)
            offset=0;depth=0;chunks=[]
            for token in parts:
                if token.text.upper()=='BEGIN':depth+=1
                elif token.text.upper()=='END':depth=max(0,depth-1)
                if token.token_type.name=='SEMICOLON' and not depth:
                    chunks.append(batch[offset:token.end+1]);offset=token.end+1
            chunks.append(batch[offset:])
            recovered=False
            for chunk in chunks:
                if not chunk.strip():continue
                try:
                    found=sqlglot.parse(chunk,read=dialect,error_level=ErrorLevel.RAISE)
                    statements.extend(found);recovered=recovered or any(isinstance(s,exp.Create) and s.args.get('kind')=='TABLE' for s in found if s)
                except sqlglot.errors.ParseError:
                    warnings.append('Sentencia no interpretada: '+chunk.strip()[:160])
            if not recovered and len(chunks)==1:
                warnings.append('Lote no interpretado; revisa su sintaxis y formato.')
    tables, inserts, alters, indexes, commands = {}, [], [], [], []
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
        elif isinstance(statement, exp.Create) and statement.args.get('kind') == 'INDEX':
            indexes.append(statement)
        elif isinstance(statement, exp.Command) and statement.name.upper() == 'ALTER':
            commands.append(statement)
        elif isinstance(statement, (exp.Use, exp.Set, exp.Create)):
            warnings.append(f'Instrucción omitida: {statement.key}. Solo se analizan estructuras e INSERT literales.')
        elif isinstance(statement, (exp.Select, exp.Transaction, exp.Commit, exp.Rollback)):
            warnings.append(f'Instrucción {statement.key} omitida; no modifica la estructura analizada.')
        elif isinstance(statement,exp.If) and re.search(r'OBJECT_ID\s*\(',statement.sql(dialect='tsql'),re.I) and any(statement.find_all(exp.Drop)):
            warnings.append('Limpieza condicional IF OBJECT_ID / DROP omitida: se analiza el CREATE posterior sin ejecutar cambios.')
            for drop in statement.find_all(exp.Drop):
                for target in drop.args.get('tables') or [drop.this]:
                    if isinstance(target,exp.Table) and table_name(target).casefold() in tables:
                        tables[table_name(target).casefold()]['issues'].append('DROP condicional posterior al CREATE: revisa el estado final de esta tabla.')
        elif isinstance(statement,exp.Drop):
            for target in statement.args.get('tables') or [statement.this]:
                if not isinstance(target,exp.Table):
                    warnings.append('DROP no ejecutado: '+statement.sql(dialect='tsql'));continue
                name=table_name(target)
                if name.casefold() in tables:
                    tables[name.casefold()]['issues'].append('DROP posterior al CREATE: la estructura final requiere revisión; no se ejecutó la eliminación.')
                else:
                    warnings.append('DROP previo al CREATE omitido sin ejecutar cambios: '+name)
        else:
            warnings.append(f'Instrucción no ejecutada ni analizada: {statement.sql(dialect="tsql")[:150]}')
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
                table['issues'].append(f'ALTER no interpretado modifica esta tabla: {action.sql(dialect="tsql")}. Revisa su estructura antes de transformar.')
    for statement in commands:
        raw = statement.sql(dialect='tsql')
        if re.search(r'\b(?:NO)?CHECK\s+CONSTRAINT\b', raw, re.I):
            warnings.append('La activación de restricciones se omite; se conserva su definición.')
            continue
        # DEFAULT ... FOR is not represented by SQLGlot's ALTER AST.
        parts = sqlglot.tokenize(raw, read='tsql')
        default = next((i for i,t in enumerate(parts) if t.text.upper() == 'DEFAULT'), -1)
        end = next((i for i,t in enumerate(parts) if i > default and t.text.upper() == 'FOR'), -1)
        add = next((i for i,t in enumerate(parts) if t.text.upper() == 'ADD'), -1)
        if default > add > 1 and end > default and end + 1 < len(parts):
            target_name = '.'.join(t.text for t in parts[2:add] if t.text != '.').casefold()
            target = tables.get(target_name)
            col = next((c for c in target['columns'] if c['name'].casefold() == parts[end+1].text.casefold()), None) if target else None
            if col:
                col['default'] = raw[parts[default+1].start:parts[end-1].end+1]
                continue
        raise ValueError(f'ALTER no reconocido: {raw[:150]}')
    for statement in indexes:
        index = statement.this
        target = tables.get(table_name(index.args['table']).casefold())
        params = index.args.get('params')
        if target and statement.args.get('unique') and not params.args.get('where'):
            key = columns(params.args.get('columns') or [])
            if key and all(key):
                target['uniqueKeys'].append(key)
                continue
        warnings.append('Índice físico o filtrado no trasladado: ' + statement.sql(dialect='tsql'))
    data = {name: [] for name in tables}
    totals = dict.fromkeys(tables, 0)
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
            tables[name]['warnings'].append('INSERT SELECT no ejecutado: el diagnóstico de datos no incluye sus filas.')
            continue
        for row in statement.expression.expressions:
            if len(row.expressions) != len(names):
                raise ValueError('INSERT tiene distinto número de columnas y valores.')
            record = dict.fromkeys(lookup.values())
            try:
                record.update(zip(names, map(value, row.expressions)))
            except ValueError:
                tables[name]['warnings'].append('INSERT con expresiones no evaluables: fila excluida del perfil. Usa la conexión SQL Server para analizar sus valores reales.')
                continue
            # Known identity/default values are interpreted without executing expressions.
            for c in tables[name]['columns']:
                if c['name'] in names:
                    continue
                if c.get('identity'):
                    start, step = map(int, re.findall(r'-?\d+', c['identity']))
                    record[c['name']] = str(start + totals[name] * step)
                elif c.get('default'):
                    try:
                        record[c['name']] = value(sqlglot.parse_one(c['default'], read='tsql'))
                    except (ValueError, sqlglot.errors.ParseError):
                        pass
            totals[name] += 1
            if len(data[name]) >= MAX_ROWS:
                continue
            data[name].append(record)
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
            if any(not c['nullable'] and row[c['name']] is None and not c.get('computed') and not c.get('default') for c in table['columns']):
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
        table['profile'] = profile(table, data[key], totals[key])
        if totals[key] > MAX_ROWS:
            table['warnings'].append(f'Perfil de las primeras {MAX_ROWS} de {totals[key]} filas literales. Las reglas son hipótesis de esa muestra.')
        table['profile']['possibleLists'] = [n for n in names if any(isinstance(row[n], str) and any(delimiter in row[n] for delimiter in [',', ';', '|']) for row in data[key])]
        table['rules'] = []
    # Anotaciones opcionales transportan reglas del dominio con el propio archivo.
    for token in tokens:
        for comment in token.comments:
            for line in comment.splitlines():
                match = re.fullmatch(r'\s*@fd\s+([^:]+):\s*(.+?)\s*', line)
                if match:
                    name, rule = match.groups()
                    if name.strip().casefold() not in tables:
                        raise ValueError('Anotación @fd para tabla desconocida.')
                    tables[name.strip().casefold()]['rules'].append(rule)
    if domain_rules and (not isinstance(domain_rules, dict) or any(not isinstance(v, str) for v in domain_rules.values())):
        raise ValueError('El JSON de reglas debe asociar tablas con cadenas de dependencias.')
    for name, rules in (domain_rules or {}).items():
        if name.casefold() not in tables:
            raise ValueError('Reglas para tabla ausente: ' + name)
        tables[name.casefold()]['rules'].extend(line for line in rules.splitlines() if line.strip())
    for key, table in tables.items():
        lookup = {c['name'].casefold(): c['name'] for c in table['columns']}
        check_rules(table, data[key])
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
        table['warnings'] = list(dict.fromkeys(table['warnings']))
    label = {'tsql':'SQL Server (tsql)', 'mysql':'MySQL (mysql)', 'postgres':'PostgreSQL (postgres)', 'sqlite':'SQLite (sqlite)'}[dialect]
    return {'tables': list(tables.values()), 'warnings': warnings, 'dialect': dialect, 'parser': f'SQLGlot {sqlglot.__version__} · {label}'}


if __name__ == '__main__':
    try:
        raw = sys.stdin.read()
        if '--profile' in sys.argv:
            payload = json.loads(raw)
            check_rules(payload['table'], payload['rows'])
            output = profile(payload['table'], payload['rows'], payload.get('total'))
            output['issues'] = payload['table'].get('issues', [])
        elif '--request' in sys.argv:
            payload = json.loads(raw)
            output = analyze_sql(payload['sql'], payload.get('dialect', 'tsql'), payload.get('rules'))
        else:
            output = analyze_sql(raw, sys.argv[1] if len(sys.argv) > 1 else 'tsql')
        print(json.dumps(output, ensure_ascii=False))
    except Exception as error:
        print(json.dumps({'error': str(error)}, ensure_ascii=False))
        sys.exit(1)
