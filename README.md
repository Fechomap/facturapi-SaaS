# FacturAPI SaaS

Sistema de facturación en modo multitenancy basado en FacturAPI.

## Estado del Proyecto
- ✅ Fase 0: Preparación y Planificación (Completada)
- ✅ Fase 1: Implementación de Core y Configuración (Completada)
- ✅ Fase 2: Servicios de Negocio (Completada)
- ✅ Fase 3: API REST (Completada)
- ✅ Fase 4: Bot de Telegram (Completada)
- ✅ Fase 5: Integración del Almacenamiento de Documentos (Completada)
- ✅ Fase 6: Migración de Datos y Pruebas Finales (Completada)

## Guía Rápida de Operación

### Iniciar el sistema

1. **Desarrollo local**:
   ```bash
   # Iniciar API y servidor
   npm run dev
   
   # En otra terminal, iniciar bot de Telegram 
   npm run bot
   ```

2. **Producción**:
   ```bash
   # Iniciar el sistema completo
   npm start
   ```

### Operaciones en Heroku

#### Gestión de Dynos

#### Detener aplicaciones:
```bash
# Producción
heroku ps:scale web=0 bot=0 --app facturapi-saas

# Staging
heroku ps:scale web=0 bot=0 --app facturapi-staging

#### Iniciar aplicaciones:
```bash
# Producción
heroku ps:scale web=1 bot=1 --app facturapi-saas

# Staging
heroku ps:scale web=1 bot=1 --app facturapi-staging

#### Reinicio completo:
```bash
heroku restart --app facturapi-saas    # Producción
heroku restart --app facturapi-staging # Staging
```

#### Despliegue en Heroku

```bash
# Añadir remote de Heroku (solo primera vez)
heroku git:remote -a facturapi-saas

# Desplegar última versión
git push heroku main

# Ver los últimos logs después del despliegue
heroku logs --tail -a facturapi-saas
heroku logs --tail -a facturapi-staging

```

### Diagnóstico y Logs

#### Logs de aplicación

```bash
# Ver logs en tiempo real
heroku logs --tail -a facturapi-saas

# Filtrar logs del servidor API
heroku logs --tail -a facturapi-saas --source app

# Filtrar logs del bot
heroku logs --tail -a facturapi-saas --source worker
```

#### Logs locales

Los logs en desarrollo se almacenan en la carpeta `/logs`:

- `api-YYYY-MM-DD.log` - Logs del servidor API
- `bot-YYYY-MM-DD.log` - Logs del bot de Telegram
- `error-YYYY-MM-DD.log` - Errores críticos de ambos servicios

#### Diagnóstico rápido

1. **Problemas de conexión a la base de datos**:
   - Verificar la variable `DATABASE_URL`
   - En Heroku: `heroku config:get DATABASE_URL -a facturapi-saas`

2. **Problemas con el bot**:
   - Verificar token: `heroku config:get TELEGRAM_BOT_TOKEN -a facturapi-saas`
   - Consultar logs de worker: `heroku logs --source worker -a facturapi-saas`

3. **Problemas con FacturAPI**:
   - Verificar modo y API key: 
     ```bash
     heroku config:get FACTURAPI_ENV -a facturapi-saas
     heroku config:get FACTURAPI_TEST_KEY -a facturapi-saas
     heroku config:get FACTURAPI_LIVE_KEY -a facturapi-saas
     ```

## Configuración del entorno

El sistema maneja automáticamente la alternancia entre entornos de desarrollo y producción sin necesidad de cambios manuales.

### Variables de entorno

Copia el archivo `.env.example` a `.env` para desarrollo local:

```bash
cp .env.example .env
```

Las variables principales para configurar:

- `NODE_ENV`: Entorno de la aplicación (`development` o `production`)
- `FACTURAPI_ENV`: Entorno de Facturapi (`test` o `production`) - determina qué API key se utiliza
- `FACTURAPI_TEST_KEY`: API Key de FacturAPI para pruebas
- `FACTURAPI_LIVE_KEY`: API Key de FacturAPI para producción
- `DATABASE_URL`: URL de conexión a la base de datos PostgreSQL

