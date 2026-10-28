# Guía de lectura del proyecto

## Recorrido recomendado

1. **`src/lib/models.ts`** define las estructuras compartidas. Una tabla contiene columnas, claves y referencias; no contiene filas.
2. **`src/lib/sql/lexer.ts`** recorre el texto y distingue palabras, identificadores, literales y símbolos. Por eso una cadena con `CREATE TABLE` no se considera una tabla y una coma en `DECIMAL(12, 2)` no separa columnas.
3. **`src/lib/sql/parser.ts`** interpreta las definiciones. Reúne las restricciones ALTER TABLE después de leer todas las tablas, resuelve nombres y produce diagnósticos. Una omisión conocida se comunica; una modificación que deja el esquema incierto bloquea la transformación de esa tabla.
4. **`src/lib/relational.ts`** contiene clausuras, cubierta mínima, claves candidatas y diagnóstico. Las funciones reciben reglas explícitas: no adivinan el negocio.
5. **`src/lib/decomposition.ts`** construye las relaciones resultantes. **`first-normal-form.ts`** implementa la extracción del grupo repetido que declara el estudiante.
6. **`src/lib/exporters.ts`** convierte el modelo en SQL, Mermaid o SVG. No consulta la base de datos.
7. **`src/lib/jobs.ts`** representa una operación completa de importación o normalización. El trabajador de **`src/app/services`** la ejecuta sin bloquear la interfaz, con cancelación y tiempo máximo.
8. **`src/app/app.ts`** coordina el flujo y mantiene un espacio de trabajo por tabla. Los cambios que afectan al modelo invalidan sus resultados. Las solicitudes canceladas no pueden reemplazar el estado con respuestas tardías.
9. **`server/app.ts`** define las rutas; **`server/sql-server.ts`** gestiona la conexión y transforma los metadatos tipados. **`schema-query.ts`** contiene las consultas fijas. Se pueden probar las rutas inyectando otro lector sin usar credenciales.

`src/lib/normalization.ts` es la fachada pública que reexporta los módulos. Esto mantiene imports sencillos sin concentrar toda la lógica en un archivo enorme.

## Cómo razona el motor

La **clausura** de X es el conjunto de atributos deducibles al aplicar repetidamente las dependencias cuyo determinante ya está contenido en X. Una **superclave** alcanza todos los atributos; una **clave candidata** además es mínima.

La búsqueda de claves comienza por los atributos que no aparecen en ningún consecuente: son obligatorios. Explora únicamente atributos que pueden actuar como determinantes y poda ramas cuya clausura ya es suficiente. Sigue siendo exacta; cuando agota su presupuesto lanza un error en lugar de devolver solo las primeras claves.

El diagnóstico identifica todos los atributos primos, es decir, los que pertenecen a alguna clave candidata. Para 2FN busca atributos no primos alcanzables desde un subconjunto propio de una clave. Para 3FN comprueba una cubierta equivalente: cada determinante debe ser superclave o su consecuente debe ser primo. No es necesario listar todos los superconjuntos de una violación.

La síntesis 3FN parte de una **cubierta mínima**. Agrupa las reglas por determinante, elimina relaciones contenidas e incluye una relación con una clave candidata si ninguna la contiene. Esa última condición garantiza reunión sin pérdida. La descomposición 2FN hace divisiones binarias apoyadas en dependencias parciales.

Cuando una tabla se divide, hay que calcular qué dependencias se proyectan sobre cada relación. Una dependencia implícita puede atravesar atributos eliminados, por eso no basta con filtrar las reglas textuales. `projection` calcula clausuras y una cubierta equivalente, con presupuesto de búsqueda explícito.

## Pruebas que conviene leer

- `parser.test.ts`: scripts SSMS, escapes, restricciones posteriores, errores localizados y archivos pesados.
- `relational.test.ts`: comparación contra enumeración exhaustiva y chase independiente para detectar descomposiciones con pérdida.
- `engine.test.ts`: ejemplos pequeños de cada forma normal y exportaciones.
- `jobs.test.ts`: límites de archivo y codificaciones.
- `api.test.ts`: rutas sin credenciales reales y mapeo del catálogo de SQL Server.
- `src/app/app.spec.ts`: prerrequisitos, conservación del trabajo por tabla, invalidación y cancelación.

Los ejemplos grandes se generan con `scripts/generate-large-sql.mjs`; el repositorio mantiene solo el caso académico compacto. El generador utiliza un flujo de escritura, no sobrescribe archivos y no necesita una conexión a SQL Server.

## Decisiones que requieren revisión humana

Un nombre como `ClienteId` no demuestra que determine `ClienteNombre`. Una muestra de registros tampoco demuestra una regla universal. La confirmación del dominio y la atomicidad siempre pertenece al estudiante. Igualmente, generar un esquema en 1FN no divide automáticamente listas existentes en los registros.

La aplicación opera por tabla. Vincular descomposiciones de varias tablas, migrar datos y preservar todos los índices, defaults, triggers y restricciones del sistema original son tareas distintas. Los avisos y el README explican esos límites para no presentar una exportación estructural como una migración completa.
