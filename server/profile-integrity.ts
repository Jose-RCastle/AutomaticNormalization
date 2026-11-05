import { ParsedTable } from '../src/lib/automatic';
import { relationshipProblems } from '../src/lib/validation';

/** Missing parents are contradictions only when the parent profile is complete. */
export function validateProfileReferences(tables: ParsedTable[]) {
  const structureErrors = relationshipProblems(tables);
  for (const table of tables) {
    table.issues = [
      ...new Set([
        ...(table.issues || []),
        ...structureErrors.filter((e) => e.startsWith(table.name + ':')),
      ]),
    ];
    if (!table.profile) continue;
    for (const fk of table.foreignKeys) {
      const target = tables.find((t) => t.name === fk.table);
      if (!target || table.profile.comparisonIssues?.length) continue;
      const rows = table.profile.comparisonRows || table.profile.sampleRows || [];
      const parent = target.profile;
      const complete =
        parent &&
        !parent.sampled &&
        !parent.comparisonIssues?.length &&
        (parent.comparisonRows || parent.sampleRows || []).length === parent.rowCount;
      const parents = new Set(
        (parent?.comparisonRows || parent?.sampleRows || []).map((r) =>
          JSON.stringify(fk.references.map((n) => r[n])),
        ),
      );
      if (
        rows.some(
          (r) =>
            fk.columns.every((n) => r[n] != null) &&
            !parents.has(JSON.stringify(fk.columns.map((n) => r[n]))),
        )
      ) {
        if (complete)
          table.issues.push('Registros huérfanos: FK sin fila de destino en ' + fk.table);
        else
          (table.profile.comparisonIssues ||= []).push(
            'No se puede verificar la FK a ' +
              fk.table +
              ': los registros del destino están incompletos.',
          );
      }
    }
  }
}
