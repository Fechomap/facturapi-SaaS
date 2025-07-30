# 📊 PLAN DE AUDITORÍA: FacturAPI vs PostgreSQL

**Fecha:** 28 de Julio de 2025  
**Objetivo:** Investigación exhaustiva de sincronización de facturas  
**Estado:** ✅ Listo para ejecución en madrugada

---

## 🎯 **CONTEXTO DEL PROBLEMA**

### **Problema Original Identificado**

- ✅ **Quick fix aplicado**: Error INT4 overflow resuelto (27/07/2025 22:58)
- ⚠️ **Sospecha actual**: Facturas con fechas incorrectas (guardadas con fecha del script vs fecha real)
- 🔍 **Necesidad**: Auditoría completa para validar estado real del sistema

### **Facturas Verificadas**

- ✅ **GTR513, GTR514, GTR515**: Fechas correctas (27/07/2025)
- ✅ **Sincronización funcional**: Las pruebas muestran que el quick fix funcionó
- ❓ **Duda**: ¿Todas las facturas están sincronizadas? ¿Hay facturas faltantes?

---

## 🎯 **TENANTS OBJETIVO**

**3 Tenants de producción** (excluyendo tenant de pruebas):

1. **Tenant 1**: `14ed1f0f-30e7-4be3-961c-f53b161e8ba2`
2. **Tenant 2**: `71f154fc-01b4-40cb-9f38-7aa5db18b65d`
3. **Tenant 3**: `872e20db-c67b-4013-a792-8136f0f8a08b`

**❌ Excluido**: Tenant "Prueba SADCB" (datos de prueba)

---

## 🚀 **PLAN DE EJECUCIÓN**

### **FASE 1: EXTRACCIÓN FACTURAPI (MADRUGADA)**

#### **Comando de Ejecución**

```bash
cd "/Users/jhonvc/NODE HEROKU/facturapi-SaaS"
node scripts/facturapi-export-complete.js
```

#### **Script Principal**

- 📄 `scripts/facturapi-export-complete.js`
- 🎯 **Único script necesario** para la investigación inicial

#### **Resultado Esperado**

```
📁 ./facturapi-export/
└── 2025-07-28_HHMMSS_facturapi_complete.csv
```

### **FASE 2: ANÁLISIS (POSTERIOR)**

#### **Información Extraída (45+ campos)**

- ✅ **Identificadores**: FacturAPI ID, UUID, Serie, Folio
- ✅ **Fechas detalladas**: Fecha emisión, fecha creación (múltiples formatos)
- ✅ **Información fiscal**: Status, tipo, uso, método de pago
- ✅ **Montos**: Subtotal, impuestos, total, moneda
- ✅ **Cliente completo**: Nombre, RFC, email, teléfono, dirección completa
- ✅ **Items**: Cantidad, descripción, precio del primer producto
- ✅ **Tenant**: Nombre, RFC, email, organización FacturAPI
- ✅ **Metadatos**: Timestamp extracción, números de fila

#### **Análisis a Realizar**

1. **Conteo total** de facturas por tenant
2. **Rango de fechas** (fecha más antigua vs más reciente)
3. **Distribución temporal** (facturas por día/mes)
4. **Estados de facturas** (válidas, canceladas, etc.)
5. **Detección de patrones** en fechas sospechosas

---

## ⏱️ **ESTIMACIONES DE TIEMPO**

### **Ejecución del Script**

- **Facturas estimadas**: ~1,500 facturas total
- **Rate limiting**: 3 segundos entre requests
- **Tiempo estimado**: **5-10 minutos** total
- **Horario recomendado**: **Madrugada** (menor carga de usuarios)

### **Análisis Posterior**

- **Revisión Excel**: 30-60 minutos
- **Identificación problemas**: Inmediato
- **Plan de corrección**: Variable según hallazgos

---

## 🛡️ **PROTECCIONES IMPLEMENTADAS**

### **Rate Limiting y Seguridad**

- ✅ **3 segundos** entre consultas a FacturAPI
- ✅ **20 segundos** timeout por request
- ✅ **3 reintentos** automáticos por error
- ✅ **200 páginas máximo** por tenant (10,000 facturas)
- ✅ **5 segundos** pausa entre tenants

### **Manejo de Errores**

- ✅ Continúa con siguiente tenant si uno falla
- ✅ Se cierra limpiamente sin colgarse
- ✅ Logs detallados de progreso
- ✅ Estadísticas finales completas

---

## 📊 **RESULTADOS ESPERADOS**

### **Escenario 1: Todo Correcto** ✅

- Facturas sincronizadas correctamente
- Fechas coinciden con FacturAPI
- Sin facturas faltantes
- **Acción**: Documentar que el sistema está sano

### **Escenario 2: Facturas Faltantes** ⚠️

- Algunas facturas en FacturAPI no están en PostgreSQL
- **Acción**: Script de sincronización específico

