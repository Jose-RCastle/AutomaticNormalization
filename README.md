# NormalizaDB

Aplicación de estudio para **importar esquemas SQL Server, explicar sus dependencias y preparar estructuras en 1FN, 2FN o 3FN**. Angular 22 + TypeScript 6 en el cliente; Node.js 24 + Express en la API opcional.

## Probar en tu PC

Instala Node.js **24.15 o posterior de la rama 24**. Desde la carpeta del repositorio:

```sh
npm ci
npm run dev
```

Abre `http://localhost:4200` en tu navegador. Para detener ambos servidores, pulsa `Ctrl+C` en la terminal. La API escucha en `127.0.0.1:3001` y Angular redirige `/api` mediante `proxy.conf.json`.

No necesitas SQL Server para cargar archivos, practicar ni exportar. `npm run build` genera el cliente en `dist/normalization-workbench/browser`. El servidor de desarrollo no es un despliegue de producción: ese despliegue requiere alojamiento del cliente, proxy y autenticación según el contexto.

## Prepararse para la presentación

1. Pulsa **Caso universitario**: carga 12 tablas, una relación desnormalizada de 34 atributos y las dependencias documentadas del ejemplo.
2. En el explorador, revisa `dbo.InscripcionesExtendidas`. Ya contiene las reglas, pero las confirmaciones son manuales para practicar su justificación.
3. Confirma atomicidad y completitud de las dependencias. Selecciona 3FN y pulsa **Analizar y normalizar**.
4. Revisa las claves candidatas, los motivos del diagnóstico y el diagrama. Descarga SQL, SVG, Mermaid, JSON o el informe del análisis.
5. Regresa a otra tabla. Cada una conserva sus reglas, confirmaciones y resultados mientras la página permanece abierta.
6. Para practicar 1FN, usa `dbo.ContactosEmergencia`, selecciona 1FN y el grupo `Telefono1`, `Telefono2`, `Telefono3`.

Los archivos están en [examples](examples): `caso-universidad.sql` y `caso-universidad.reglas.json`. El archivo SQL incluye sentencias de datos como las que pueden acompañar una exportación, pero **no se ejecutan ni se utilizan para inferir dependencias**.

Puedes generar un archivo de práctica de unos 20 MiB sin aumentar el tamaño del repositorio:

```sh
npm run sample:large
# Tamaño personalizado y otra ruta (no sobrescribe archivos existentes):
npm run sample:large -- practica.sql 40
```

## Trabajar con un SQL desconocido

- Arrastra o selecciona un archivo **.sql de hasta 50 MiB**, en UTF-8 o UTF-16 con BOM. También puedes pegar SQL.
- El lector funciona en un **Web Worker** para mantener la interfaz disponible. Puedes cancelar; se termina el trabajador y se conserva el proyecto anterior. Una importación fallida tampoco reemplaza el trabajo existente.
- Revisa el **informe de importación**: muestra errores por tabla y línea, omisiones y referencias externas. Las tablas válidas siguen disponibles si otra tiene errores. Las tablas reconocidas con estructura incierta quedan bloqueadas para normalización.
- Busca una tabla, revisa sus columnas y selecciona una clave de trabajo si no tiene PRIMARY KEY. Es una decisión explícita del estudiante; no se inventa a partir de nombres.
- Añade dependencias escribiéndolas o usando el constructor de columnas. La clave primaria y las claves UNIQUE **no nulas** determinan los demás atributos. Las claves UNIQUE con columnas que admiten NULL no se tratan como claves relacionales.
- El SQL **no demuestra atomicidad ni reglas semánticas**. Debes conocer o consultar las reglas del negocio para confirmar un diagnóstico. El resultado es relativo a esas reglas, no una garantía sobre datos desconocidos.
- Guarda las reglas como JSON antes de cerrar o reimportar. Puedes cargarlas después sobre el mismo esquema. Se conserva el trabajo por tabla en memoria, no automáticamente después de cerrar la página. Una nueva importación reemplaza los espacios de trabajo.

Una dependencia tiene este formato:

```text
ClienteId -> ClienteNombre, Correo
PedidoId, ProductoId -> Cantidad
```

Los nombres se resuelven sin distinguir mayúsculas. Usa corchetes para nombres especiales: `[Nombre, apellido]`. El archivo de reglas es un objeto JSON con el nombre exacto de cada tabla como clave y el texto de dependencias como valor; hay un ejemplo en `examples/caso-universidad.reglas.json`.

### Transformaciones

- **1FN:** extrae un grupo repetido declarado por el usuario a una relación hija con la clave del padre, `Posicion` y `Valor`. Las columnas del grupo deben compartir tipo y quedar fuera de la clave. No divide ni migra las filas: el usuario debe cargar cada valor atómico en su fila. Confirma la atomicidad de los atributos restantes y de los futuros valores.
- **2FN:** encuentra dependencias parciales respecto de todas las claves candidatas y descompone mediante pasos binarios de reunión sin pérdida. No promete preservar todas las dependencias en 2FN.
- **3FN:** usa una cubierta mínima, elimina relaciones contenidas e incluye una clave candidata. Bajo las reglas declaradas, la síntesis preserva dependencias y admite reunión sin pérdida.

