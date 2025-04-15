# Integración de Stripe con MCP en Facturapi-SaaS

Este proyecto incluye una integración completa de Stripe a través del Model Context Protocol (MCP), lo que permite:

- Crear clientes en Stripe
- Generar enlaces de pago
- Procesar eventos de webhook
- Gestionar suscripciones

## Inicio Rápido

1. **Configuración Automática (Recomendado)**

   Ejecuta el script de configuración que instalará todas las dependencias necesarias:

   ```bash
   npm run setup:mcp
   ```

   Este script:
   - Verifica que Node.js v18+ esté instalado
   - Instala las dependencias del proyecto
   - Instala el servidor MCP de Stripe
   - Configura los archivos necesarios
   - Hace ejecutables los scripts de shell

2. **Configurar Variables de Entorno**

   Si no lo has hecho durante la configuración, edita el archivo `.env` y configura las variables de Stripe:

   ```
   STRIPE_SECRET_KEY=sk_test_...
   STRIPE_WEBHOOK_SECRET=whsec_...
   ```

3. **Iniciar el Servidor MCP**

   ```bash
   npm run start:mcp
   ```

4. **Probar la Conexión (con Cline)**

   Una vez iniciado el servidor MCP, puedes usar las herramientas de Cline para interactuar con él. Por ejemplo, para listar productos:
   
   ```xml
   <use_mcp_tool>
   <server_name>github.com/stripe/agent-toolkit</server_name>
   <tool_name>list_products</tool_name>
   <arguments>
   {
     "limit": 5
   }
   </arguments>
   </use_mcp_tool>
   ```

5. **Ejecutar Prueba Completa**

   ```bash
   npm run test:full
   ```

## Documentación Detallada

Para obtener instrucciones detalladas sobre la configuración, pruebas e implementación, consulta:

- [Documentación Completa de MCP-Stripe](docs/mcp-stripe-integration.md)
- [Pruebas de Suscripción](tests/README-subscription-tests.md)
- [Ejemplo de Implementación](examples/update-subscription-job.js)

## Archivos Principales

- `lib/mcpClient.js` - Cliente MCP para comunicarse con Stripe
- `jobs/subscription.job.js` - Cron job para procesar suscripciones expiradas
- `services/payment.service.js` - Servicio para procesar pagos y webhooks de Stripe
- `api/middlewares/tenant.middleware.js` - Middleware para validar suscripciones activas

## Scripts Disponibles

- `npm run setup:mcp` - Configura el entorno MCP
- `npm run start:mcp` - Inicia el servidor MCP (que funciona con stdio)
- `npm run test:subscription` - Prueba el flujo de suscripción (asume que el servidor MCP está en ejecución)
- `npm run test:full` - Ejecuta la prueba completa (inicia servidor MCP + prueba de suscripción)
- `npm run dev:all:mcp` - Inicia el servidor API, el bot y el servidor MCP juntos

## Flujo de Suscripción

1. El usuario comienza con una suscripción de prueba
2. Cuando la prueba expira, el cron job genera un link de pago y notifica al usuario
3. El usuario paga a través del link de Stripe
4. Stripe envía un webhook `checkout.session.completed`
5. El sistema procesa el webhook y activa la suscripción
6. El middleware verifica el estado de la suscripción para permitir o denegar el acceso

## Implementación en Producción

Consulta la [documentación detallada](docs/mcp-stripe-integration.md#implementación-en-producción) para obtener instrucciones sobre cómo implementar en producción.