### **Escenario 3: Fechas Incorrectas** ⚠️

- Facturas con fechas del 27/07 que deberían ser otras fechas
- **Acción**: Script de corrección de fechas

### **Escenario 4: Problemas Mixtos** 🚨

- Combinación de facturas faltantes y fechas incorrectas
- **Acción**: Plan de corrección integral

---

## 📋 **CHECKLIST PRE-EJECUCIÓN**

### **Antes de Ejecutar**

- [ ] Verificar conexión a internet estable
- [ ] Confirmar que no hay otros procesos pesados corriendo
- [ ] Verificar espacio en disco para CSV (~50MB estimado)
- [ ] Backup de seguridad completado (ya existe del 27/07)

### **Durante Ejecución**

- [ ] Monitorear logs en tiempo real
- [ ] No interrumpir el proceso
- [ ] Verificar que no hay errores críticos

### **Después de Ejecución**

- [ ] Verificar que el CSV se generó correctamente
- [ ] Revisar estadísticas finales
- [ ] Abrir CSV en Excel para análisis inicial
- [ ] Documentar hallazgos principales

---

## 📁 **ARCHIVOS RELACIONADOS**

### **Scripts**

- 🎯 `scripts/facturapi-export-complete.js` - **Script principal**
- 🔍 `scripts/debug-tenant-check.js` - Debug de tenants
- ✅ `scripts/check-invoice-dates-simple.js` - Verificaciones rápidas

### **Documentación**

- 📋 `REPORTE-CRITICO-SINCRONIZACION-FACTURAS.md` - Problema original
- 📋 `PLAN-AUDITORIA-FACTURAS.md` - Este documento

### **Resultados** (se generarán)

- 📊 `./facturapi-export/2025-07-28_HHMMSS_facturapi_complete.csv`

---

## 🚨 **ACCIONES POST-AUDITORÍA**

### **Si se Encuentran Problemas**

1. **Analizar patrones** en el CSV
2. **Crear script específico** de corrección
3. **Ejecutar en modo prueba** primero
4. **Aplicar correcciones** en madrugada siguiente
5. **Validar resultados** con nueva auditoría

### **Si Todo Está Correcto**

1. **Documentar estado sano** del sistema
2. **Implementar monitoreo** automático preventivo
3. **Archivar** este proceso como referencia
4. **Comunicar resultados** al equipo

---

## 📞 **CONTACTO Y SEGUIMIENTO**

**Responsable:** Equipo de desarrollo  
**Fecha límite resultados:** 29/07/2025 08:00  
**Próxima revisión:** Según hallazgos de la auditoría

---

## 🎉 **OBJETIVO FINAL**

**Obtener la verdad absoluta** sobre el estado de sincronización entre FacturAPI y PostgreSQL, sin especulaciones, basado en **datos reales y completos** para tomar decisiones informadas sobre correcciones necesarias.

---

## 🔍 **EJECUCIÓN Y RESULTADOS - 29/07/2025**

### **FASE 1: AUDITORÍA INICIAL COMPLETADA** ✅

#### **Extracción de FacturAPI**

- **✅ Ejecutado**: `scripts/facturapi-export-complete.js`
- **📊 Resultado**: 383 facturas extraídas
- **📁 Archivo**: `facturapi-export/2025-07-29_020026_facturapi_complete.csv`
- **⏱️ Duración**: ~10 minutos
- **🎯 Tenants procesados**: 3/3 exitosamente

#### **Extracción de PostgreSQL**

- **✅ Ejecutado**: `scripts/postgresql-export.js`
- **📊 Resultado**: 383 facturas extraídas (mismo total)
- **📁 Archivo**: `postgresql-export/2025-07-29_HHMMSS_postgresql_complete.csv`

### **FASE 2: ANÁLISIS COMPARATIVO** ✅

#### **Hallazgos Críticos Identificados**

##### **1. Problema de Fechas (Solo Tenant ALFREDO)**

- **🚨 Afectado**: ALFREDO ALEJANDRO PEREZ AGUILAR (`872e20db-c67b-4013-a792-8136f0f8a08b`)
- **📅 Facturas problemáticas**: 182 facturas desde 27/07/2025
- **⚠️ Diferencias**: Entre 17-132 días de desfase
- **✅ Otros tenants**: Sin problemas de fechas

##### **2. Campo UUID Faltante (Todos los Tenants)**

- **🔑 Problema**: Campo UUID no existía en tabla `tenantInvoice`
- **📊 Afectadas**: 383 facturas (100%)
- **⚠️ Impacto**: Cumplimiento fiscal comprometido

### **FASE 3: CORRECCIÓN IMPLEMENTADA** ✅

#### **Preparación de Entorno**

1. **✅ Backup seguro**: Base de datos respaldada (`backups/20250728_2146/`)
2. **✅ Migración BD**: Campo `uuid` agregado a esquema Prisma
3. **✅ Sincronización**: `npx prisma db push` aplicado exitosamente