El script exportado crea **estructuras vacías para la tabla de trabajo seleccionada**. Las nuevas relaciones tienen claves y referencias derivadas. No migra datos ni traslada automáticamente las referencias de otras tablas, CHECK, DEFAULT, triggers, índices o acciones CASCADE. La nulabilidad de nuevas claves se ajusta a NOT NULL. Hay que revisar estas decisiones antes de ejecutar el script. Puedes volver a importar el SQL exportado, incluidos sus ALTER TABLE, para continuar el análisis.

## Compatibilidad y límites explícitos

El lector admite el subconjunto habitual de exportaciones de SQL Server:

- CREATE TABLE con nombres simples, Unicode, comillas dobles o corchetes escapados; esquema opcional.
- Tipos parametrizados, claves primarias simples/compuestas, UNIQUE, IDENTITY y referencias inline/de tabla.
- ALTER TABLE ADD para columnas, PRIMARY KEY, UNIQUE y FOREIGN KEY; WITH CHECK/NOCHECK y opciones de índices habituales en scripts SSMS.
- GO, USE y SET se omiten; las cadenas, comentarios anidados e INSERT no se confunden con DDL.

No es un intérprete completo de T-SQL. No reconstruye esquemas generados dinámicamente ni ejecuta procedimientos. Los cuerpos de procedimientos, vistas, funciones y triggers se omiten hasta GO con aviso. Las columnas calculadas, ALTER COLUMN, DROP y modificadores no interpretados necesitan revisión y bloquean la transformación de la tabla afectada. CHECK, DEFAULT y COLLATE se notifican como omisiones de la transformación. No se analiza el contenido de los registros.

Se permiten hasta **1 000 tablas y 256 columnas por tabla**. Esto no implica que todas las combinaciones sean tratables: la búsqueda exacta de claves/proyecciones puede ser exponencial. Cada búsqueda tiene un presupuesto de **25 000 combinaciones** y cada trabajo termina después de **60 segundos**. Si se exceden, se informa del límite y **no se publica un diagnóstico parcial**. Una tabla de 120 columnas con clave simple y reglas sencillas sí está cubierta por pruebas.

## SQL Server real (opcional)

Configura las variables en el proceso de la API o en un `.env` local ignorado por Git (usa `.env.example` como guía):

| Variable                 | Uso                                                     |
| ------------------------ | ------------------------------------------------------- |
| `DB_SERVER`              | Servidor alcanzable por TCP                             |
| `DB_DATABASE`            | Base de datos                                           |
| `DB_USER`, `DB_PASSWORD` | Cuenta con permisos de metadatos                        |
| `DB_PORT`                | Puerto, por defecto 1433                                |
| `API_PORT`               | API local, por defecto 3001; si cambia, ajusta el proxy |

La API realiza consultas fijas a los catálogos `sys` y recoge columnas, claves primarias, claves únicas no filtradas y claves foráneas. No lee registros de negocio. Necesita visibilidad de tablas y permisos como `VIEW DEFINITION`, según la política del administrador. Requiere TLS con un certificado confiable; no se desactiva su verificación. Las credenciales nunca se solicitan en el navegador ni deben subirse al repositorio.

En cloud también debes permitir el destino TCP y el puerto de SQL Server en los ajustes del entorno. Una regla HTTPS no habilita conexiones SQL. La API tiene pruebas de rutas y mapeo de metadatos con lectores sustituidos; **no se ha probado contra un servidor SQL Server real**. `GET /api/health` informa de la presencia de variables, no demuestra conexión.

## Código para estudiar

Consulta [la guía de arquitectura y algoritmos](docs/arquitectura.md). Los nombres explican el propósito, los módulos separan las responsabilidades y los comentarios explican las decisiones que lo necesitan. El formato se comprueba con Prettier.

```sh
npm run test:engine       # Lector, algoritmos, archivos y API
npm test -- --watch=false # Flujo y estado de Angular
npm run typecheck:api
npm run build
npm run format:check
```

Las pruebas incluyen comparación con un oráculo exhaustivo, preservación de dependencias, un chase para verificar reunión sin pérdida, lectura de archivos mayores de 10 MiB, codificaciones y escenarios de error. No sustituyen ensayar con el archivo y las reglas que se entreguen en clase.

### Pruebas de navegador

```sh
npx playwright install chromium
npm run test:e2e
```

Las pruebas inician los servidores automáticamente. Si el equipo ya tiene un Chromium compatible, puedes indicar su ejecutable con `PLAYWRIGHT_CHROMIUM_PATH`. En el entorno cloud se verificaron con `/usr/bin/chromium`. Cubren el caso de 34 columnas, todas las descargas, archivos de más de 15 MiB, UTF-16, importación parcial, selección de clave, 1FN, cancelación y diseño móvil.
