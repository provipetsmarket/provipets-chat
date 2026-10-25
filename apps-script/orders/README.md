# Consulta de guía con dos datos de compra

Versión simplificada solicitada por el usuario: dos datos distintos entre nombre completo, teléfono, correo y cédula deben coincidir en la misma fila de compra. No exige número de orden, selección de plataforma ni código por correo. Aplica a los canales identificados en la plantilla: web/Jumpseller, directo, Addi, Puntos Colombia, Falabella y Mercado Libre.

Solo se devuelve la guía registrada y la fecha de modificación del archivo. No se devuelve nombre, dirección, correo, teléfono, documento, producto ni número de otra compra. Una guía no confirma estado de entrega. Si no hay guía, se indica que no está registrada. Si coinciden varias compras, se pide al cliente un producto para distinguirlas; si continúa la ambigüedad, no se muestran guías y se deriva a atención. El producto es una pista, no sustituye los dos datos de identidad.

Las comparaciones son completas, sin búsquedas por fragmentos de nombre. Se ignoran mayúsculas, tildes, espacios repetidos y separadores de teléfono/documento. Teléfonos colombianos admiten 10 dígitos o prefijo +57. No se deducen columnas ni plataforma de hojas antiguas sin los encabezados necesarios. Dos datos coincidentes no equivalen a probar control de un correo/teléfono; se utiliza este esquema por elección explícita del propietario.

El Excel de Drive se lee directamente como ZIP/XML, sin modificarlo ni convertirlo. Las columnas se localizan por encabezado, porque cambian entre hojas. Las hojas sin encabezados requeridos no se usan. El ID del archivo se guarda exclusivamente en la propiedad privada `ORDERS_FILE_ID`; no se publica en el código. Los cambios se consultan cuando el archivo del PC termina de sincronizarse con el mismo ID de Drive. Si Drive lo reemplaza con otro ID, se debe actualizar la propiedad. La caché del servidor se renueva al cambiar la fecha de modificación.

La consulta no envía datos a OpenAI ni consume saldo de IA. El catálogo sigue usando OpenAI. Se mantiene un límite global de 100 intentos diarios de consulta de guía entre todos los visitantes (hora Colombia), incluidos errores de coincidencia; no es un límite monetario. Google mantiene sus propias cuotas de ejecución. Ninguna conversación ni datos personales se registran en los logs de este módulo.

## Instalación pendiente en Google

1. En el proyecto Apps Script existente, guardar copia de su código actual. Reemplazar `Código.gs` por el contenido completo de `Codigo-pedidos.txt`.
2. Configuración del proyecto → Propiedades de la secuencia de comandos: conservar `OPENAI_API_KEY` y añadir `ORDERS_FILE_ID` con el ID del Excel original. No publicar el archivo ni cambiar sus permisos.
3. Activar la visualización de `appsscript.json` y pegar el manifiesto de esta carpeta: solo conexión externa y Drive en modo lectura. No solicita permiso para enviar correos. No requiere APIs avanzadas ni disparadores.
4. Guardar. Implementar → Administrar implementaciones → editar la aplicación web existente → Nueva versión → Implementar. Mantener Ejecutar como Yo y Cualquier persona, y autorizar lectura de Drive con la cuenta que tiene acceso al Excel. Conservar la URL actual de Jumpseller.
5. Probar en ventana privada el catálogo y el botón Consultar mi pedido, usando dos datos de una compra propia o del cliente que solicitó la prueba. Comparar guía con el Excel de Drive. Probar dato incorrecto, dos tipos iguales, compra ambigua y guía vacía. No usar datos de clientes ajenos para una demostración pública.
6. Verificar que una modificación autorizada y sincronizada del Excel aparece en una consulta nueva. La integración no está lista hasta comprobar la ejecución real, los permisos y el resultado en Apps Script.

## Desarrollo

`node apps-script/orders/build.mjs` genera el archivo completo. `node --test apps-script/orders/test.mjs` usa registros ficticios y no gasta saldo. Ningún registro del Excel está guardado en el repositorio.
