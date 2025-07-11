# FacturAPI SaaS

Sistema de facturación multitenant basado en FacturAPI. Plataforma que permite gestionar múltiples empresas (tenants) para emitir y administrar facturas electrónicas CFDI 4.0 a través de una API REST y un Bot de Telegram.

## 📋 Estado del Proyecto

- ✅ **Desarrollo Completo**: Sistema funcional con todas las características
- ✅ **Despliegue en Railway**: Producción estable 
- ✅ **Optimización de Performance**: Bot optimizado de 8-10s a 1.6s (83% mejora)
- ✅ **Documentación Completa**: Proyecto totalmente documentado
- ✅ **Testing**: Suite de tests unitarios e integración
- ✅ **Clustering**: Soporte para múltiples workers con Redis

## 🚀 Producción en Railway

**URL de Producción**: `https://web-production-9fbe9.up.railway.app`

- **API REST**: `/api/*`
- **Bot Telegram**: `/telegram-webhook`
- **Base de Datos**: PostgreSQL optimizada
- **Redis**: Clustering y sesiones
- **Monitoreo**: Logs y métricas integradas

## 🏗️ Arquitectura del Sistema

### Componentes Principales

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Telegram Bot  │────│   API Gateway   │────│   FacturAPI     │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         └───────────────────────┼───────────────────────┘
                                │
                    ┌─────────────────┐
                    │   PostgreSQL    │
                    │   (Multienant)  │
                    └─────────────────┘
                                │
                    ┌─────────────────┐
                    │     Redis       │
                    │  (Sessions)     │
                    └─────────────────┘
```

### Multitenancy

- **Aislamiento por Tenant**: Cada empresa tiene datos completamente separados
- **API Keys Únicas**: Cada tenant maneja sus propias credenciales de FacturAPI
- **Facturación Independiente**: Planes y suscripciones por empresa
- **Seguridad**: Autenticación JWT y validación de tenancy

## 📱 Bot de Telegram

### Características Principales

- **Autenticación por Empresa**: Los usuarios se registran bajo un tenant específico
- **Facturación Completa**: Crear, consultar, cancelar facturas
- **Gestión de Clientes**: Alta y búsqueda de clientes
- **Descarga de Documentos**: PDF y XML de facturas
- **Reportes**: Estadísticas y reportes de facturación
- **Administración**: Comandos admin para gestión del sistema

### Comandos Disponibles

- `/start` - Registro e inicio de sesión
- `/menu` - Menú principal de opciones
- `/facturar` - Crear nueva factura
- `/consultar` - Buscar facturas existentes
- `/clientes` - Gestión de clientes
- `/reportes` - Ver estadísticas
- `/admin` - Comandos administrativos (solo admins)

### Optimizaciones de Performance

- **Cache de FacturAPI**: Reduce tiempo de inicialización de 70ms a 7ms
- **Query Atómica**: getNextFolio optimizado de 1,987ms a 190ms
- **PostgreSQL VACUUM**: Base de datos optimizada con bloat <20%
- **Índices Avanzados**: Consultas optimizadas para multitenancy
- **Redis Sessions**: Sesiones distribuidas para clustering

## 🔧 Variables de Entorno

### Obligatorias

| Variable | Descripción |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string (para clustering) |
| `FACTURAPI_USER_KEY` | Clave administrativa de FacturAPI |
| `TELEGRAM_BOT_TOKEN` | Token del bot de Telegram |
| `STRIPE_SECRET_KEY` | Clave secreta de Stripe |
| `JWT_SECRET` | Secreto para tokens JWT |
| `ADMIN_CHAT_IDS` | IDs de admins separados por comas |

### Opcionales

| Variable | Descripción | Default |
|----------|-------------|---------|
| `NODE_ENV` | Entorno de ejecución | `development` |
| `API_BASE_URL` | URL base de la API | `http://localhost:3001` |
| `PORT` | Puerto del servidor | `3000` |

## 🛠️ Desarrollo Local

### Prerrequisitos

- Node.js 18+
- PostgreSQL 13+
- Redis (opcional, para clustering)

### Instalación

```bash
# Clonar repositorio
git clone <repo-url>
cd facturapi-SaaS

# Instalar dependencias
npm install

# Configurar variables de entorno
cp .env.example .env
# Editar .env con tus credenciales

# Generar cliente Prisma
npx prisma generate

# Aplicar migraciones
npx prisma db push

# Iniciar en desarrollo
npm run dev:all  # API + Bot
```

### Scripts Disponibles

```bash
# Desarrollo
npm run dev          # Solo API
npm run dev:bot      # Solo Bot
npm run dev:all      # API + Bot

# Producción
npm start            # Servidor único
npm run start:cluster # Clustering con PM2

# Testing
npm test             # Tests unitarios
npm run test:integration # Tests de integración
npm run test:clustering  # Tests de clustering

# Utilidades
npm run cleanup:sessions # Limpiar sesiones
npm run studio       # Prisma Studio
```

