import { identifier, tokenize } from './sql/lexer';
import { FD, Table } from './models';
export const unique = (values: string[]) => [...new Set(values)];
export const subset = (small: string[], large: string[]) =>
  small.every((value) => large.includes(value));

/** Una búsqueda exacta puede ser exponencial. Nunca devolvemos claves aproximadas. */
export class AnalysisLimitError extends Error {
  constructor() {
    super(
      'El conjunto de reglas supera el presupuesto de 25 000 combinaciones. Reduce la tabla de trabajo o simplifica sus dependencias. No se ha emitido un diagnóstico parcial.',
    );
  }
}
class Budget {
  private remaining = 25_000;
  visit() {
    if (--this.remaining < 0) throw new AnalysisLimitError();
  }
}
export function closure(attributes: string[], dependencies: FD[]): string[] {
  const result = new Set(attributes);
  let changed = true;
  while (changed) {
    changed = false;
    for (const rule of dependencies) {
      if (!rule.left.every((attribute) => result.has(attribute))) continue;
      for (const attribute of rule.right)
        if (!result.has(attribute)) {
          result.add(attribute);
          changed = true;
        }
    }
  }
  return [...result];
}
export function cover(dependencies: FD[]): FD[] {
  const rules = dependencies.flatMap((rule) =>
    rule.right
      .filter((a) => !rule.left.includes(a))
      .map((a) => ({ left: [...rule.left], right: [a] })),
  );
  // Primero reducimos los determinantes; después eliminamos reglas redundantes.
  for (const rule of rules)
    for (const attribute of [...rule.left]) {
      const smaller = rule.left.filter((a) => a !== attribute);
      if (subset(rule.right, closure(smaller, rules))) rule.left = smaller;
    }
  for (let i = rules.length - 1; i >= 0; i--) {
    if (
      subset(
        rules[i].right,
        closure(
          rules[i].left,
          rules.filter((_, j) => j !== i),
        ),
      )
    )
      rules.splice(i, 1);
  }
  return rules;
}
export function candidateKeys(attributes: string[], rules: FD[]): string[][] {
  const rhs = unique(rules.flatMap((rule) => rule.right));
  const mandatory = attributes.filter((a) => !rhs.includes(a));
  const determinants = unique(rules.flatMap((rule) => rule.left));
  const optional = attributes.filter((a) => !mandatory.includes(a) && determinants.includes(a));
  const keys: string[][] = [],
    budget = new Budget();
  // Los atributos ausentes de todos los consecuentes son obligatorios en cada clave.
  function search(current: string[], start: number) {
    budget.visit();
    if (keys.some((key) => subset(key, current))) return;
    const reached = closure(current, rules);
    if (subset(attributes, reached)) {
      const minimal = [...current];
      for (const attribute of [...minimal])
        if (
          subset(
            attributes,
            closure(
              minimal.filter((a) => a !== attribute),
              rules,
            ),
          )
        )
          minimal.splice(minimal.indexOf(attribute), 1);
      if (!keys.some((key) => subset(key, minimal))) {
        for (let i = keys.length - 1; i >= 0; i--) if (subset(minimal, keys[i])) keys.splice(i, 1);
        keys.push(minimal);
      }
      return;
    }
    for (let i = start; i < optional.length; i++) {
      // Un atributo ya alcanzable no mejora la clausura de este determinante.
      if (!reached.includes(optional[i])) search([...current, optional[i]], i + 1);
    }
  }
  search(mandatory, 0);
  return keys.sort((a, b) => a.length - b.length || a.join(',').localeCompare(b.join(',')));
}
function subsets(attributes: string[], visit: (attributes: string[]) => void, budget: Budget) {
  function walk(current: string[], start: number) {
    budget.visit();
    visit(current);
    for (let i = start; i < attributes.length; i++) walk([...current, attributes[i]], i + 1);
  }
  walk([], 0);
}
export function projection(attributes: string[], rules: FD[]): FD[] {
  if (rules.every((rule) => subset([...rule.left, ...rule.right], attributes))) return cover(rules);
  const determinants = attributes.filter((a) => rules.some((rule) => rule.left.includes(a)));
  const projected: FD[] = [],
    budget = new Budget();
  subsets(
    determinants,
    (left) => {
      const right = closure(left, rules).filter((a) => attributes.includes(a) && !left.includes(a));
      if (right.length) projected.push({ left, right });
    },
    budget,
  );
  return cover(projected);
}
export function dependencies(table: Table, explicit: FD[]): FD[] {
  const attributes = table.columns.map((c) => c.name);
  const declaredKeys = [
    table.primaryKey,
    ...(table.uniqueKeys || []).filter((key) =>
      key.every((a) => table.columns.some((c) => c.name === a && !c.nullable)),
    ),
  ].filter((key) => key.length);
  return cover([...explicit, ...declaredKeys.map((left) => ({ left, right: attributes }))]);
}
export function parseDependencies(text: string, table: Table): FD[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line, index) => {
      const tokens = [...tokenize(line)];
      const arrows = tokens
        .map((token, i) =>
          token.kind === 'symbol' &&
          (token.value === '→' || (token.value === '-' && tokens[i + 1]?.value === '>'))
            ? i
            : -1,
        )
        .filter((i) => i >= 0);
      if (arrows.length !== 1) throw Error(`Regla ${index + 1}: usa columnas -> columnas.`);
      const arrow = arrows[0],
        width = tokens[arrow].value === '→' ? 1 : 2;
      const resolve = (side: typeof tokens) => {
        if (!side.length) throw Error(`Regla ${index + 1}: ambos lados necesitan columnas.`);
        const names: string[] = [];
        for (let i = 0; i < side.length; i++) {
          if (i % 2 === 1) {
            if (side[i].value !== ',')
              throw Error(`Regla ${index + 1}: separa las columnas con comas.`);
            continue;
          }
          if (!identifier(side[i]))
            throw Error(`Regla ${index + 1}: usa corchetes para nombres especiales.`);
          const name = side[i].value;
          const column = table.columns.find((c) => c.name.toLowerCase() === name.toLowerCase());
          if (!column) throw Error(`Regla ${index + 1}: columna desconocida «${name}».`);
          names.push(column.name);
        }
        if (side.length % 2 === 0)
          throw Error(`Regla ${index + 1}: falta una columna después de la coma.`);
        return unique(names);
      };
      return { left: resolve(tokens.slice(0, arrow)), right: resolve(tokens.slice(arrow + width)) };
    });
}
export function analyze(table: Table, rules: FD[], atomic: boolean) {
  const attributes = table.columns.map((c) => c.name),
    keys = candidateKeys(attributes, rules),
    prime = unique(keys.flat());
  const partial: FD[] = [],
    transitive: FD[] = [],
    budget = new Budget();
  // Para 3FN basta comprobar una cubierta equivalente. Para 2FN buscamos
  // determinantes propios de todas las claves, incluidas las alternativas.
  for (const rule of cover(rules)) {
    const right = rule.right.filter((a) => !prime.includes(a));
    if (right.length && !subset(attributes, closure(rule.left, rules)))
      transitive.push({ left: rule.left, right });
  }
  const seen = new Set<string>();
  for (const key of transitive.length ? keys : [])
    subsets(
      key,
      (left) => {
        if (left.length === key.length) return;
        const signature = [...left].sort().join('\0');
        if (seen.has(signature)) return;
        seen.add(signature);
        const right = closure(left, rules).filter((a) => !left.includes(a) && !prime.includes(a));
        if (right.length) partial.push({ left, right });
      },
      budget,
    );
  return {
    keys,
    partial,
    transitive,
    form: !atomic
      ? 'Sin confirmar 1FN'
      : partial.length
        ? '1FN'
        : transitive.length
          ? '2FN'
          : '3FN',
  };
}
