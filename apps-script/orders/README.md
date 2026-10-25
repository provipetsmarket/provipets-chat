# Consulta privada del Excel de pedidos

Preparación para la aplicación Apps Script existente. No se ha desplegado ni autorizado aún en Google; el chat público sigue en su versión anterior.

El archivo se lee directamente por su ID de Drive. No se convierte, no se edita, no se publica y no se copia su contenido al repositorio. Las actualizaciones se ven cuando Drive termina de sincronizar el mismo archivo. Si Drive crea otro archivo con otro ID, debe actualizarse la propiedad privada `ORDERS_FILE_ID`.

## Función

La nueva pestaña «Consultar mi pedido» pide plataforma, número exacto y correo de compra. Envía un código solo si todas las filas de ese pedido/canal coinciden con el correo registrado. Un código de 6 cifras, de un solo uso, vence a los 10 minutos y permite hasta 5 intentos. No se informa públicamente si el pedido existe. La respuesta contiene únicamente productos, cantidades, guías y transportadora si hay una columna explícita, más la fecha de modificación del archivo. No expone nombre, documento, dirección, teléfono ni otros pedidos.

Se admiten Jumpseller/web, directo, Addi, Puntos Colombia, Falabella y Mercado Libre. No se adivina la plataforma de hojas antiguas que no tienen esa columna. No se ofrecen búsquedas públicas solo por nombre, documento o producto. Si un pedido carece de correo o sus filas tienen correos inconsistentes, se deriva a atención por el canal de compra. No se interpreta el estado interno «OK» como entregado, ni se afirma que una guía registrada confirma la entrega.

La consulta y la verificación no usan OpenAI. Los códigos se envían con MailApp desde la cuenta propietaria de la implementación. Se aplica un máximo global de 50 solicitudes de código por día en hora Colombia, además de las cuotas de Google; los intentos fallidos también cuentan. Hay un intervalo mínimo de un minuto por combinación de plataforma/pedido/correo. Estos controles no sustituyen una defensa contra abuso a gran escala.

## Instalar paso a paso en la implementación existente

1. Guardar una copia del `Código.gs` actual para poder volver al catálogo solo.
2. Reemplazar su contenido por `Codigo-pedidos.txt`. La clave sigue en propiedades del script y no debe pegarse en código.
3. En las propiedades privadas del script, añadir `ORDERS_FILE_ID` con el ID del Excel original de Drive (la parte entre `/d/` y `/edit` de su enlace). No publicar este identificador en el repositorio.
4. Configuración del proyecto → mostrar el archivo de manifiesto `appsscript.json`. Reemplazarlo con el manifiesto de esta carpeta para limitar Drive a lectura y permitir enviar los códigos. No se requiere activar APIs avanzadas, crear un Sheet ni configurar un disparador.
5. Guardar. Implementar → Administrar implementaciones → editar la aplicación web actual → Nueva versión → Implementar. Conservar Ejecutar como Yo y acceso Cualquier persona. La cuenta que ejecuta debe tener acceso al Excel original. Autorizar los nuevos permisos de lectura Drive y envío de correo. No usar «Nueva implementación» para evitar cambiar la URL incrustada en Jumpseller.
6. Abrir la misma URL `/exec` en una ventana privada. Debe aparecer «Consultar mi pedido». Probar primero el catálogo; después, con un pedido propio o con el cliente presente, probar pedido/correo correctos, recepción del código, código incorrecto y correcto. Una búsqueda con datos incorrectos no debe revelar productos ni guía. No enviar códigos a clientes reales para pruebas sin una solicitud suya.
7. Comparar el resultado con el Excel en Drive. Guardar y sincronizar una actualización autorizada y verificar que una nueva consulta refleja el archivo actualizado. Las cachés se identifican por la fecha de modificación; al cambiar, se vuelven a leer los datos. Si no sincroniza, no se verá el cambio local del PC.

## Comprobaciones locales

`node apps-script/orders/build.mjs` regenera los archivos para pegar. `node --test apps-script/orders/test.mjs` prueba verificación, límites, minimización y estado de seguridad con datos ficticios. No envía correos ni consume OpenAI. El parser se valida contra la estructura del Excel real de forma privada. Es necesaria la prueba real en Apps Script para verificar permisos, tiempo de lectura ZIP/XML, cuotas y entrega del código.
