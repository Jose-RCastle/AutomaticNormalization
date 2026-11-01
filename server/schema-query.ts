// Only catalog queries and SELECTs are executed against a connected database.
export const SCHEMA_QUERY = `
SELECT s.name AS schemaName, t.name AS tableName, c.name AS columnName, ty.name AS typeName,
 c.max_length, c.precision, c.scale, c.is_nullable, ISNULL(ic.key_ordinal,0) AS keyOrdinal,
 c.is_computed, ty.is_user_defined, SCHEMA_NAME(ty.schema_id) AS typeSchema,
 c.collation_name AS collation, dc.definition AS defaultExpression,
 cc.definition AS computedExpression, cc.is_persisted,
 CONVERT(varchar(100), id.seed_value) AS identityStart, CONVERT(varchar(100), id.increment_value) AS identityStep
FROM sys.tables t JOIN sys.schemas s ON s.schema_id=t.schema_id
JOIN sys.columns c ON c.object_id=t.object_id JOIN sys.types ty ON ty.user_type_id=c.user_type_id
LEFT JOIN sys.indexes ix ON ix.object_id=t.object_id AND ix.is_primary_key=1 AND ix.is_disabled=0
LEFT JOIN sys.index_columns ic ON ic.object_id=t.object_id AND ic.index_id=ix.index_id AND ic.column_id=c.column_id
LEFT JOIN sys.identity_columns id ON id.object_id=t.object_id AND id.column_id=c.column_id
LEFT JOIN sys.default_constraints dc ON dc.object_id=c.default_object_id
LEFT JOIN sys.computed_columns cc ON cc.object_id=t.object_id AND cc.column_id=c.column_id
WHERE t.is_ms_shipped=0 ORDER BY s.name,t.name,c.column_id;
SELECT s.name AS schemaName,t.name AS tableName,f.name AS fkName,c.name AS columnName,
 rs.name AS refSchema,rt.name AS refTable,rc.name AS refColumn,
 f.delete_referential_action_desc AS onDelete, f.update_referential_action_desc AS onUpdate
FROM sys.foreign_key_columns fc JOIN sys.foreign_keys f ON f.object_id=fc.constraint_object_id
JOIN sys.tables t ON t.object_id=fc.parent_object_id JOIN sys.schemas s ON s.schema_id=t.schema_id
JOIN sys.columns c ON c.object_id=t.object_id AND c.column_id=fc.parent_column_id
JOIN sys.tables rt ON rt.object_id=fc.referenced_object_id JOIN sys.schemas rs ON rs.schema_id=rt.schema_id
JOIN sys.columns rc ON rc.object_id=rt.object_id AND rc.column_id=fc.referenced_column_id
WHERE f.is_disabled=0 ORDER BY f.object_id,fc.constraint_column_id;
SELECT s.name AS schemaName,t.name AS tableName,ix.name AS keyName,c.name AS columnName
FROM sys.indexes ix JOIN sys.tables t ON t.object_id=ix.object_id JOIN sys.schemas s ON s.schema_id=t.schema_id
JOIN sys.index_columns ic ON ic.object_id=t.object_id AND ic.index_id=ix.index_id
JOIN sys.columns c ON c.object_id=t.object_id AND c.column_id=ic.column_id
WHERE ix.is_unique=1 AND ix.is_primary_key=0 AND ix.has_filter=0 AND ix.is_disabled=0 AND ic.key_ordinal>0
ORDER BY s.name,t.name,ix.index_id,ic.key_ordinal;
SELECT s.name AS schemaName,t.name AS tableName,cc.definition AS expression
FROM sys.check_constraints cc JOIN sys.tables t ON t.object_id=cc.parent_object_id
JOIN sys.schemas s ON s.schema_id=t.schema_id WHERE cc.is_disabled=0;
`;
