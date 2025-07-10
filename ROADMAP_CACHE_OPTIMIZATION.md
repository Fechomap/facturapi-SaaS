# 🗺️ ROADMAP - AXA Flow Optimization por Fases

## 📋 **OBJETIVO GENERAL**
Optimizar el rendimiento del handler AXA eliminando cálculos on-demand y implementando precarga de clientes + precálculo de facturas.

## 🔍 **ANÁLISIS INICIAL REVISADO**
- **Problema REAL:** Flujo ineficiente con cálculos on-demand y búsquedas innecesarias
- **Cache NO es la solución:** El problema es arquitectural, no de velocidad de acceso
- **Solución CORRECTA:** Precarga + precálculo + botones que solo seleccionan

## 🚨 **DESCUBRIMIENTOS CRÍTICOS**

### **1. Cache de Cliente es ABSURDO**
- Al presionar botón AXA → Usuario ya declara que factura AXA
- Cliente AXA debería estar **precargado** inmediatamente
- Buscar por `contains: 'AXA'` es innecesario

### **2. Cálculos On-Demand INEFICIENTES**
- **Actual:** Botón "Generar Factura" calcula todo en ese momento
- **Optimizado:** Precalcular ambas opciones (con/sin retención) durante Excel
- **Botones:** Solo seleccionan datos ya preparados

### **3. Session Upsert VARIABLE**
- Primera ejecución: 6975ms
- Segunda ejecución: 1217ms
- Variabilidad 6x indica problema de BD/sesiones

---

## 📊 **FASES DE IMPLEMENTACIÓN REVISADAS**

### **FASE 1: PRECARGA CLIENTE AXA** 🟢
**Objetivo:** Eliminar búsqueda de cliente y usar precarga inmediata
**Duración estimada:** 30 minutos
**Archivos a modificar:** 1

#### ✅ **Tareas:**
1. **Modificar `bot/handlers/axa.handler.js` líneas 108-128**
   - Eliminar búsqueda por `contains: 'AXA'`
   - Usar cliente AXA directo del tenant
   - Precarga inmediata al presionar botón

2. **Verificar relación tenant → cliente AXA**
   - Confirmar que cada tenant tiene cliente AXA configurado
   - Usar ID directo sin búsqueda

#### 🧪 **Criterios de éxito:**
- [✅] Botón AXA carga cliente inmediatamente
- [✅] Sin búsquedas por nombre (usa RFC directo)
- [⚠️] Tiempo de respuesta: 129ms (ligeramente > 100ms pero muy bueno)
- [✅] Sin errores en logs

#### 📝 **Rollback plan:**
- Revertir a búsqueda por `contains: 'AXA'`
- Restaurar cache original

---

### **FASE 2: PRECÁLCULO EXCEL AXA** 🟡
**Objetivo:** Calcular ambas opciones (con/sin retención) durante procesamiento Excel
**Duración estimada:** 45 minutos
**Archivos a modificar:** 1

#### ✅ **Tareas:**
1. **Modificar procesamiento Excel en `axa.handler.js`**
   - Calcular facturas CON retención 4%
   - Calcular facturas SIN retención
   - Guardar ambos resultados en `global.tempAxaData`

2. **Preparar datos para FacturAPI**
   - Formato completo para cada escenario
   - Items, impuestos, retenciones precalculados
   - Totales finales listos

#### 🧪 **Criterios de éxito:**
- [✅] Excel procesa ambas opciones
- [✅] Datos listos para FacturAPI (estructuras completas)
- [✅] Tiempo de procesamiento: 0ms (instantáneo!)
- [✅] Sin errores en cálculos (34 items, $60,183.16)

#### 📝 **Rollback plan:**
- Revertir a cálculo on-demand
- Restaurar flujo original

---

### **FASE 3: OPTIMIZAR BOTONES AXA** ✅
**Objetivo:** Botones solo seleccionan datos precalculados, no calculan
**Duración estimada:** 30 minutos
**Archivos a modificar:** 1

#### ✅ **Tareas:**
1. **Modificar botones en `axa.handler.js` líneas 193-253**
   - ✅ Botón "Servicios Realizados": Usar datos CON retención
   - ✅ Botón "Servicios Muertos": Usar datos SIN retención
   - ✅ Botón "Generar Factura": Envío directo a FacturAPI

2. **Eliminar cálculos on-demand**
   - ✅ Sin procesamiento en `axa_confirmar_final`
   - ✅ Datos ya preparados en formato FacturAPI
   - ✅ Generación inmediata

#### 🧪 **Criterios de éxito:**
- [✅] Botones responden inmediatamente (muestran totales precalculados)
- [✅] Sin cálculos en tiempo real (usa global.tempAxaData)
- [✅] Generación de factura directa (enviarFacturaDirectaAxa)
- [⏳] Sin errores en FacturAPI (pendiente testing)

#### 📝 **Rollback plan:**
- Revertir a cálculo on-demand
- Restaurar botones originales

**ESTADO:** ✅ FASE 3 COMPLETADA - Lista para testing

---

### **FASE 4: INVESTIGAR SESSION UPSERT** 🔵
**Objetivo:** Investigar y optimizar variabilidad session upsert (6975ms → 1217ms)
**Duración estimada:** 60 minutos
**Archivos a modificar:** 1-2

#### ✅ **Tareas:**
1. **Investigar `core/auth/session.service.js`**
   - Analizar por qué 6x variabilidad en upsert
   - Revisar queries lentas
   - Identificar bloqueos de BD

