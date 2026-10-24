# Chat de Provipets en Google Apps Script

Versión independiente del alojamiento Vercel. Consulta el mismo catálogo por MCP y mantiene el modelo y las instrucciones de `storefront/server/agent.json`. Usa directamente la API Responses de OpenAI, como el chat que ya funciona; no ejecuta la definición guardada de Agents ni incorpora automáticamente sus cambios futuros. No tiene acceso al Excel de pedidos.

## Instalación (un solo archivo)

1. Abre https://script.google.com/home/start con la cuenta que administrará el chat. Nombra el proyecto **Provipets Chat**.
2. Abre `Code.gs` de esta carpeta como texto. Copia TODO su contenido y reemplaza el código inicial del editor de Google. Guarda. No copies también `Server.gs` ni crees un archivo HTML: ya están incluidos en `Code.gs`.
3. En **Configuración del proyecto → Propiedades de la secuencia de comandos → Añadir propiedad**, crea `OPENAI_API_KEY` con tu clave del proyecto OpenAI `proj_jtanwDH277T6LpGAyghNfzEs`. Guarda. La clave va únicamente aquí, nunca en el código, la tienda ni una captura. Cualquier editor del proyecto puede ver sus propiedades; no compartas acceso de edición con clientes.
4. **Implementar → Nueva implementación → Seleccionar tipo → Aplicación web**. Configura **Ejecutar como: Yo** y **Quién tiene acceso: Cualquier persona** (sin exigir cuenta Google). Autoriza la conexión externa con OpenAI y copia la URL que termina en `/exec`.
5. Abre esa URL en una ventana de incógnito. Comprueba que no pide iniciar sesión. Envía «Hola», después «¿Qué precio tiene Royal Canin gato cachorro de 4 kg?» y después «¿De cuántos kilos es ese producto?». Comprueba precio y enlace en la tienda en ese momento. No se ha probado aún en una implementación real de Apps Script.
6. Solo después de esta prueba, coloca el iframe de abajo en la tienda y comprueba escritorio y móvil. Conserva la implementación actual hasta verificar la nueva. Si el iframe es bloqueado, no sustituyas el chat actual hasta resolverlo.

```html
<iframe src="PEGA_AQUI_LA_URL_DE_GOOGLE_QUE_TERMINA_EN_EXEC"
  title="Asistente Provipets Market" width="100%" height="640"
  style="border:0;border-radius:16px;max-width:820px"
  referrerpolicy="strict-origin-when-cross-origin"></iframe>
```

Este iframe es una primera integración en una página; el botón flotante se puede agregar después de probar el servicio.

## Uso y límites

- OpenAI se factura por separado. El límite de consultas no es un tope monetario.
- Máximo 20 consultas completadas por conversación y 300 intentos de consulta entre todos los visitantes por día (hora Colombia). El límite diario también cuenta fallos para evitar reintentos ilimitados. Se puede ajustar con la propiedad opcional `DAILY_REQUEST_LIMIT` (1–1000).
- El navegador recibe únicamente la respuesta y un token firmado. El identificador de OpenAI y el contador se guardan en el servidor. La clave nunca se envía al navegador. Las sesiones viven hasta una hora; Google puede desalojar la caché antes, en cuyo caso se inicia un Nuevo chat.
- El chat espera la respuesta completa; no transmite palabra por palabra. Solo permite las herramientas de catálogo `search_products` y `get_product`.
- No hay acceso a pedidos, cédulas ni guías. No se solicitan datos personales para consultar pedidos.
- El límite diario global reduce el uso accidental, pero no sustituye una protección contra abuso de un servicio público. Las cuotas de Apps Script y OpenAI también aplican. Apps Script puede interrumpir ejecuciones al superar sus cuotas.
- En **Ejecuciones** aparecen contadores de tokens y códigos de error, sin registrar conversaciones ni claves. Una ejecución puede durar como máximo el límite de Google; un fallo de red puede ocurrir aunque OpenAI ya haya procesado la solicitud. No hay reintentos automáticos.
- Para cambiar código publicado: **Implementar → Administrar implementaciones → Editar → Nueva versión → Implementar**. Guardar el editor por sí solo no actualiza `/exec`.

## Desarrollo

```sh
node apps-script/build.mjs
node --test apps-script/test.mjs
```

Edita `Server.gs` o `Index.html` y regenera `Code.gs`. Las pruebas locales simulan Google y OpenAI; no gastan saldo y no sustituyen la prueba real de `/exec`.

Documentación: [Apps web](https://developers.google.com/apps-script/guides/web), [comunicación con el servidor](https://developers.google.com/apps-script/guides/html/communication), [propiedades](https://developers.google.com/apps-script/guides/properties), [cuotas](https://developers.google.com/apps-script/guides/services/quotas).
