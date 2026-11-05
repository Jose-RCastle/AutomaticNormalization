# Flujo y responsabilidades

## Lectura

`server/app.ts` expone `/api/analyze-sql`, `/api/sql-server` y el endpoint heredado `/api/schema`. El SQL cargado nunca se ejecuta. `server/sqlglot.ts` ejecuta Python por stdin, sin shell, con cancelación y límite de tiempo. `python/sql_analysis.py` interpreta el AST de SQLGlot y construye tablas, restricciones y perfiles.

La conexión real usa `mssql`, TLS validado y consultas fijas del catálogo. Las lecturas de registros usan identificadores escapados y TOP 10001 para distinguir una muestra de hasta 10000 filas. Regresan perfiles, restricciones, dependencias y hasta 10000 filas temporales para validar decisiones, con reunión limitada a 1000; los registros no se incluyen en el JSON descargado y las credenciales no regresan. El mismo perfilador Python procesa INSERT y registros reales.

## Normalización

`automatic.ts` organiza la entrada y produce las tres etapas. Los algoritmos no conocen ejemplos ni nombres de entidades. Las reglas provienen de claves, anotaciones/JSON del usuario o datos observados. Las reglas declaradas prevalecen sobre las observadas. Un archivo de reglas se valida y contrasta con los datos por el mismo servidor, no mediante una sustitución de resultados en la interfaz.

`relational.ts` calcula clausuras, cubiertas mínimas, proyecciones y claves candidatas. `decomposition.ts` realiza descomposición binaria para 2FN y síntesis para 3FN. La preservación de dependencias y la reunión sin pérdida se refieren a dependencias válidas y relaciones atómicas, no a semántica desconocida ni a valores NULL.

`first-normal-form.ts` extrae grupos numerados manteniendo posiciones y pares de columnas. Una columna técnica IDENTITY se propone cuando no existe clave. La extracción no divide texto por signos de puntuación. Las restricciones que no se pueden trasladar impiden extraer un grupo o exportar una etapa, y generan explicaciones visibles.

`project.ts` reúne resultados, conserva procedencia, reubica FK y comprueba destinos, nombres y claves. Las etapas fallidas no se muestran como tablas normalizadas. La etapa 1FN permanece disponible si 2FN o 3FN encuentran una restricción incompatible.

## Presentación y exportación

Angular mantiene una comparación del esquema original y el resultado seleccionado. `schema-view.ts` dibuja tablas o SVG calculados por Dagre y permite desplazamiento/zoom. Se calculan PK, FK, UQ y cardinalidades a partir de las restricciones; los diagramas no fijan todas las relaciones a uno a muchos.

Los exportadores producen DDL SQL Server, SVG, Mermaid e informe JSON. IDENTITY tiene un único propietario, las restricciones UNIQUE nullable se preservan, las expresiones calculadas y CHECK se trasladan solo si sus columnas permanecen juntas. El resultado describe estructuras vacías y no ejecuta migraciones.

## Instalación

`npm run dev` usa archivos SQL sin depender de SQL Server. `npm run db:local` prepara una instancia vacía SQL Server Developer con Docker Compose, CA y certificado local y credenciales aleatorias fuera de Git. `npm run dev:local` usa esa conexión. Una instalación existente también se puede configurar en el formulario o mediante variables del servidor.

El lector manual heredado se conserva en la biblioteca para regresiones. La ruta de producción utiliza SQLGlot; los resultados de pruebas del lector heredado no certifican la compatibilidad del lector nuevo.

## Revisión de evidencia

`review.ts` distingue reglas declaradas/confirmadas de hipótesis. Solo simples canónicas se usan para una propuesta inicial; compuestas requieren aprobación. `validation.ts` comprueba FK duplicadas, tipos e intercalaciones; los ciclos generan advertencias y la reunión natural de las proyecciones en la muestra. La interfaz pide confirmación antes de emitir restricciones, ofrece claves observadas y separación de listas, y no presenta DDL sin datos/reglas como 3FN demostrada. La exportación usa un esquema separado, restricciones nombradas y control de colisiones.

`python/sql_values.py` centraliza la igualdad SQL admitida. El perfil transmite `sampleRows` originales y `comparisonRows` para validar claves, reglas y reuniones. Ambos campos se excluyen del informe JSON. `comparisonIssues` bloquea la exportación cuando falta evidencia o el motor es necesario para determinar la igualdad. `server/profile-integrity.ts` verifica referencias entre perfiles sin confundir ausencia en una muestra con un huérfano demostrado.