2. **Optimizar operaciones de sesión**
   - Reducir frecuencia de upsert
   - Batch operations si es posible
   - Mejorar índices si es necesario

#### 🧪 **Criterios de éxito:**
- [ ] Variabilidad < 2x entre ejecuciones
- [ ] Session upsert < 1000ms consistente
- [ ] Sin bloqueos de BD
- [ ] Logs estables

#### 📝 **Rollback plan:**
- Revertir cambios en session.service.js
- Restaurar configuración original

---

## 🔧 **IMPLEMENTACIÓN TÉCNICA REVISADA**

### **Flujo AXA Optimizado**
```javascript
// ACTUAL (INEFICIENTE)
Botón AXA → Buscar cliente → Excel → Calcular retención → Generar factura

// OPTIMIZADO (EFICIENTE)
Botón AXA → Cliente precargado → Excel → Precalcular AMBAS opciones → Botón selecciona
```

### **Estructura de Datos Precalculados**
```javascript
// global.tempAxaData[userId]
{
  clientId: "68671168de097f4e7bd4734c",
  facturaConRetencion: {
    items: [...],
    total: 67405.14,
    retenciones: [...]
  },
  facturaSinRetencion: {
    items: [...],
    total: 69812.47,
    retenciones: []
  }
}
```

### **Eliminación de Búsquedas**
- **Antes:** `findFirst({ legalName: { contains: 'AXA' } })`
- **Después:** Cliente directo del tenant configuration

---

## 📈 **MÉTRICAS DE ÉXITO**

### **Performance Targets**
- **AXA:** Mantener tiempo actual (sub-segundo)
- **CHUBB:** Reducir tiempo en 50%
- **PDF:** Reducir tiempo en 70%

### **Reliability Targets**
- **Cache hit rate:** >80%
- **Error rate:** <1%
- **Worker compatibility:** 100%

---

## 🚨 **RIESGOS Y MITIGACIONES**

### **Riesgo 1: Redis no disponible**
- **Mitigación:** Fallback a BD directa
- **Implementado:** Redis service tiene fallback a memoria

### **Riesgo 2: Cache stale**
- **Mitigación:** TTL de 24 horas
- **Implementado:** Redis TTL automático

### **Riesgo 3: Clustering issues**
- **Mitigación:** Usar Redis (compartido)
- **Implementado:** Redis ya funciona con clustering

---

## 📋 **CHECKLIST GENERAL**

### **Pre-implementación**
- [ ] Repositorio limpio (git reset --hard)
- [ ] Redis funcionando
- [ ] Tests básicos preparados

### **Durante implementación**
- [ ] Una fase a la vez
- [ ] Probar cada cambio
- [ ] Logs detallados
- [ ] Métricas de performance

### **Post-implementación**
- [ ] Todos los tests pasan
- [ ] Performance mejorada
- [ ] Logs sin errores
- [ ] Documentación actualizada

---

## 📞 **CONTACTO Y SEGUIMIENTO**

- **Responsable:** Claude Code
- **Método:** Implementación fase por fase
- **Validación:** Testing después de cada fase
- **Rollback:** Plan definido para cada fase

---

## 📝 **NOTAS**

- Cada fase debe completarse y probarse antes de continuar
- Rollback inmediato si algo falla
- Métricas de performance en cada fase
- Documentación actualizada progresivamente

---

**Estado:** ✅ Roadmap actualizado - Iniciando FASE 1
**Última actualización:** 2025-01-09

---

## 🚀 **INICIO FASE 1: PRECARGA CLIENTE AXA**

### **ANÁLISIS DE LOGS PRE-OPTIMIZACIÓN:**
```
Buscando cliente AXA para el tenant: 3ed011ab-1c1d-4a07-92ad-4b2eb35bcfdb
Cliente AXA encontrado: AXA ASSISTANCE MEXICO (ID: 68671168de097f4e7bd4734c)
```

### **PROBLEMA IDENTIFICADO:**
- Búsqueda innecesaria por `contains: 'AXA'`
- Cliente debería estar precargado al presionar botón

### **SOLUCIÓN IMPLEMENTANDO:**
- Eliminar búsqueda por nombre
- Usar cliente directo del tenant
- Precarga inmediata < 100ms

---

### **✅ RESULTADOS FASE 1:**
```
🔍 FASE 1: Obteniendo cliente AXA directo por RFC para tenant: 3ed011ab-1c1d-4a07-92ad-4b2eb35bcfdb
✅ FASE 1: Cliente AXA obtenido en 129ms (encontrado)
🎯 FASE 1: Cliente AXA cargado exitosamente: AXA ASSISTANCE MEXICO (ID: 68671168de097f4e7bd4734c)
```

**ESTADO:** ✅ FASE 1 COMPLETADA EXITOSAMENTE  
**PRÓXIMO:** Evaluar si continuar con FASE 2 o investigar session upsert

---

### **✅ RESULTADOS FASE 2:**
```
🔄 FASE 2: Iniciando precálculo de facturas con y sin retención...
✅ FASE 2: Precálculo completado en 0ms
📊 FASE 2: Subtotal base: $60183.16
📊 FASE 2: CON retención (IVA 16% - Ret 4%): 34 items, Total: $67405.14
📊 FASE 2: SIN retención (IVA 16% solamente): 34 items, Total: $69812.47
```

**ESTADO:** ✅ FASE 2 COMPLETADA EXITOSAMENTE  
**LOGRO:** Precálculo instantáneo (0ms) - Ambos escenarios con cálculos correctos

---

**¿CONTINUAR CON FASE 3: OPTIMIZAR BOTONES AXA?**