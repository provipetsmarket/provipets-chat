# Consulta de guía con dos datos de compra

Versión simplificada solicitada por el usuario: dos datos distintos entre nombre completo, teléfono, correo y cédula deben coincidir en la misma fila de compra. No exige número de orden, selección de plataforma ni código por correo. Aplica a los canales identificados en la plantilla: web/Jumpseller, directo, Addi, Puntos Colombia, Falabella y Mercado Libre.

Solo se devuelve la guía registrada y la fecha de modificación del archivo. No se devuelve nombre, dirección, correo, teléfono, documento, producto ni número de otra compra. Una guía no confirma estado de entrega. Si no hay guía, se indica que no está registrada. Si coinciden varias compras, se pide al cliente un producto para distinguirlas; si continúa la ambigüedad, no se muestran guías y se deriva a atención. El producto es una pista, no sustituye los dos datos de identidad.

El nombre admite coincidencia abreviada segura: debe incluir el primer nombre registrado y al menos un apellido que aparezca en la columna `Nombre` (por ejemplo, `Jhon Soto` coincide con `Jhon Fredy Soto Arboleda`). Se ignoran mayúsculas, tildes, espacios repetidos y puntuación. El nombre nunca basta por sí solo: siempre se exige un segundo dato independiente que coincida en la misma fila. Teléfonos colombianos admiten 10 dígitos o prefijo +57. No se deducen columnas ni plataforma de hojas antiguas sin los encabezados necesarios. Dos datos coincidentes no equivalen a probar control de un correo/teléfono; se utiliza este esquema por elección explícita del propietario.

La fuente es una hoja nativa de Google Sheets en Drive; se lee directamente con `SpreadsheetApp` y solo con permisos de lectura. Se selecciona por ID de spreadsheet y GID de pestaña, y las columnas se localizan por encabezado. El módulo usa por defecto el spreadsheet y la pestaña indicados por el propietario; opcionalmente se pueden definir `ORDERS_SPREADSHEET_ID` y `ORDERS_SHEET_GID` en las propiedades del script. Se utiliza `getDisplayValues()` para conservar la representación visible de teléfonos y documentos. La caché se invalida cuando cambia la fecha de modificación del archivo.

La consulta no envía datos a OpenAI ni consume saldo de IA. El catálogo sigue usando OpenAI. Se mantiene un límite global de 100 intentos diarios de consulta de guía entre todos los visitantes (hora Colombia), incluidos errores de coincidencia; no es un límite monetario. Google mantiene sus propias cuotas de ejecución. Ninguna conversación ni datos personales se registran en los logs de este módulo.

## Instalación pendiente en Google

1. En el proyecto Apps Script existente, guardar copia de su código actual. Reemplazar `Código.gs` por el contenido completo de `Codigo-pedidos.txt`.
2. Configuración del proyecto → Propiedades de la secuencia de comandos: conservar `OPENAI_API_KEY`. El ID del Google Sheet y el GID de la pestaña ya están definidos como valores predeterminados en el módulo; opcionalmente, añadir `ORDERS_SPREADSHEET_ID` y `ORDERS_SHEET_GID` con esos mismos valores. La cuenta que ejecuta Apps Script debe tener acceso de lectura a la hoja.
3. Activar la visualización de `appsscript.json` y pegar el manifiesto de esta carpeta: conexión externa, Drive en modo lectura y Google Sheets en modo lectura. No solicita permiso para enviar correos. No requiere APIs avanzadas ni disparadores.
4. Guardar. Implementar → Administrar implementaciones → editar la aplicación web existente → Nueva versión → Implementar. Mantener Ejecutar como Yo y Cualquier persona, y autorizar lectura de Drive y Google Sheets con la cuenta que tiene acceso a la plantilla. Conservar la URL actual de Jumpseller.
5. Probar en ventana privada el catálogo y el botón Consultar mi pedido, usando dos datos de una compra propia o del cliente que solicitó la prueba. Comparar guía con el Excel de Drive. Probar dato incorrecto, dos tipos iguales, compra ambigua y guía vacía. No usar datos de clientes ajenos para una demostración pública.
6. Verificar que una modificación autorizada de la hoja aparece en una consulta nueva. La integración no está lista hasta comprobar la ejecución real, los permisos y el resultado en Apps Script.

## Desarrollo

`node apps-script/orders/build.mjs` genera el archivo completo. `node --test apps-script/orders/test.mjs` usa registros ficticios y no gasta saldo. Ningún registro del Excel está guardado en el repositorio.
