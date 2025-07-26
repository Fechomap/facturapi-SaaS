# FacturAPI SaaS

<div align="center">

![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-13+-blue.svg)
![Redis](https://img.shields.io/badge/Redis-7+-red.svg)
![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Status](https://img.shields.io/badge/status-production-green.svg)

Sistema de facturación electrónica multitenant para México (CFDI 4.0) basado en FacturAPI con gestión a través de Bot de Telegram y API REST.

[Características](#-características) •
[Inicio Rápido](#-inicio-rápido) •
[Documentación](#-documentación) •
[API](#-api-reference) •
[Contribuir](#-contribuir)

</div>

## 📋 Tabla de Contenidos

- [Descripción General](#-descripción-general)
- [Características](#-características)
- [Arquitectura](#-arquitectura)
- [Inicio Rápido](#-inicio-rápido)
- [Instalación](#-instalación)
- [Configuración](#-configuración)
- [Uso](#-uso)
- [API Reference](#-api-reference)
- [Bot de Telegram](#-bot-de-telegram)
- [Testing](#-testing)
- [Despliegue](#-despliegue)
- [Monitoreo](#-monitoreo)
- [Contribuir](#-contribuir)
- [Licencia](#-licencia)

## 🎯 Descripción General

FacturAPI SaaS es una plataforma completa de facturación electrónica que permite a múltiples empresas (tenants) gestionar sus facturas CFDI 4.0 de manera eficiente. El sistema incluye:

- **Multitenancy**: Soporte para múltiples empresas con aislamiento completo de datos
- **Bot de Telegram**: Interface conversacional para facturación
- **API REST**: Endpoints completos para integración con sistemas externos
- **Alta Performance**: Optimizado para respuestas <2s con caching inteligente
- **Procesamiento Masivo**: Soporte para facturación batch con análisis de PDFs

## ✨ Características

### Core Features

- ✅ **Facturación CFDI 4.0** - Cumplimiento total con normativa SAT México
- ✅ **Multitenancy** - Aislamiento completo por empresa
- ✅ **Bot Inteligente** - Interface conversacional en Telegram
- ✅ **API REST** - Integración con sistemas externos
- ✅ **Procesamiento Masivo** - Análisis y facturación de múltiples PDFs
- ✅ **Gestión de Clientes** - CRUD completo de receptores
- ✅ **Reportes** - Estadísticas y análisis de facturación

### Performance

- ⚡ **<2s tiempo de respuesta** - Bot optimizado al 83%
- ⚡ **Caching inteligente** - Redis para sesiones distribuidas
- ⚡ **PostgreSQL optimizado** - Índices y VACUUM automático
- ⚡ **Clustering** - Soporte para múltiples workers

### Seguridad

- 🔐 **JWT Authentication** - Tokens seguros para API
- 🔐 **Tenant Isolation** - Datos completamente separados
- 🔐 **Encrypted Keys** - API keys cifradas en base de datos
- 🔐 **Rate Limiting** - Protección contra abuso

## 🏗️ Arquitectura

```mermaid
graph TB
    A[Telegram Users] -->|Webhook| B[Bot Handler]
    C[API Clients] -->|REST| D[API Gateway]

    B --> E[Session Manager<br/>Redis]
    D --> E

    E --> F[Business Logic<br/>Services]

    F --> G[(PostgreSQL<br/>Multitenant DB)]
    F --> H[FacturAPI<br/>External Service]

    I[Stripe] --> D

    subgraph "Core Services"
        F
        E
    end

    subgraph "External Services"
        H
        I
    end

    subgraph "Data Layer"
        G
    end
```

### Stack Tecnológico

- **Backend**: Node.js 18+ con Express
- **Database**: PostgreSQL 13+ con Prisma ORM
- **Cache**: Redis 7+ para sesiones
- **Bot**: Telegraf para Telegram
- **Payments**: Stripe para suscripciones
- **CFDI**: FacturAPI para timbrado

## 🚀 Inicio Rápido

### Prerrequisitos

- Node.js 18 o superior
- PostgreSQL 13 o superior
- Redis 7 o superior (opcional para desarrollo)
- Cuenta en [FacturAPI](https://www.facturapi.io)
- Bot de Telegram (crear con [@BotFather](https://t.me/botfather))

### Instalación Express

```bash
# Clonar el repositorio
git clone https://github.com/tu-usuario/facturapi-saas.git
cd facturapi-saas

# Instalar dependencias
npm install

# Copiar archivo de configuración
cp .env.example .env

# Configurar variables de entorno (ver sección Configuración)
nano .env

# Generar cliente Prisma
npx prisma generate

# Ejecutar migraciones
npx prisma db push

# Iniciar en desarrollo
npm run dev
```

## 📦 Instalación

### 1. Clonar Repositorio

```bash
git clone https://github.com/tu-usuario/facturapi-saas.git
cd facturapi-saas
```

### 2. Instalar Dependencias

```bash
npm install
```

### 3. Configurar Base de Datos

```bash
# Generar cliente Prisma
npx prisma generate

# Crear tablas (desarrollo)
npx prisma db push

# O usar migraciones (producción)
npx prisma migrate deploy
```

### 4. Configurar Redis (Opcional)

```bash
# macOS
brew install redis
brew services start redis

# Ubuntu/Debian
sudo apt-get install redis-server
sudo systemctl start redis

# Docker
docker run -d -p 6379:6379 redis:7-alpine
```

## ⚙️ Configuración

### Variables de Entorno

Crear archivo `.env` en la raíz del proyecto:

```env
# Base de Datos
DATABASE_URL="postgresql://user:password@localhost:5432/facturapi_saas"

# Redis (opcional en desarrollo)
REDIS_URL="redis://localhost:6379"

# FacturAPI
FACTURAPI_USER_KEY="sk_user_xxxxxxxxxx"

# Telegram
TELEGRAM_BOT_TOKEN="123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
ADMIN_CHAT_IDS="123456789,987654321"

# Stripe
STRIPE_SECRET_KEY="sk_test_xxxxxxxxxx"
STRIPE_WEBHOOK_SECRET="whsec_xxxxxxxxxx"

# Seguridad
JWT_SECRET="tu-secreto-super-seguro-aqui"

# Aplicación
NODE_ENV="development"
PORT="3000"
API_BASE_URL="http://localhost:3000"
```

### Configuración de Webhook (Telegram)

```bash
# Desarrollo (ngrok)
ngrok http 3000
# Copiar URL HTTPS generada

# Configurar webhook
curl -X POST "https://api.telegram.org/bot<TU_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://tu-dominio.ngrok.io/telegram-webhook"}'
```

## 💻 Uso

### Scripts de Desarrollo

```bash
# Desarrollo con hot-reload
npm run dev

# Desarrollo solo API
npm run dev:api

# Desarrollo solo Bot
npm run dev:bot

# Desarrollo completo (API + Bot)
npm run dev:all
```

### Scripts de Producción

```bash
# Iniciar servidor único
npm start

# Iniciar con PM2 (clustering)
npm run start:cluster

# Detener PM2
npm run stop:cluster
```

### Scripts de Utilidad

```bash
# Ejecutar tests
npm test

# Tests con coverage
npm run test:coverage

# Linter
npm run lint

# Formatear código
npm run format

# Prisma Studio (GUI para DB)
npm run studio

# Limpiar sesiones antiguas
npm run cleanup:sessions
```

## 📡 API Reference

### Autenticación

Todas las rutas requieren header `Authorization: Bearer <JWT_TOKEN>`

### Endpoints Principales

#### Tenants

```http
POST   /api/tenants                 # Crear tenant
GET    /api/tenants/:id             # Obtener tenant
PUT    /api/tenants/:id             # Actualizar tenant
DELETE /api/tenants/:id             # Eliminar tenant
```

#### Facturas

```http
POST   /api/invoices                # Crear factura
GET    /api/invoices                # Listar facturas
GET    /api/invoices/:id            # Obtener factura
POST   /api/invoices/:id/cancel     # Cancelar factura
GET    /api/invoices/:id/pdf        # Descargar PDF
GET    /api/invoices/:id/xml        # Descargar XML
```

#### Clientes

```http
POST   /api/customers               # Crear cliente
GET    /api/customers               # Listar clientes
GET    /api/customers/:id           # Obtener cliente
PUT    /api/customers/:id           # Actualizar cliente
DELETE /api/customers/:id           # Eliminar cliente
```

#### Reportes

```http
GET    /api/reports/summary         # Resumen general
GET    /api/reports/monthly         # Reporte mensual
GET    /api/reports/by-customer     # Por cliente
GET    /api/reports/export          # Exportar datos
```

### Ejemplo de Request

```javascript
// Crear factura
const response = await fetch('https://api.example.com/api/invoices', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: 'Bearer eyJhbGciOiJIUzI1NiIs...',
  },
  body: JSON.stringify({
    customer: 'cus_xxxxxx',
    items: [
      {
        product: {
          description: 'Servicio de consultoría',
          price: 1000,
          taxes: [
            {
              type: 'IVA',
              rate: 0.16,
            },
          ],
        },
        quantity: 1,
      },
    ],
    payment_form: '03',
    payment_method: 'PUE',
  }),
});
```

## 🤖 Bot de Telegram

### Comandos Disponibles

| Comando      | Descripción            | Permisos             |
| ------------ | ---------------------- | -------------------- |
| `/start`     | Iniciar bot y registro | Todos                |
| `/menu`      | Menú principal         | Usuarios registrados |
| `/facturar`  | Crear nueva factura    | Usuarios activos     |
| `/consultar` | Buscar facturas        | Usuarios activos     |
| `/clientes`  | Gestionar clientes     | Usuarios activos     |
| `/reportes`  | Ver estadísticas       | Usuarios activos     |
| `/ayuda`     | Mostrar ayuda          | Todos                |
| `/admin`     | Panel administrativo   | Solo admins          |

### Flujo de Facturación

1. Usuario envía `/facturar`
2. Bot solicita datos del cliente
3. Usuario proporciona RFC o selecciona de lista
4. Bot solicita concepto y monto
5. Usuario confirma datos
6. Bot genera factura y envía PDF/XML

### Procesamiento Masivo

1. Usuario envía múltiples PDFs
2. Bot analiza y extrae información
3. Muestra resumen para confirmación
4. Genera facturas en lote
5. Envía ZIP con todos los documentos

## 🧪 Testing

### Ejecutar Tests

```bash
# Todos los tests
npm test

# Tests unitarios
npm run test:unit

# Tests de integración
npm run test:integration

# Tests E2E
npm run test:e2e

# Coverage
npm run test:coverage
```

### Estructura de Tests

```
tests/
├── unit/           # Tests unitarios
├── integration/    # Tests de integración
├── e2e/           # Tests end-to-end
├── fixtures/      # Datos de prueba
└── helpers/       # Utilidades para testing
```

### Ejemplo de Test

```javascript
describe('InvoiceService', () => {
  it('should create invoice with correct data', async () => {
    const invoiceData = {
      customer: 'cus_test',
      items: [{ product: { description: 'Test', price: 100 } }],
    };

    const invoice = await InvoiceService.create(invoiceData);

    expect(invoice).toHaveProperty('id');
    expect(invoice.total).toBe(116); // 100 + 16% IVA
  });
});
```

## 🚀 Despliegue

### Railway (Recomendado)

1. Fork este repositorio
2. Crear proyecto en [Railway](https://railway.app)
3. Conectar repositorio GitHub
4. Configurar variables de entorno
5. Deploy automático en cada push

### Docker

```dockerfile
# Dockerfile incluido
docker build -t facturapi-saas .
docker run -p 3000:3000 --env-file .env facturapi-saas
```

### Manual (VPS)

```bash
# En el servidor
git clone <repo>
cd facturapi-saas
npm install --production
npm run build
pm2 start ecosystem.config.js
```

## 📊 Monitoreo

### Health Checks

```http
GET /health              # Status básico
GET /api/health         # Status detallado
GET /api/metrics        # Métricas Prometheus
```

### Logs

```bash
# Desarrollo
npm run dev | pino-pretty

# Producción con PM2
pm2 logs

# Railway
railway logs --follow
```

### Métricas de Performance

- **Response Time**: < 2s (P95)
- **Throughput**: 100 req/s
- **Error Rate**: < 0.1%
- **Uptime**: 99.9%

## 🤝 Contribuir

### Proceso de Contribución

1. Fork el proyecto
2. Crear feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit cambios (`git commit -m 'Add: nueva característica'`)
4. Push al branch (`git push origin feature/AmazingFeature`)
5. Abrir Pull Request

### Convenciones

- **Commits**: Usar [Conventional Commits](https://www.conventionalcommits.org/)
- **Código**: Seguir [Standard JS](https://standardjs.com/)
- **PRs**: Incluir tests y documentación

### Desarrollo Local

```bash
# Instalar dependencias de desarrollo
npm install

# Ejecutar linter
npm run lint

# Ejecutar tests antes de commit
npm test

# Build para verificar
npm run build
```

## 📄 Licencia

Este proyecto está licenciado bajo la Licencia MIT - ver el archivo [LICENSE](LICENSE) para más detalles.

## 👥 Equipo

- **Maintainer**: [Tu Nombre](https://github.com/tu-usuario)
- **Contributors**: Ver [contributors](https://github.com/tu-usuario/facturapi-saas/contributors)

## 🙏 Agradecimientos

- [FacturAPI](https://www.facturapi.io) por su excelente servicio de CFDI
- [Telegraf](https://telegraf.js.org) por el framework de bots
- [Prisma](https://www.prisma.io) por el ORM
- Todos los contributors del proyecto

---

<div align="center">

Hecho con ❤️ en México

[Reportar Bug](https://github.com/tu-usuario/facturapi-saas/issues) •
[Solicitar Feature](https://github.com/tu-usuario/facturapi-saas/issues) •
[Documentación](https://github.com/tu-usuario/facturapi-saas/wiki)

</div>
