# Chat Provipets Market

El sitio utiliza llamadas HTTP directas a OpenAI Responses API y el MCP oficial de la tienda. No ejecuta sesiones del agente guardado, para evitar el bloqueo observado en esa ruta. Reutiliza el modelo, instrucciones y texto de `server/agent.json`; cambiar el agente en el panel de OpenAI no sincroniza este archivo automáticamente.

## Configuración

En Vercel, configurar `OPENAI_API_KEY` del proyecto `proj_jtanwDH277T6LpGAyghNfzEs` con permiso de escritura Responses y saldo habilitado. La clave solo se usa en el servidor, nunca con un prefijo NEXT_PUBLIC. El modelo predeterminado es el de agent.json; `OPENAI_MODEL` permite una sustitución explícita si fuera necesaria.

La construcción `node scripts/build-storefront.mjs` genera el sitio y `/api/chat` en Node.js 22. No necesita base de datos ni dependencias adicionales. La función permite 240 segundos; la solicitud se cancela a los 180 segundos y no se reintenta automáticamente para evitar duplicados.

Solo se permiten `search_products` y `get_product`, herramientas de lectura verificadas del catálogo. OpenAI realiza esas consultas mediante MCP. Las respuestas se transmiten progresivamente al navegador. La continuidad utiliza previous_response_id dentro de un token firmado de una hora; el navegador no puede elegir una conversación ajena sin su firma. Los tokens anteriores de sesiones Agents se rechazan: usar Nuevo chat después de actualizar.

El límite básico por IP es local a cada instancia y no es un control distribuido. Las respuestas se almacenan en OpenAI con store:true para dar continuidad; esta versión no implementa borrado automático. No se habilitan consultas de pedidos ni datos personales.

## Verificar

```bash
node --test storefront/test-chat.mjs
node scripts/build-storefront.mjs
```

Las pruebas locales simulan la API; no sustituyen una prueba real del despliegue con saludo, producto/precio y un mensaje de seguimiento. El catálogo MCP se verificó mediante tools/list y una búsqueda real de Royal Canin. La respuesta real de OpenAI debe comprobarse después de desplegar.

`api.py` se conserva como cliente histórico de Agents API; no corresponde a la conexión actual del sitio y no debe usarse para validar esta versión.

## Jumpseller

Después de verificar el chat y confirmar un dominio público sin protección de Vercel, insertar antes de </body>:

```html
<script defer src="https://DOMINIO-CONFIRMADO/widget.js"></script>
```

Documentación: https://developers.openai.com/api/docs/guides/tools-connectors-mcp y https://vercel.com/docs/build-output-api/primitives
