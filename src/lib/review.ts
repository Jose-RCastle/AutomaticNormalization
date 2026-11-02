import { FD, Table } from './models';
export interface ReviewDecisions {
  acceptedRules?: FD[];
  rejectedRules?: string[];
  primaryKey?: string[];
  syntheticKey?: boolean;
  rulesComplete?: boolean;
  lists?: { column: string; separator: string; unique?: boolean }[];
  scalarColumns?: string[];
  uniqueGroups?: string[];
  atomicConfirmed?: boolean;
}
export const ruleId = (f: FD) =>
  [...f.left].sort().join('\u0001') + '→' + [...f.right].sort().join('\u0001');
export function recommendedRules(table: Table, observed: FD[]) {
  const singles = observed.filter((f) => f.left.length === 1);
  const attrs = table.columns.map((c) => c.name);
  const reach = (name: string) => {
    const set = new Set([name]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const f of singles)
        if (set.has(f.left[0]))
          for (const a of f.right)
            if (!set.has(a)) {
              set.add(a);
              changed = true;
            }
    }
    return set;
  };
  const closures = new Map(attrs.map((a) => [a, reach(a)]));
  const score = (n: string) => [
    table.primaryKey.includes(n) ? 0 : 1,
    /^(id|cod|num|code|key)_/i.test(n) || /(id|number|ssn)$/i.test(n) ? 0 : 1,
    attrs.indexOf(n),
  ];
  const compare = (a: string, b: string) => {
    const x = score(a),
      y = score(b);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i];
    return 0;
  };
  return singles.filter((f) => {
    const equivalents = attrs
      .filter((a) => closures.get(a)!.has(f.left[0]) && closures.get(f.left[0])!.has(a))
      .sort(compare);
    return equivalents[0] === f.left[0];
  });
}
