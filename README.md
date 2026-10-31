# NormalizaDB · normalización automática con SQLGlot

Aplicación web sin IA para el Proyecto I de Administración de Bases de Datos II. **Carga un SQL → analiza todas sus tablas → compara 1FN, 2FN y 3FN → descarga estructuras y diagramas.** No hay que configurar cada tabla ni confirmar casillas antes del análisis.

## Ejecutar

Requiere Node.js **24.15+ de la rama 24**, npm y **Python 3.10+**:

```sh
npm ci
npm run setup:sql
npm run dev
```

Angular escucha en el puerto 4200 y redirige `/api` al servidor Express en 127.0.0.1:3001. SQLGlot se instala en `.venv` con versión fijada. `SQLGLOT_PYTHON` permite indicar otro ejecutable Python con esa dependencia instalada. Los comandos se ejecutan desde la raíz del repositorio. `Ctrl+C` detiene ambos servidores. No es una configuración de producción.

## Probar el ejemplo de clase

1. Pulsa **Probar PARCELAS de clase**. El archivo es `examples/parcelas.sql`.
2. El diagnóstico identifica 1FN: hay una dependencia parcial respecto de la clave candidata `(NombreMunicipio, NumeroParcela)`, aunque la clave principal `IdPropiedad` sea simple.
3. Selecciona **2FN**: aparecen PARCELAS1 (`IdPropiedad, NombreMunicipio, NumeroParcela, Area, Precio`) y PARCELAS2 (`NombreMunicipio, Impuestos`). Los nombres generados incluyen la etapa y un número.
4. Selecciona **3FN**: `Area → Precio` produce otra relación. Quedan las estructuras equivalentes a PARCELAS1A, PARCELAS1B y PARCELAS2 de las diapositivas.
5. Descarga SQL, SVG, Mermaid o el informe JSON con reglas, supuestos y todas las etapas.

## Qué significa automático

SQLGlot interpreta T-SQL en el servidor. El motor relacional calcula claves candidatas, dependencias parciales y violaciones de 3FN; genera las tres etapas sin intervención por tabla. La interfaz explica los cuatro prerrequisitos: semántica, redundancia, NULL y reunión sin pérdida.

La app distingue tres fuentes de conocimiento:

- **Claves del esquema:** PRIMARY KEY y UNIQUE NOT NULL generan dependencias declaradas.
- **Reglas del dominio:** el propio SQL puede transportar comentarios opcionales `-- @fd Tabla: A, B -> C`. El ejemplo PARCELAS incluye las reglas enseñadas en clase. No son reglas inferidas por nombre ni IA. Las columnas se validan y se contrastan con los INSERT presentes.
- **Muestra de registros:** si no hay reglas @fd, los INSERT literales permiten descubrir dependencias empíricas. Solo se consideran determinantes con repetición y al menos dos valores distintos; se excluyen NULL, constantes y determinantes únicos en la muestra. La búsqueda está limitada a determinantes de hasta tres atributos y tablas de hasta 16 columnas. El informe las identifica como **hipótesis**, no como restricciones universales.

**Ninguna librería puede deducir toda la semántica, la atomicidad o las dependencias funcionales del negocio a partir de cualquier archivo SQL.** Con solo DDL, el diagnóstico queda expresamente condicionado a las claves disponibles; no certifica la 3FN real. Las reglas ausentes pueden cambiar el resultado. Con datos, una dependencia accidental tampoco prueba una regla válida para filas futuras.

## Primera forma normal

Los grupos del mismo tipo y con sufijos numerados (por ejemplo `Telefono1, Telefono2`) se extraen automáticamente como una propuesta: relación padre más relación hija con la clave del padre, `Posicion` y `Valor`. Se amplía la clave hija, y se informa del supuesto utilizado. La numeración por sí sola no demuestra la semántica.

