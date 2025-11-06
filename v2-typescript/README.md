# FacturAPI SaaS v2 - TypeScript Edition

> Versión TypeScript del sistema de facturación SaaS multi-tenant basado en FacturAPI

## 🚀 Características

- ✅ **100% TypeScript** con tipado estricto
- ✅ **Sin Stripe** - Sistema de pagos removido
- ✅ **Multi-tenant** con aislamiento de datos
- ✅ **Bot de Telegram** para facturación fácil
- ✅ **Análisis de PDFs** con IA
- ✅ **Queue system** con Bull y Redis
- ✅ **Clustering** para alta disponibilidad
- ✅ **Prisma ORM** para base de datos
- ✅ **API REST** completa

## 📋 Requisitos

- Node.js >= 18.x
- PostgreSQL >= 14
- Redis >= 6
- npm >= 9

## 🛠️ Instalación

```bash
# Clonar el repositorio
cd facturapi-SaaS/v2-typescript

# Instalar dependencias
npm install

# Configurar variables de entorno
cp .env.example .env
# Editar .env con tus credenciales

# Generar Prisma Client
npm run prisma:generate

# Ejecutar migraciones
npm run prisma:migrate
```

## 🏃‍♂️ Desarrollo

```bash
# Iniciar servidor en modo desarrollo
npm run dev

# Iniciar bot de Telegram en modo desarrollo
npm run dev:bot

# Iniciar ambos simultáneamente
npm run dev:all

# Verificar tipos
npm run typecheck

# Ejecutar tests
npm test

# Ejecutar tests con cobertura
npm run test:coverage

# Lint y formato
npm run lint
npm run format
```

## 🏗️ Build y Producción

```bash
# Compilar TypeScript a JavaScript
npm run build

# Iniciar servidor en producción
npm start

# Iniciar con clustering
npm run start:cluster

# Iniciar bot
npm run start:bot

# Iniciar todo
npm run start:all
```

## 📁 Estructura del Proyecto

```
v2-typescript/
├── src/
│   ├── api/              # API REST
│   │   ├── controllers/  # Controladores
│   │   ├── middlewares/  # Middlewares
│   │   └── routes/       # Rutas
│   ├── bot/              # Telegram Bot
│   │   ├── handlers/     # Handlers de comandos
│   │   ├── commands/     # Definición de comandos
│   │   ├── middlewares/  # Middlewares del bot
│   │   └── views/        # Templates de mensajes
│   ├── services/         # Servicios de negocio
│   ├── core/             # Funcionalidades core
│   │   ├── auth/         # Autenticación
│   │   ├── utils/        # Utilidades
│   │   ├── subscription/ # Sistema de suscripciones
│   │   └── storage/      # Almacenamiento
│   ├── config/           # Configuración
│   ├── types/            # Definiciones de tipos
│   ├── jobs/             # Jobs de background
│   ├── scripts/          # Scripts de utilidad
│   ├── server.ts         # Servidor principal
│   ├── bot.ts            # Bot de Telegram
│   └── cluster.ts        # Clustering
├── dist/                 # Build output
├── prisma/               # Schema de base de datos
├── tests/                # Tests
├── package.json
├── tsconfig.json
└── README.md
```

## 🔧 Scripts Disponibles

| Script | Descripción |
|--------|-------------|
| `npm run dev` | Inicia servidor en modo desarrollo |
| `npm run dev:bot` | Inicia bot en modo desarrollo |
| `npm run dev:all` | Inicia servidor y bot |
| `npm run build` | Compila TypeScript |
| `npm start` | Inicia servidor en producción |
| `npm run typecheck` | Verifica tipos sin compilar |
| `npm test` | Ejecuta tests |
| `npm run lint` | Ejecuta ESLint |
| `npm run format` | Formatea código con Prettier |
| `npm run prisma:generate` | Genera Prisma Client |
| `npm run prisma:migrate` | Ejecuta migraciones |
| `npm run prisma:studio` | Abre Prisma Studio |

## 🌐 Variables de Entorno

Ver `.env.example` para la lista completa de variables requeridas.

Variables críticas:
- `DATABASE_URL` - Conexión a PostgreSQL
- `REDIS_URL` - Conexión a Redis
- `FACTURAPI_USER_KEY` - API key de FacturAPI
- `TELEGRAM_BOT_TOKEN` - Token del bot de Telegram
- `JWT_SECRET` - Secret para tokens JWT

## 🧪 Testing

```bash
# Ejecutar todos los tests
npm test

# Tests en modo watch
npm run test:watch

# Cobertura de tests
npm run test:coverage
```

## 📝 Migración desde v1

Esta es la versión TypeScript del proyecto. La versión original en JavaScript está en la raíz del repositorio.

**Diferencias principales:**
- TypeScript en lugar de JavaScript
- Sin integración con Stripe
- Mejor tipado y autocompletado
- Arquitectura más robusta

## 🚨 Importantes

1. **Sin Stripe**: Esta versión NO incluye integración con Stripe. El sistema de pagos fue removido completamente.

2. **Base de datos compartida**: Por defecto comparte la base de datos con v1. Asegúrate de que las migraciones estén actualizadas.

3. **Puertos**:
   - API: 3001
   - Bull Board: 3002
   - Configura diferentes puertos si corres v1 y v2 simultáneamente

## 📚 Documentación

- [Plan de Migración](../PLAN_MIGRACION_V2.md)
- [Roadmap Original](../ROADMAP_MIGRACION_TYPESCRIPT.md)
- [FacturAPI Docs](https://www.facturapi.io/docs)
- [Telegraf Docs](https://telegraf.js.org/)

## 🤝 Contribuir

1. Crear rama: `git checkout -b feature/nueva-funcionalidad`
2. Commit: `git commit -m 'feat: agregar nueva funcionalidad'`
3. Push: `git push origin feature/nueva-funcionalidad`
4. Crear Pull Request

## 📄 Licencia

ISC

---

**Versión:** 2.0.0
**Estado:** En desarrollo activo
**Última actualización:** 2025-10-31
