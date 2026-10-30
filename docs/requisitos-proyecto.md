# Proyecto I: Normalización Automatizada

Implementación web para la rúbrica de Administración de Bases de Datos II. El procesamiento usa análisis léxico y algoritmos relacionales deterministas. No integra modelos de IA, servicios de inferencia, claves de proveedores ni generación de reglas mediante IA.

| Requisito                              | Implementación                                                                               | Verificación                                                                    |
| -------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Entrada .SQL de una o varias entidades | Importación en trabajador, UTF-8/UTF-16, CREATE/ALTER TABLE de SQL Server, informe por tabla | Pruebas parser, jobs y navegador                                                |
| Conexión SQL Server                    | API de metadatos con consultas fijas, variables del servidor y TLS verificado                | Pruebas API con lectores sustituidos; conexión real requiere una base accesible |
| Evaluación de prerrequisitos           | Revisión estructural, clave de trabajo, confirmación de atomicidad y completitud de reglas   | Pruebas Angular y motor                                                         |
| Identificar forma normal               | Claves candidatas, atributos primos, dependencias parciales y violaciones de 3FN             | Oráculo exhaustivo y pruebas relacionales                                       |
| Transformar a 1FN                      | Extracción explícita de un grupo repetido de columnas de igual tipo                          | Pruebas motor y navegador                                                       |
| Transformar a 2FN y 3FN                | Descomposición binaria sin pérdida y síntesis por cubierta mínima                            | Pruebas de proyección, preservación y chase                                     |
| Visualizar entidades y relaciones      | Diagramas SVG por tabla y vista del proyecto completo                                        | Pruebas navegador                                                               |
| Archivo plano del modelo               | SVG, Mermaid e informe JSON                                                                  | Descargas verificadas en navegador                                              |
| Script de estructuras normalizadas     | SQL Server con claves y FK; exportación por tabla o conjunta                                 | Reimportación del SQL generado y pruebas del proyecto                           |

## Uso para la entrega

1. Ejecuta `npm ci` y `npm run dev` con Node.js 24.15 o superior dentro de la rama 24.
2. Carga un .sql o el caso universitario. Revisa los avisos de importación.
3. Por cada tabla, declara las dependencias y confirma sus prerrequisitos. Selecciona 1FN, 2FN o 3FN y ejecuta el análisis.
4. Examina el diagnóstico y descarga el modelo individual, o abre **Proyecto completo** para reunir los resultados de varias tablas.
5. Las tablas pendientes se conservan y se identifican expresamente. Las referencias originales se reubican solo cuando sus columnas y la clave de destino permiten hacerlo sin ambigüedad. Los errores de referencias o nombres duplicados bloquean las exportaciones SQL/SVG/Mermaid conjuntas; el informe JSON permanece disponible para revisar el problema.
6. Revisa el SQL antes de ejecutarlo en una base de práctica vacía.

El SQL de estructura no demuestra atomicidad ni dependencias semánticas del negocio. Por eso el estudiante declara y confirma esas reglas. Las transformaciones generan estructuras, no migran registros; las restricciones omitidas se informan durante la importación. No se requiere SQL Server para el flujo con archivos. La conexión real es una integración opcional que necesita las variables descritas en el README y acceso TCP.