## 📊 Monitoreo y Performance

### Métricas de Performance (Post-Optimización)

| Operación | Antes | Después | Mejora |
|-----------|-------|---------|--------|
| **Bot Total** | 8-10s | 1.6s | **83%** |
| getNextFolio | 1,987ms | 190ms | 90.4% |
| getFacturapiClient | 70ms | 7ms | 90.0% |
| getUserState | 65ms | 68ms | Estable |

### Endpoints de Monitoreo

- `GET /api/cluster/health` - Health check completo
- `GET /api/cluster/info` - Información del worker
- `GET /api/cluster/metrics` - Métricas detalladas
- `GET /api/info` - Estado general del sistema

### Logs en Railway

```bash
# Ver logs en tiempo real
railway logs --follow

# Logs específicos
railway logs --filter="ERROR"
railway logs --filter="Performance"

# Conectar a base de datos
railway connect
```

## 🔐 Seguridad

### Autenticación y Autorización

- **JWT Tokens**: Autenticación stateless
- **Session Management**: Redis para sesiones distribuidas
- **Tenant Isolation**: Validación estricta de tenancy
- **Admin Roles**: Permisos especiales para administradores

### API Keys de FacturAPI

- **FACTURAPI_USER_KEY**: Clave administrativa para:
  - Crear nuevas organizaciones
  - Operaciones de onboarding
  - Administración del SaaS

- **Tenant Keys**: Almacenadas en DB por tenant:
  - `facturapiLiveKey`: Producción
  - `facturapiTestKey`: Pruebas
  - Aisladas por empresa

## 📁 Estructura del Proyecto

```
├── api/                    # API REST endpoints
│   ├── controllers/        # Controladores
│   ├── middlewares/        # Middleware personalizado
│   └── routes/            # Rutas de la API
├── bot/                   # Bot de Telegram
│   ├── commands/          # Comandos del bot
│   ├── handlers/          # Manejadores de eventos
│   └── views/             # Templates de mensajes
├── config/                # Configuración del sistema
├── core/                  # Funcionalidades centrales
│   ├── auth/              # Autenticación
│   ├── middleware/        # Middleware global
│   └── utils/             # Utilidades
├── lib/                   # Bibliotecas y helpers
├── prisma/                # Esquema y migraciones
├── services/              # Lógica de negocio
├── scripts/               # Scripts de utilidad
├── tests/                 # Suite de testing
├── optimization-project/  # Documentación de optimización
└── backups/              # Backups de base de datos
```

## 🧪 Testing

### Suite de Tests

- **Unitarios**: Servicios y funciones individuales
- **Integración**: Flujos completos del bot
- **Clustering**: Tests de múltiples workers
- **Performance**: Benchmarks y métricas

```bash
# Ejecutar todos los tests
npm run test:all

# Tests específicos
npm run test:redis          # Redis sessions
npm run test:pdf           # Análisis de PDF
npm run test:invoice       # Generación de facturas
npm run test:clustering    # Clustering
```

## 🚀 Despliegue

### Railway (Recomendado)

1. **Conectar repositorio** en Railway dashboard
2. **Configurar variables** de entorno
3. **Auto-deploy** desde branch `main`

### Variables en Railway

```bash
# Ver variables actuales
railway variables

# Configurar nueva variable
railway variables set KEY=value

# Logs de despliegue
railway logs --deployment
```

## 📚 Documentación Adicional

- **Optimización**: `optimization-project/00-INDICE-MAESTRO-LECTURA.md`
- **API Reference**: Endpoints documentados en código
- **Bot Commands**: `bot/commands/README.md`
- **Testing Guide**: `tests/README-subscription-tests.md`

## 🆘 Troubleshooting

### Problemas Comunes

1. **Bot no responde**:
   ```bash
   # Verificar webhook
   curl https://api.telegram.org/bot<TOKEN>/getWebhookInfo
   
   # Ver logs
   railway logs --filter="telegram"
   ```

2. **Database lenta**:
   ```bash
   # Verificar bloat
   railway run node scripts/benchmark-before-after.js
   ```

3. **Redis disconnected**:
   ```bash
   # Test Redis connection
   railway run node scripts/test-redis.js
   ```

### Contacto de Soporte

- **Logs**: `railway logs --follow`
- **Métricas**: `railway open` → Metrics
- **Database**: `railway connect`

---

## 📈 Roadmap

- [ ] Frontend web para administración
- [ ] API webhooks para integraciones
- [ ] Reportes avanzados con gráficas
- [ ] Soporte para más tipos de documentos
- [ ] Integración con más PSPs

---

**Última actualización**: Julio 2025  
**Versión**: 1.0.0  
**Estado**: Producción estable