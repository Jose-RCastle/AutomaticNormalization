# Correspondencia con el Proyecto I

| Requisito del PDF                  | Implementación                                                                              | Alcance                                                                                      |
| ---------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Aplicación web                     | Angular + Express + Python                                                                  | Interfaz monocromática                                                                       |
| Entrada SQL de una o varias tablas | SQLGlot, UTF-8/UTF-16, selección de dialecto                                                | Hasta 50 MiB; SQL no ejecutado                                                               |
| Conexión SQL Server                | Formulario y configuración del servidor, TLS, catálogo y SELECT                             | Requiere instancia accesible, permisos y certificado confiable; preparación local con Docker |
| Prerrequisitos                     | Claves, perfil de NULL/duplicados, reglas y contradicciones                                 | No supone que toda muestra representa el negocio                                             |
| Diagnóstico de forma normal        | Motor relacional respecto de todas las claves candidatas                                    | Condicionado a atomicidad y reglas disponibles                                               |
| 1FN                                | Extracción de grupos numerados y claves de posición; propuesta de identidad si no hay clave | Grupos compuestos conservan sus posiciones; texto con separadores permanece escalar          |
| 2FN                                | Descomposición por dependencias parciales                                                   | Reunión sin pérdida bajo las reglas válidas                                                  |
| 3FN                                | Cubierta mínima, síntesis e inclusión de clave candidata                                    | Preserva dependencias; no inventa semántica del dominio                                      |
| Modelo entidad-relación            | Comparación antes/después, tablas, SVG con Dagre y cardinalidades                           | Diagramas y relaciones en cada etapa                                                         |
| Archivo plano                      | SVG, Mermaid y JSON                                                                         | Incluye evidencia, supuestos y errores                                                       |
| Script de estructuras              | DDL SQL Server con claves, FK, DEFAULT, IDENTITY, CHECK y columnas calculadas               | No migra registros; restricciones incompatibles bloquean la etapa                            |

La conexión no es necesaria para normalizar archivos. Sí permite analizar registros que no estén incluidos en un archivo SQL. Ni SQL Server ni SQLGlot pueden conocer reglas semánticas que la entrada no expresa. Se mantiene esa distinción en la aplicación.

El PDF admite transformar estructuras, por lo que no se ejecutan cambios en la base conectada. La conexión y la ejecución del DDL deben verificarse en la instalación de destino; una descarga de SQL no es una migración completada.
