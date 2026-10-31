# Correspondencia con el Proyecto I y las diapositivas

| Requisito                     | Implementación                                                      | Evidencia o límite                                                   |
| ----------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Aplicación web, sin IA        | Angular, Express, Python y SQLGlot                                  | No usa servicios ni modelos de IA                                    |
| Archivo .SQL de varias tablas | SQLGlot T-SQL, carga UTF-8/UTF-16                                   | Pruebas Python y navegador                                           |
| Conexión SQL Server           | API de catálogo con TLS                                             | Pruebas API sustituidas; servidor real pendiente                     |
| Semántica clara               | Evidencia de claves, reglas @fd y dependencias observadas separadas | La semántica no se demuestra desde DDL                               |
| Redundancia                   | Duplicados observados y descomposiciones por dependencias           | No borra registros                                                   |
| Reducción de NULL             | Perfil por atributo y explicación de su significado                 | No separa atributos opcionales sin conocer el dominio                |
| No generar tuplas falsas      | Descomposiciones sin pérdida bajo las reglas disponibles            | Chase independiente del motor; supuestos explícitos                  |
| 1FN                           | Extracción de grupos numerados, clave hija ampliada                 | Listas ambiguas y estructuras anidadas no descritas se deben aclarar |
| 2FN                           | Descomposición por dependencias parciales de atributos no primos    | Considera claves alternativas, como en PARCELAS                      |
| 3FN                           | Cubierta mínima, síntesis e inclusión de clave candidata            | Comprueba la forma obtenida y preserva dependencias                  |
| Diagnóstico y explicación     | Forma provisional, claves, dependencias y prerrequisitos            | No confunde ausencia de reglas con garantía semántica                |
| Modelo entidad relación       | Visualización por etapa y diagrama conjunto                         | Revisión de FK antes de exportar                                     |
| Archivo plano y script        | SQL Server, SVG, Mermaid e informe JSON                             | Estructuras vacías, sin migración de filas                           |
| Flujo automático              | Un análisis prepara las tres etapas de todas las tablas             | Sin editor obligatorio ni casillas por tabla                         |

El caso PARCELAS se verifica por sus columnas: una tabla en 1FN, dos en 2FN y tres en 3FN. Las anotaciones @fd del ejemplo aportan las reglas que las diapositivas proporcionan; SQLGlot no puede adivinarlas de los nombres de columnas.
