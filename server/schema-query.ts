// Consultas fijas: el SQL importado nunca se envía al motor.
export const SCHEMA_QUERY = `SELECT s.name AS schemaName, t.name AS tableName, c.name AS columnName, ty.name AS typeName, c.max_length, c.precision, c.scale, c.is_nullable,
      ISNULL(ic.key_ordinal,0) AS keyOrdinal, c.is_computed, ty.is_user_defined, SCHEMA_NAME(ty.schema_id) AS typeSchema
      FROM sys.tables t JOIN sys.schemas s ON s.schema_id=t.schema_id JOIN sys.columns c ON c.object_id=t.object_id JOIN sys.types ty ON ty.user_type_id=c.user_type_id
      LEFT JOIN sys.indexes ix ON ix.object_id=t.object_id AND ix.is_primary_key=1
      LEFT JOIN sys.index_columns ic ON ic.object_id=t.object_id AND ic.index_id=ix.index_id AND ic.column_id=c.column_id
      WHERE t.is_ms_shipped=0 ORDER BY s.name,t.name,c.column_id;
      SELECT s.name AS schemaName,t.name AS tableName,f.name AS fkName,c.name AS columnName,rs.name AS refSchema,rt.name AS refTable,rc.name AS refColumn
      FROM sys.foreign_key_columns fc JOIN sys.foreign_keys f ON f.object_id=fc.constraint_object_id
      JOIN sys.tables t ON t.object_id=fc.parent_object_id JOIN sys.schemas s ON s.schema_id=t.schema_id JOIN sys.columns c ON c.object_id=t.object_id AND c.column_id=fc.parent_column_id
      JOIN sys.tables rt ON rt.object_id=fc.referenced_object_id JOIN sys.schemas rs ON rs.schema_id=rt.schema_id JOIN sys.columns rc ON rc.object_id=rt.object_id AND rc.column_id=fc.referenced_column_id
      ORDER BY f.object_id,fc.constraint_column_id;
SELECT s.name AS schemaName, t.name AS tableName, ix.name AS keyName, c.name AS columnName
FROM sys.indexes ix JOIN sys.tables t ON t.object_id=ix.object_id
JOIN sys.schemas s ON s.schema_id=t.schema_id
JOIN sys.index_columns ic ON ic.object_id=t.object_id AND ic.index_id=ix.index_id
JOIN sys.columns c ON c.object_id=t.object_id AND c.column_id=ic.column_id
WHERE ix.is_unique=1 AND ix.is_primary_key=0 AND ix.has_filter=0 AND ic.key_ordinal>0
ORDER BY s.name,t.name,ix.index_id,ic.key_ordinal;
`;
