# Asistente Provipets Market para Vercel

El despliegue usa esta aplicación independiente. La plantilla Next.js anterior permanece en el repositorio, pero no se instala ni se construye.

## Activar

1. En Vercel → Environment Variables, añadir `OPENAI_API_KEY` para Production y Preview. Debe ser una clave del proyecto `proj_jtanwDH277T6LpGAyghNfzEs`, con permisos `api.agents.read`, `api.agents.write` y `api.responses.write` y saldo habilitado. No usar NEXT_PUBLIC ni subir la clave al repositorio.
2. Desplegar el commit que incorpora `scripts/build-storefront.mjs`. La configuración está en vercel.json y no requiere Postgres, Redis, AI Gateway ni Vercel Blob.
3. Abrir la URL del despliegue. Se verá el chat aun sin clave; para responder necesita la variable anterior.
4. Probar un mensaje y después una consulta de catálogo. No se ha verificado una respuesta real desde este alojamiento sin credenciales.

## Insertar en Jumpseller

Con el dominio HTTPS confirmado, insertar antes de `</body>`:

```html
<script defer src="https://DOMINIO-DEL-CHAT/widget.js"></script>
```

El chat vive dentro de un iframe. Asegurarse de que el despliegue sea accesible para los visitantes, sin el inicio de sesión de protección de Vercel. La clave de API permanece en el servidor. La conversación utiliza un token firmado de una hora en memoria del navegador; no requiere cookies de terceros ni almacena datos del pedido.

## Funcionamiento

- `server/agent.json`: ID del agente guardado y overrides exactos de modelo, instrucciones, razonamiento y texto proporcionados. Los demás ajustes, incluidas las herramientas MCP, se heredan del agente guardado.
- `server/chat.mjs`: llamadas HTTP directas mediante fetch de Node, sin SDK ni dependencias. La API maneja el MCP del catálogo desde su servicio; entorno none, sin executor ni sandbox.
- `api.py`: cliente de terminal que realiza las llamadas HTTP usando **curl**, lee OPENAI_API_KEY y transmite todos los eventos JSON. Ejecución: `python3 storefront/api.py 'Hola'`. Para continuar: `python3 storefront/api.py --session sess_REEMPLAZAR 'Otra pregunta'`. Requiere Python y curl instalados.
- `public/index.html`: chat de cliente con mensajes incrementales, estado y errores. No muestra eventos internos ni resúmenes de razonamiento.
- `scripts/build-storefront.mjs`: genera Build Output API v3 para Vercel, con función Node.js 22 y límite de 60 segundos. La solicitud a OpenAI se cancela a los 55 segundos. Si se interrumpe, no reenvía mensajes automáticamente.

El límite básico por dirección de conexión vive en memoria y puede reiniciarse o variar entre instancias. No sustituye los límites de gasto ni un control de abuso distribuido. Configurar controles de gasto de OpenAI y el firewall de Vercel antes de dirigir tráfico importante. Las sesiones OpenAI permanecen en el proyecto y se pueden revisar allí; esta versión no implementa borrado automático.

## Validación local

```bash
node scripts/build-storefront.mjs
node --test storefront/test-chat.mjs
```

Las pruebas usan respuestas simuladas; comprueban conservación del agente, continuidad de la sesión, streaming, firma de tokens y errores. No requieren claves reales.

Documentación:
- https://developers.openai.com/api/docs/guides/agents-api/overview
- https://developers.openai.com/api/docs/guides/agents-api/configuration
- https://developers.openai.com/api/docs/guides/agents-api/sessions/events
- https://developers.openai.com/api/docs/guides/agents-api/tools/mcp
- https://vercel.com/docs/build-output-api/primitives