### Entornos soportados

El sistema detecta automáticamente el entorno y ajusta su configuración:

1. **Desarrollo local**:
   - El sistema usa la URL `http://localhost:3000` automáticamente
   - Usa las rutas de archivos locales para almacenamiento
   - Habilita mensajes de depuración detallados

2. **Producción (Heroku)**:
   - Se detecta automáticamente cuando se ejecuta en Heroku
   - Usa la URL de Heroku (`https://{app-name}.herokuapp.com`)
   - Utiliza `/tmp/storage` para almacenamiento temporal
   - Optimiza logs para producción

## Modo prueba vs producción en Facturapi

El modo de prueba/producción en FacturAPI se determina **exclusivamente** por la variable `FACTURAPI_ENV`:

- Si `FACTURAPI_ENV=test`: Usa `FACTURAPI_TEST_KEY` (entorno de pruebas)
- Si `FACTURAPI_ENV=production`: Usa `FACTURAPI_LIVE_KEY` (entorno de producción)

Esto permite ejecutar pruebas con datos reales usando el API key de producción incluso en entorno de desarrollo local.

## Base de datos

### Estructura de Entornos:
- **Producción**: Base de datos dedicada (facturapi-saas)
- **Staging**: Comparte base de datos con entorno local (facturapi-staging)

Se recomienda mantener bases de datos separadas para desarrollo y producción. En Heroku, la base de datos se configura automáticamente mediante el add-on de PostgreSQL.

Para desarrollo local, configura una base de datos PostgreSQL y establece la URL en `DATABASE_URL`.

## Variables de depuración opcionales

- `DEBUG_DATABASE=true`: Habilita logging detallado de operaciones de base de datos
- `DEBUG_ERRORS=true`: Incluye detalles técnicos en respuestas de error
- `NOTIFY_CRITICAL_ERRORS=true`: Envía notificaciones de errores críticos

## Mantenimiento del sistema

### Script de Mantenimiento de Base de Datos
Ejecutar con: `node cleanup-database.js`

Opciones disponibles:
1. **Limpieza completa**: Elimina todos los datos excepto planes de suscripción
2. **Limpiar facturas y clientes**: Elimina solo facturas, clientes y documentos
3. **Limpiar tenant específico**: Elimina un tenant concreto y todos sus datos

### Limpieza de datos

El script `cleanup-database.js` permite limpiar datos en la base de datos:

```bash
# En desarrollo local
node cleanup-database.js

# En Heroku (con precaución, hacer backup primero)
heroku run node cleanup-database.js -a facturapi-saas
```

Opciones disponibles:
1. **Limpieza completa**: Elimina todos los datos excepto planes de suscripción
2. **Limpiar facturas y clientes**: Elimina solo facturas, clientes y documentos
3. **Limpiar tenant específico**: Elimina un tenant concreto y todos sus datos

### Copias de seguridad

```bash
# Crear backup en Heroku
heroku pg:backups:capture -a facturapi-saas

# Descargar último backup
heroku pg:backups:download -a facturapi-saas

# Listar backups disponibles
heroku pg:backups -a facturapi-saas
```

### Monitoreo

Para un monitoreo rápido del estado del sistema:

```bash
# Verificar estado de los dynos
heroku ps -a facturapi-saas

# Verificar uso de base de datos
heroku pg:info -a facturapi-saas

# Monitorear conexiones activas a la base de datos
heroku pg:connections -a facturapi-saas
```

## Despliegue en Heroku

Para desplegar en Heroku, asegúrate de configurar las siguientes variables en el dashboard:

- `FACTURAPI_ENV`
- `FACTURAPI_LIVE_KEY` (para producción)
- `FACTURAPI_TEST_KEY` (para pruebas)
- `FACTURAPI_USER_KEY`
- `HEROKU_APP_NAME` (el nombre de tu aplicación en Heroku)
- Otras variables requeridas como IDs de clientes

Heroku configura automáticamente `DATABASE_URL` al agregar el add-on de PostgreSQL.

## Ejecución en desarrollo

```bash
npm run dev
```

## Ejecución en producción

```bash
npm start
```
