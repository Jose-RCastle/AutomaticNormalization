# Código para estudiar

El flujo principal se divide en tres pasos:

1. **Leer:** `python/sql_analysis.py` utiliza el árbol de SQLGlot para recoger tablas, claves, referencias e INSERT literales. También cuenta NULL y duplicados, contrasta las reglas @fd y descubre hipótesis de dependencias en datos. No ejecuta SQL. `server/sqlglot.ts` invoca Python mediante stdin, sin shell y con límites; `server/app.ts` expone `POST /api/analyze-sql`.
2. **Normalizar:** `src/lib/automatic.ts` organiza la extracción de grupos repetidos y las etapas 1FN/2FN/3FN para una tabla. Usa funciones puras del motor relacional probado. El trabajador de `src/app/services` evita bloquear la interfaz y permite cancelar. No se necesita escribir reglas manualmente en la app: puede usar claves, anotaciones del SQL o hipótesis de sus INSERT, identificando las diferencias.
3. **Mostrar:** `src/app/app.ts` coordina cargar, analizar y descargar. `app.html` muestra entrada, diagnóstico y comparación de las tres etapas. `src/lib/project.ts` reúne tablas y revisa referencias. `exporters.ts` genera SQL, SVG y Mermaid; JSON conserva el análisis completo.

## Matemática aislada de la interfaz

- `relational.ts`: clausura de atributos, cubierta mínima, claves candidatas, proyección de dependencias y diagnóstico respecto de **todas** las claves candidatas.
- `decomposition.ts`: divisiones binarias sin pérdida para 2FN, y síntesis con cubierta mínima para 3FN. Se incluye una clave candidata para asegurar reunión sin pérdida y se eliminan relaciones contenidas.
- `first-normal-form.ts`: extrae un grupo repetido como relación hija, propagando la clave del padre y ampliándola con la posición.

Se conservó este núcleo porque tiene pruebas independientes de corrección: un oráculo exhaustivo de claves, un chase para reunión sin pérdida y verificación de preservación de dependencias. Reescribirlo solo para reducir líneas haría más difícil confiar en el resultado. La reestructuración simplifica la interacción y reemplaza la lectura SQL de producción con una librería mantenida.

## Caso PARCELAS

`examples/parcelas.sql` incluye dos claves candidatas y las cuatro dependencias del ejemplo de clase. `tests/automatic.test.ts` compara los conjuntos exactos de columnas de las etapas 2FN y 3FN contra el material. `tests/browser/workbench.spec.ts` comprueba el recorrido real con SQLGlot, trabajador, interfaz y descargas.

## Evidencia y límites

Los NULL no se eliminan automáticamente: pueden significar desconocido, ausente o no aplicable. Una muestra finita permite refutar una dependencia, pero no demostrarla para todo el dominio. La atomicidad depende del uso de los datos. Por ello los resultados muestran sus supuestos y no se presentan como una certificación incondicional de 3FN. Los posibles valores multivalor ambiguos, las claves ausentes y las contradicciones bloquean la transformación en lugar de producir un resultado silencioso.
