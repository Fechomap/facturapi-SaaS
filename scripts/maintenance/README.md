# 🔧 Scripts de Mantenimiento

Esta carpeta contiene scripts para verificación y mantenimiento del sistema.

## 🔍 Scripts Disponibles

### `check-invoice-dates-simple.js`
**Verificación de fechas de facturas**

- **Propósito**: Compara fechas entre PostgreSQL y FacturAPI
- **Uso**: `node scripts/maintenance/check-invoice-dates-simple.js [tenantId] [limit]`
- **Ejemplo**: `node scripts/maintenance/check-invoice-dates-simple.js 3ed011ab-1c1d-4a07-92ad-4b2eb35bcfdb 5`

**Funcionalidad**:
- Consulta facturas sospechosas (desde 27/07/2025)
- Verifica cada factura contra FacturAPI
- Reporta diferencias de fechas
- Rate limiting incluido (3 segundos)

### `debug-tenant-check.js`
**Debug de información de tenant**

- **Propósito**: Verificar existencia y datos básicos de tenant
- **Uso**: `node scripts/maintenance/debug-tenant-check.js [tenantId]`
- **Default**: Usa tenant de pruebas si no se especifica

**Información mostrada**:
- Datos básicos del tenant
- Conteo de facturas
- Verificación de API key
- Status general

## 📋 Casos de Uso

### 1. **Verificación Post-Migración**
```bash
# Verificar que las fechas estén correctas después de una corrección
node scripts/maintenance/check-invoice-dates-simple.js [tenant-id] 10
```

### 2. **Debug de Problemas**
```bash
# Verificar si un tenant específico está configurado correctamente
node scripts/maintenance/debug-tenant-check.js [tenant-id]
```

### 3. **Monitoreo Rutinario**
- Ejecutar periódicamente para detectar discrepancias
- Validar integridad de datos
- Verificar conectividad con FacturAPI

## ⚙️ Parámetros

### check-invoice-dates-simple.js
- **tenantId**: ID del tenant a verificar (requerido)
- **limit**: Número máximo de facturas a verificar (default: 3)

### debug-tenant-check.js
- **tenantId**: ID del tenant a debuggear (optional, default: tenant de pruebas)

## 📊 Salida Esperada

### Fechas Correctas ✅
```
🔍 Verificando: A123
   Fecha en BD: 2025-07-15
   Fecha en FacturAPI: 2025-07-15
   ✅ FECHA CORRECTA
```

### Fechas Incorrectas ⚠️
```
🔍 Verificando: A124
   Fecha en BD: 2025-07-28
   Fecha en FacturAPI: 2025-07-15
   ⚠️ DIFERENCIA: 13 días
   ❌ NECESITA CORRECCIÓN: 2025-07-28 → 2025-07-15
```

## 🚨 Señales de Alerta

- **Muchas diferencias de fecha**: Posible problema de sincronización
- **Errores de API**: Verificar conectividad o API keys
- **Tenant no encontrado**: Verificar ID correcto
- **Timeouts**: Posible sobrecarga de FacturAPI

## 🔧 Solución de Problemas

### Error de Conexión
- Verificar internet y conectividad
- Validar API keys de FacturAPI
- Revisar configuración de base de datos

### Datos Incorrectos
- Usar scripts de data-extraction para análisis completo
- Revisar logs de sincronización anterior
- Validar integridad de base de datos

### Performance Lento
- Reducir el límite de facturas a verificar
- Verificar carga de FacturAPI
- Considerar horarios de menor uso