No se separan cadenas por comas sin conocer su dominio: una dirección o un decimal no son necesariamente listas. Si los INSERT contienen posibles listas (`;`, `,`, `|`), se bloquea la transformación y se pide aclarar esos valores en el SQL. No hay interpretación automática de relaciones anidadas arbitrarias, JSON ni grupos compuestos (por ejemplo pares Producto1/Cantidad1): requieren describir su estructura atómica. Las operaciones generan **estructuras**, no transforman filas.

## SQL admitido y límites

- CREATE TABLE con tipos explícitos, restricciones PRIMARY KEY, UNIQUE, FOREIGN KEY; ALTER TABLE ADD de columnas y restricciones; GO aislado, USE y SET.
- INSERT VALUES de literales y NULL, con lista opcional de columnas. Se leen para perfilar, **jamás se ejecutan**.
- Hasta 50 MiB de entrada, 1000 tablas, 256 columnas y 5000 filas literales por tabla. No se truncan filas silenciosamente. Procesos y trabajos tienen un tiempo máximo de 60 segundos; la búsqueda relacional tiene un presupuesto de 25000 combinaciones.
- Las expresiones en INSERT, INSERT SELECT, cambios destructivos y sentencias no soportadas se rechazan. Si SQLGlot no puede interpretar una sentencia, no se vuelve al lector manual para aparentar éxito.
- Se informa de restricciones no trasladadas como DEFAULT/CHECK. La exportación no preserva índices, triggers, collation ni todo el comportamiento original. No migra registros ni elimina NULL para ocultarlos. Las columnas omitidas de INSERT se consideran desconocidas; en NOT NULL bloquean el análisis aunque exista un valor por defecto.
- Una tabla sin clave declarada utilizable se bloquea; no se inventa una clave a partir de filas casualmente únicas.
- La exportación conjunta reubica referencias externas solo cuando el destino es inequívoco. Errores de claves, nombres o referencias bloquean SQL y diagramas exportados; el informe JSON siempre permite revisar el problema. Las tablas bloqueadas no se presentan como normalizadas.

Las garantías de reunión sin pérdida (2FN y 3FN) y preservación de dependencias (síntesis 3FN) se refieren a las reglas disponibles y al supuesto de 1FN; no certifican reglas semánticas desconocidas. La síntesis 3FN no consiste simplemente en ampliar una clave: construye relaciones desde una cubierta mínima e incluye una clave candidata cuando hace falta.

## SQL Server real

La opción **Leer SQL Server** conserva la API de metadatos. Usa las variables `DB_SERVER`, `DB_DATABASE`, `DB_USER`, `DB_PASSWORD`, y opcionalmente `DB_PORT` (1433) y `API_PORT` (3001). Puedes usar un `.env` ignorado por Git, basado en `.env.example`. Las credenciales permanecen en el servidor. Se requieren acceso TCP, certificado TLS confiable y visibilidad de metadatos, por ejemplo permisos VIEW DEFINITION.

La conexión solo lee estructura, no registros de negocio: con esa entrada el diagnóstico también queda condicionado a las claves del catálogo. La API tiene pruebas con lectores sustituidos. **La integración con un SQL Server real no se ha validado en este entorno.** No es necesaria para el flujo con archivos.

## Validar

```sh
npm run test:sql           # Lector SQLGlot y perfiles
npm run test:engine        # Algoritmos, PARCELAS, API y regresiones
npm test -- --watch=false # Estado de la interfaz y cancelación
npm run typecheck:api
npm run build
npm run format:check
# Chromium instalado por Playwright o ejecutable del sistema:
npx playwright install chromium
npm run test:e2e
# En este entorno:
PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e
```

Consulta [arquitectura](docs/arquitectura.md) y [requisitos](docs/requisitos-proyecto.md). El lector T-SQL anterior permanece para pruebas de regresión y utilidades heredadas; **el flujo nuevo de la aplicación utiliza SQLGlot**.
