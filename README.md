# NormalizaDB

Aplicación educativa de normalización de esquemas SQL Server, construida con **Angular 22, TypeScript 6 y Node.js 24**. Incluye una API Express de consulta de metadatos y un motor de dependencias funcionales independiente de la interfaz.

## Desarrollo

Requisitos: Node.js `^24.15.0` y npm 11. Se verificó con Node 24.19.0.

```sh
npm ci
npm run dev
```

`npm run dev` inicia Angular en el puerto 4200 y la API en `127.0.0.1:3001`. Angular redirige `/api` a la API mediante `proxy.conf.json`. Los servidores son de desarrollo. Para generar la distribución del cliente: `npm run build` (salida: `dist/normalization-workbench/browser`). En producción se necesita alojamiento del cliente, proxy de la API y autenticación según el despliegue.

## Uso

1. Carga el ejemplo, pega DDL o importa un archivo `.sql` (hasta 1 MB). Varias tablas pueden importarse y se trabaja una tabla a la vez.
2. Para 2FN/3FN, declara las dependencias funcionales con nombres exactos de columnas, una por línea: `ClienteId -> ClienteNombre`. Una clave compuesta se expresa `PedidoId, ProductoId -> Cantidad`. La PRIMARY KEY ya determina los atributos de su tabla.
3. Confirma valores atómicos y que las reglas están completas. **El DDL no permite descubrir las reglas semánticas ni demostrar 1FN**; el diagnóstico depende de estas confirmaciones. Las claves alternativas deben declararse mediante sus dependencias.
4. Elige 2FN o 3FN y normaliza. Se muestran claves candidatas, violaciones, entidades y relaciones. Los listados de violaciones muestran hasta ocho ejemplos por categoría.
5. Descarga el script SQL Server, el diagrama SVG/Mermaid o el esquema JSON.

Para preparar **1FN**, selecciona ese objetivo e indica las columnas de un grupo repetido, por ejemplo `Telefono1, Telefono2`, o una columna que contenga una lista. Deben compartir el mismo tipo y estar fuera de la clave. Se generan la tabla padre y una hija con la clave del padre, `Posicion` y `Valor`. Confirma que los demás valores y los futuros valores de la hija son atómicos. La aplicación **no divide ni migra datos**: convierte la estructura declarada y requiere revisar y cargar cada valor en su fila. Para analizar después el padre o la hija en 2FN/3FN, copia sus CREATE TABLE a una nueva importación (sin los ALTER TABLE de exportación).

### Ejemplo de dependencias

Con `examples/pedidos.sql`:

```text
PedidoId -> ClienteId
ClienteId -> ClienteNombre
ProductoId -> ProductoNombre
```

La entrada está en 1FN bajo la confirmación de atomicidad. La síntesis 3FN produce relaciones de pedidos/clientes, clientes, productos y detalles. El algoritmo enumera claves candidatas y clausuras; la síntesis usa una cubierta mínima y conserva una clave para garantizar reunión sin pérdida y preservación de dependencias bajo las reglas declaradas. La descomposición 2FN elimina dependencias parciales con pasos de reunión sin pérdida.

## Conexión opcional a SQL Server

La importación de archivos funciona sin base de datos. Para importar metadatos de un SQL Server real, proporciona **en el proceso de la API** estas variables:

- `DB_SERVER`: nombre o dirección del servidor.
- `DB_DATABASE`, `DB_USER`, `DB_PASSWORD`: base de datos y credenciales de una cuenta de lectura de metadatos.
- `DB_PORT`: opcional, 1433 por defecto.
- `API_PORT`: opcional, 3001 por defecto; si se cambia, actualiza el destino del proxy.

Puedes usar un archivo local `.env` ignorado por Git; la API lo carga si existe. Usa gestión segura de secretos en despliegues. No introduzcas claves en el cliente ni las publiques en el repositorio. El servidor debe ser alcanzable por TCP en su puerto y su certificado debe ser confiable. En un entorno cloud restringido hay que configurar el destino/puerto TCP permitido en los ajustes del entorno; permitir solo un dominio HTTPS no habilita SQL Server. No se desactiva la verificación TLS.

La cuenta necesita visibilidad de las tablas y permisos de metadatos (`VIEW DEFINITION` según la política del administrador). La API usa consultas fijas a `sys.tables`, `sys.columns`, claves primarias y foráneas; no ejecuta el SQL importado ni consulta los registros de negocio. Devuelve un error controlado cuando faltan variables o falla la conexión. No incluye formulario para conexiones arbitrarias desde el navegador. La integración con un servidor real no se ha probado porque no se ha suministrado uno.

## Alcance del analizador

- Soporta el subconjunto habitual de SQL Server `CREATE TABLE`: columnas, tipos parametrizados, PRIMARY KEY inline/de tabla y FOREIGN KEY de tabla, con nombres simples o delimitados con corchetes y esquema opcional.
- Admite hasta **12 columnas por tabla** para limitar la enumeración de claves y clausuras.
- Rechaza ALTER TABLE, UNIQUE y columnas calculadas en la importación; no es un parser completo de T-SQL. INSERT y otros comandos no se ejecutan ni se utilizan: se analiza exclusivamente la estructura de CREATE TABLE.
- La exportación crea **estructuras vacías**, sin migración, triggers, defaults, índices, restricciones CHECK ni reglas de negocio ejecutables. Las descomposiciones 2FN/3FN crean relaciones nuevas y referencias derivadas entre ellas; no trasladan automáticamente claves foráneas externas ni vinculan otras tablas importadas. Revisa el script antes de ejecutarlo.
- El diagnóstico es relativo a las dependencias proporcionadas y la confirmación de atomicidad. No se puede establecer normalización correcta automáticamente a partir de nombres de columnas o de muestras de datos.

## Validación

```sh
npm run test:engine
npm test -- --watch=false
npm run typecheck:api
npm run build
```

El motor incluye pruebas de parsing, claves candidatas alternativas, diagnóstico, descomposición 1FN/2FN/3FN, preservación de dependencias y exportación. Angular comprueba prerrequisitos, invalidación de resultados y el flujo del ejemplo. `GET /api/health` indica si están presentes las variables de SQL Server; no prueba conectividad con la base de datos.
