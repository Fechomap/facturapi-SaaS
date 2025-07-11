# 🚀 CONFIGURAR REDIS EN RAILWAY

## ⚠️ **CRÍTICO PARA 100+ USUARIOS CONCURRENTES**

Sin Redis, las sesiones no se comparten entre workers del cluster, limitando la escalabilidad real.

## 📋 **Pasos para Configurar Redis en Railway:**

### 1️⃣ **Añadir Redis Service**
```bash
# En Railway Dashboard:
1. Ve a tu proyecto FacturAPI SaaS
2. Click "New Service" → "Database" → "Add Redis"
3. Railway creará automáticamente la variable REDIS_URL
```

### 2️⃣ **Variables Automáticas** 
Railway configurará automáticamente:
```bash
REDIS_URL="redis://default:password@redis-service.railway.internal:6379"
```

### 3️⃣ **Verificar Configuración**
Una vez configurado Redis, ejecuta:
```bash
node scripts/testing/test-redis.js
```

Debería mostrar:
```
✅ Redis URL configurada: SÍ
✅ Tipo de almacenamiento: redis
🎉 ¡REDIS FUNCIONANDO PERFECTAMENTE!
```

## 🎯 **Configuración Local (Desarrollo)**

Para desarrollo local, instala Redis:

### macOS:
```bash
brew install redis
brew services start redis
export REDIS_URL="redis://localhost:6379"
```

### Docker:
```bash
docker run -d --name redis -p 6379:6379 redis:latest
export REDIS_URL="redis://localhost:6379"
```

## 🔧 **Variables de Entorno Necesarias**

```bash
# Producción (Railway configura automáticamente)
REDIS_URL="redis://default:password@redis-service:6379"

# Desarrollo local
REDIS_URL="redis://localhost:6379"

# Opcionales para debugging
DEBUG_REDIS="true"
REDIS_CONNECT_TIMEOUT="10000"
REDIS_COMMAND_TIMEOUT="5000"
```

## 📊 **Monitoreo Redis**

Una vez configurado, puedes monitorear Redis:

```bash
# Endpoints de monitoreo
GET /api/cluster/sessions  # Estado de sesiones Redis
GET /api/cluster/metrics   # Métricas generales del cluster
```

## ⚡ **Impacto en Performance**

| Configuración | Usuarios Concurrentes | Sesiones Compartidas |
|---------------|------------------------|---------------------|
| **Sin Redis** | ~50 por worker | ❌ NO |
| **Con Redis** | 100-200+ total | ✅ SÍ |

## 🚨 **Importante**

**SIN REDIS**: El clustering funciona pero las sesiones son independientes por worker
**CON REDIS**: Clustering completo con sesiones totalmente compartidas

---

## 🎯 **Próximo Paso**: 
1. Ve a Railway Dashboard
2. Add Redis service  
3. Deploy el código actual
4. ¡Listo para 100+ usuarios! 🚀