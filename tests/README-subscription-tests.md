# Pruebas del Flujo de Suscripciones

Este directorio contiene scripts para probar el flujo completo de suscripciones, desde la expiración hasta el pago y la activación.

## Script Principal: `test-subscription-flow.js`

Este script simula el ciclo de vida completo de una suscripción:

1. Crea datos de prueba (tenant, plan, suscripción)
2. Simula una suscripción expirada
3. Ejecuta el cron job para procesar suscripciones expiradas
4. Simula un evento de pago exitoso de Stripe
5. Verifica el estado final de la suscripción
6. Limpia los datos de prueba

## Cómo Ejecutar

Puedes ejecutar el script de prueba de varias maneras:

### Opción 1: Usando npm (recomendado)

```bash
npm run test:subscription
```

O con el script de shell para una salida más amigable:

```bash
npm run test:subscription:shell
```

### Opción 2: Directamente con Node.js

```bash
node tests/test-subscription-flow.js
```

### Opción 3: Usando el script de shell directamente

```bash
./tests/run-subscription-test.sh
```

El script de shell proporciona una salida más amigable con colores y verifica que Node.js esté instalado.

## Qué Esperar

El script mostrará logs detallados de cada paso del proceso. Si todo funciona correctamente, verás un mensaje final:

```
✨ Prueba de flujo de suscripción completada
```

Si hay algún error, el script mostrará el mensaje de error y terminará con un código de salida no cero.

## Notas Importantes

- **Mocks**: El script utiliza mocks para `NotificationService.sendTelegramNotification` y `callStripeMcpTool` para evitar enviar notificaciones reales o hacer llamadas reales a Stripe.
- **Limpieza**: El script limpia todos los datos de prueba que crea, incluso si hay errores durante la ejecución.
- **Base de Datos**: El script utiliza la misma base de datos configurada en tu archivo `.env`, así que asegúrate de no ejecutarlo en un entorno de producción.

## Antes de Desplegar a Producción

Antes de desplegar a producción, asegúrate de:

1. Implementar correctamente la función `callStripeMcpTool` en `jobs/subscription.job.js` para que se comunique con tu servidor MCP de Stripe.
2. Configurar el webhook en el Dashboard de Stripe para recibir eventos como `checkout.session.completed`.
3. Configurar las variables de entorno necesarias (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`).
4. Aplicar el middleware `requireTenant` a las rutas que requieren una suscripción activa.

## Implementación de `callStripeMcpTool`

Se ha creado una implementación de referencia en `lib/mcpClient.js` que puedes usar directamente. Para utilizarla, simplemente actualiza `jobs/subscription.job.js` para importar la función desde este archivo:

```javascript
// En jobs/subscription.job.js
import { callStripeMcpTool } from '../lib/mcpClient.js';

// Elimina la implementación placeholder existente de callStripeMcpTool
// y usa la importada
```

El archivo `lib/mcpClient.js` incluye:

- Configuración a través de variables de entorno
- Manejo de errores robusto
- Logging detallado
- Una función `checkMcpConnection()` para verificar la conexión con el servidor MCP

### Variables de Entorno

Puedes configurar el cliente MCP con estas variables de entorno:

- `MCP_SERVER_URL`: URL base del servidor MCP (por defecto: 'http://localhost:3000/mcp')
- `MCP_STRIPE_SERVER_NAME`: Nombre del servidor MCP de Stripe (por defecto: 'github.com/stripe/agent-toolkit')
- `MCP_REQUEST_TIMEOUT`: Tiempo de espera para las solicitudes en milisegundos (por defecto: 10000)

Asegúrate de ajustar estas variables según tu configuración específica del servidor MCP.
