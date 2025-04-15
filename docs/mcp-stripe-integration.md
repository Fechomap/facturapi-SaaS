# Integración de Stripe con MCP (Model Context Protocol)

Este documento describe cómo configurar y utilizar la integración de Stripe a través del Model Context Protocol (MCP) en el sistema de facturación SaaS.

## Índice

1. [Introducción](#introducción)
2. [Requisitos Previos](#requisitos-previos)
3. [Configuración](#configuración)
4. [Pruebas](#pruebas)
5. [Implementación en Producción](#implementación-en-producción)
6. [Solución de Problemas](#solución-de-problemas)
7. [Referencias](#referencias)

## Introducción

El Model Context Protocol (MCP) es un protocolo que permite a los modelos de lenguaje (como Claude o GPT) interactuar con herramientas externas. En este caso, utilizamos MCP para integrar Stripe en nuestro sistema de facturación SaaS, lo que nos permite:

- Crear clientes en Stripe
- Generar enlaces de pago
- Procesar eventos de webhook
- Gestionar suscripciones

## Requisitos Previos

Antes de comenzar, asegúrate de tener:

1. Una cuenta de Stripe con acceso a las claves API
2. Node.js v18 o superior
3. El servidor MCP de Stripe instalado y configurado

### Configuración Automática

La forma más sencilla de configurar todo el entorno es usar el script de configuración incluido:

```bash
npm run setup:mcp
```

Este script:
- Verifica que Node.js v18+ esté instalado
- Instala las dependencias del proyecto
- Instala el servidor MCP de Stripe
- Configura los archivos necesarios
- Hace ejecutables los scripts de shell

### Instalación Manual del Servidor MCP de Stripe

Si prefieres configurar manualmente, el proyecto incluye scripts para facilitar la instalación y ejecución del servidor MCP de Stripe.

#### Opción 1: Usando el script incluido (recomendado)

```bash
npm run start:mcp
```

Este script:
- Carga automáticamente la API key desde tu archivo `.env`
- Proporciona una salida con colores para facilitar la lectura
- Maneja correctamente las señales de terminación (Ctrl+C)

#### Opción 2: Ejecutando directamente con npx

```bash
npx -y @stripe/mcp --tools=all --api-key=YOUR_STRIPE_SECRET_KEY
```

Reemplaza `YOUR_STRIPE_SECRET_KEY` con tu clave secreta de Stripe. También puedes configurar la clave a través de la variable de entorno `STRIPE_SECRET_KEY`.

#### Ejecutar todo junto (API, Bot y MCP)

Para ejecutar el servidor API, el bot de Telegram y el servidor MCP juntos:

```bash
npm run dev:all:mcp
```

Este comando utiliza `concurrently` para ejecutar todos los servicios en paralelo.

## Configuración

### 1. Variables de Entorno

Añade las siguientes variables a tu archivo `.env`:

```
# Configuración de Stripe
STRIPE_SECRET_KEY=sk_test_xxxxxxxxxxxxxxxxxxxxxxxxxxx
STRIPE_PUBLISHABLE_KEY=pk_test_xxxxxxxxxxxxxxxxxxxxxxxxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxxxxxxxxxxxxxxxx

# Configuración del servidor MCP de Stripe
MCP_SERVER_URL=http://localhost:3000/mcp
MCP_STRIPE_SERVER_NAME=github.com/stripe/agent-toolkit
MCP_REQUEST_TIMEOUT=10000
```

### 2. Verificar la Conexión con el Servidor MCP (usando Cline)

Una vez que el servidor MCP esté en ejecución (usando `npm run start:mcp`), puedes verificar la conexión usando las herramientas de Cline. Por ejemplo, para listar productos:

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

Si esta herramienta funciona, significa que Cline puede comunicarse correctamente con el servidor MCP a través de stdio.

### 3. Actualizar el Código para Usar la Implementación Real

El sistema incluye una implementación de referencia en `lib/mcpClient.js`. Para utilizarla:

1. Abre `jobs/subscription.job.js`
2. Reemplaza la implementación placeholder de `callStripeMcpTool` con la importación desde `lib/mcpClient.js`

Puedes seguir el ejemplo en `examples/update-subscription-job.js` para ver los cambios necesarios.

### 4. Configurar el Webhook de Stripe

1. Ve al [Dashboard de Stripe](https://dashboard.stripe.com/webhooks)
2. Añade un nuevo endpoint: `https://tu-dominio.com/api/webhooks/stripe`
3. Selecciona los siguientes eventos:
   - `checkout.session.completed`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
4. Copia el "Signing Secret" y configúralo como `STRIPE_WEBHOOK_SECRET` en tu `.env`

## Pruebas

### Prueba Completa Automatizada

El sistema incluye un script que ejecuta automáticamente el flujo de prueba:

```bash
npm run test:full
```

Este script:
1. Inicia el servidor MCP de Stripe en segundo plano
2. Ejecuta la prueba de flujo de suscripción (`tests/test-subscription-flow.js`)
3. Muestra los logs del servidor MCP
4. Limpia automáticamente los procesos al finalizar (Ctrl+C)

**Importante:** Este script asume que la prueba de flujo de suscripción (`tests/test-subscription-flow.js`) está diseñada para usar las herramientas MCP a través de Cline o un mecanismo similar que pueda interactuar con el servidor MCP vía stdio. No puede probar la conexión HTTP directamente.

Es la forma más sencilla de verificar que todo el sistema funciona correctamente.

### Prueba del Flujo de Suscripción Individual

Si prefieres ejecutar solo la prueba de suscripción (sin iniciar el servidor MCP):

```bash
npm run test:subscription
```

O con una salida más amigable:

```bash
npm run test:subscription:shell
```

Este script simula:
1. Creación de datos de prueba (tenant, plan, suscripción)
2. Expiración de una suscripción
3. Ejecución del cron job para procesar suscripciones expiradas
4. Simulación de un evento de pago exitoso
5. Verificación del estado final de la suscripción

### Prueba Manual del Flujo

Para probar manualmente el flujo:

1. Crea un tenant de prueba
2. Modifica la fecha de fin de prueba para que expire pronto:
   ```sql
   UPDATE tenant_subscriptions SET trial_ends_at = NOW() WHERE id = X;
   ```
3. Ejecuta el cron job manualmente:
   ```bash
   node -e "require('./jobs/subscription.job.js').processExpiredSubscriptions()"
   ```
4. Verifica que llegue la notificación con el link de pago
5. Usa el link para pagar con una [tarjeta de prueba de Stripe](https://stripe.com/docs/testing#cards)
6. Verifica que el webhook procese el pago y actualice la suscripción a activa

## Implementación en Producción

Para implementar en producción:

1. Asegúrate de que el servidor MCP esté configurado para ejecutarse como un servicio
2. Configura las variables de entorno con las claves de producción de Stripe
3. Configura el webhook en el Dashboard de Stripe para apuntar a tu endpoint de producción
4. Verifica que el middleware `requireTenant` esté aplicado a las rutas que requieren una suscripción activa

### Ejecutar el Servidor MCP como un Servicio

Puedes usar PM2 para ejecutar el servidor MCP como un servicio:

```bash
npm install -g pm2
pm2 start "npx -y @stripe/mcp --tools=all --api-key=$STRIPE_SECRET_KEY" --name stripe-mcp
pm2 save
pm2 startup
```

## Solución de Problemas

### El Servidor MCP No Responde

- Verifica que el servidor MCP esté en ejecución
- Verifica que la URL del servidor MCP sea correcta
- Verifica que no haya un firewall bloqueando la conexión

### Errores en las Llamadas a la API de Stripe

- Verifica que la API key de Stripe sea correcta
- Verifica que el servidor MCP tenga acceso a la API de Stripe
- Verifica los logs del servidor MCP para ver errores específicos

### Webhook No Procesa Eventos

- Verifica que el webhook esté configurado correctamente en Stripe
- Verifica que el `STRIPE_WEBHOOK_SECRET` sea correcto
- Verifica que el endpoint del webhook sea accesible desde Internet
- Revisa los logs del servidor para ver si hay errores al procesar el webhook

## Referencias

- [Documentación de Stripe](https://stripe.com/docs)
- [Documentación de MCP](https://modelcontextprotocol.com/)
- [Repositorio de Stripe Agent Toolkit](https://github.com/stripe/agent-toolkit)
- [Tarjetas de Prueba de Stripe](https://stripe.com/docs/testing#cards)