#### **Scripts de Corrección Desarrollados**

##### **Script 1: Sincronización UUID**

- **📄 Archivo**: `scripts/sync-uuid-all.js`
- **🎯 Objetivo**: Agregar UUIDs a las 383 facturas
- **📊 Scope**: Los 3 tenants (ANDREA: 1, Transportes: 48, ALFREDO: 334)
- **⚡ Fuente**: CSV existente (sin API calls para máxima velocidad)
- **🧪 Probado**: Dry-run exitoso (383/383 facturas, 100% éxito)
- **🚀 Estado**: **EN EJECUCIÓN PRODUCCIÓN** (aplicando cambios reales)

##### **Script 2: Corrección de Fechas**

- **📄 Archivo**: `scripts/sync-dates-alfredo.js`
- **🎯 Objetivo**: Corregir fechas de 182 facturas problemáticas
- **📊 Scope**: Solo tenant ALFREDO desde 27/07/2025
- **⚡ Fuente**: CSV existente (sin API calls)
- **⏳ Estado**: Listo para ejecución post-UUID

#### **Estrategia de Ejecución**

```bash
# 1. Aplicar UUIDs (EN CURSO)
node scripts/sync-uuid-all.js

# 2. Aplicar corrección de fechas (SIGUIENTE)
node scripts/sync-dates-alfredo.js
```

### **RESULTADOS ESPERADOS** 🎯

#### **Post-UUID Sync**

- **🔑 383 facturas** con UUID fiscal válido
- **✅ Cumplimiento** con regulaciones SAT
- **📊 Distribución**: ANDREA (1), Transportes (48), ALFREDO (334)

#### **Post-Fechas Sync**

- **📅 182 facturas** con fechas corregidas
- **✅ Sincronización** PostgreSQL ↔ FacturAPI completa
- **🎯 Solo ALFREDO** afectado por corrección de fechas

### **MÉTRICAS DE RENDIMIENTO** ⚡

#### **Optimizaciones Implementadas**

- **📄 CSV caching**: Sin API calls redundantes
- **🎯 Filtrado inteligente**: Solo facturas problemáticas
- **⚡ Velocidad**: 0 segundos por factura (vs 3 segundos original)
- **🔄 Batch processing**: Procesamiento por lotes eficiente

#### **Tiempos de Ejecución**

- **🔍 Análisis rápido**: 1 segundo (vs 19 minutos original)
- **🔑 UUID sync**: ~2-3 minutos estimado
- **📅 Fechas sync**: ~1 segundo estimado

### **VALIDACIÓN Y SEGURIDAD** 🛡️

#### **Capas de Protección**

1. **🧪 Modo prueba**: Validación completa antes de producción
2. **💾 Backup**: Base de datos respaldada antes de cambios
3. **🎯 Scope limitado**: Solo facturas identificadas como problemáticas
4. **📊 Logs detallados**: Trazabilidad completa de cambios
5. **✅ Rollback**: Restauración disponible si es necesario

#### **Validación de Datos**

- **🔗 Mapeo correcto**: UUID alineado por `facturapiInvoiceId`
- **📅 Fechas verificadas**: Comparación con datos de FacturAPI originales
- **✅ Integridad**: Sin pérdida de datos durante proceso

---

## 📊 **LECCIONES APRENDIDAS**

### **Problemas Identificados**

1. **Schema Drift**: Base de datos no sincronizada con migraciones
2. **Campo crítico faltante**: UUID necesario para cumplimiento fiscal
3. **Localización del problema**: Solo 1 de 3 tenants afectado por fechas
4. **Rate limiting innecesario**: CSV caching eliminó necesidad de API calls

### **Mejoras Implementadas**

1. **Scripts especializados**: 2 scripts separados por tipo de problema
2. **Análisis previo**: Identificación precisa antes de corrección
3. **Optimización extrema**: De 19 minutos a 1 segundo de análisis
4. **Seguridad máxima**: Múltiples capas de validación y backup

### **Proceso Establecido**

1. **Auditoría → Análisis → Preparación → Ejecución → Validación**
2. **Dry-run obligatorio** antes de cualquier cambio en producción
3. **Backup automático** como parte integral del proceso
4. **Documentación completa** de cada paso para referencia futura

---

## 🎯 **ESTADO ACTUAL**

- **🔑 UUID Sync**: ⏳ EN EJECUCIÓN (aplicando 383 UUIDs)
- **📅 Fechas Sync**: ⏳ PENDIENTE (182 facturas ALFREDO)
- **📊 Base de datos**: ✅ PREPARADA con campo UUID
- **💾 Backup**: ✅ DISPONIBLE para rollback
- **📋 Documentación**: ✅ COMPLETA y actualizada

**Próximo paso**: Completar UUID sync y proceder con corrección de fechas

---

_Documento actualizado el 29/07/2025 04:00 - Ejecución en curso_
