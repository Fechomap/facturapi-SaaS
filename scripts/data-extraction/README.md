# 📊 Scripts de Extracción de Datos

Esta carpeta contiene scripts para extraer datos completos de las fuentes principales del sistema.

## 📤 Scripts Disponibles

### `facturapi-export-complete.js`

**Extracción completa de FacturAPI**

- **Propósito**: Extrae TODAS las facturas de FacturAPI de los tenants configurados
- **Salida**: CSV + Excel con datos completos
- **Uso**: `node scripts/data-extraction/facturapi-export-complete.js`
- **Tiempo**: ~10 minutos para ~1,500 facturas
- **Rate Limiting**: 3 segundos entre requests (respeta API de FacturAPI)

**Campos extraídos**: 45+ campos incluyendo:

- Identificadores (FacturAPI ID, UUID, Folio)
- Fechas detalladas (emisión, creación)
- Información fiscal (status, tipo, uso)
- Datos del cliente completos
- Información del tenant

### `postgresql-export.js`

**Extracción completa de PostgreSQL**

- **Propósito**: Extrae todas las facturas de la base de datos local
- **Salida**: CSV + Excel con datos de PostgreSQL
- **Uso**: `node scripts/data-extraction/postgresql-export.js`
- **Tiempo**: ~1 segundo para cualquier cantidad
- **Ventaja**: Instantáneo, sin límites de API

**Campos extraídos**:

- IDs y referencias de facturas
- Fechas de base de datos
- Status y montos
- Referencias de cliente y tenant
- UUID (si existe)

## 🎯 Casos de Uso

### 1. **Auditoría Completa**

```bash
# Extraer de ambas fuentes para comparar
node scripts/data-extraction/facturapi-export-complete.js
node scripts/data-extraction/postgresql-export.js
```

### 2. **Análisis de Discrepancias**

- Compara las fechas entre ambas fuentes
- Identifica facturas faltantes
- Valida integridad de datos

### 3. **Incorporación de Nueva Empresa**

- Usar como base para nuevos tenants
- Adaptar IDs de tenant en el código
- Mantener la estructura de extracción

## ⚙️ Configuración

### Modificar Tenants Objetivo

En `facturapi-export-complete.js`:

```javascript
const TARGET_TENANTS = [
  'nuevo-tenant-id-1',
  'nuevo-tenant-id-2',
  // ...
];
```

### Personalizar Salida

- Cambiar `OUTPUT_DIR` para ubicación diferente
- Modificar campos extraídos según necesidades
- Ajustar formato de salida (CSV/Excel)

## 📁 Estructura de Salida

```
./facturapi-export/
└── YYYY-MM-DD_HHMMSS_facturapi_complete.csv
└── YYYY-MM-DD_HHMMSS_facturapi_complete.xlsx

./postgresql-export/
└── YYYY-MM-DD_HHMMSS_postgresql_complete.csv
└── YYYY-MM-DD_HHMMSS_postgresql_complete.xlsx
```

## ⚠️ Consideraciones

- **FacturAPI**: Respeta rate limits (3 seg entre requests)
- **PostgreSQL**: Sin límites, extracción instantánea
- **Memoria**: Para +10k facturas, considerar procesamiento por lotes
- **Tiempo**: FacturAPI depende del número de facturas

## 🔧 Mantenimiento

- Verificar conexiones de base de datos
- Actualizar tenants objetivo según necesidades
- Revisar campos extraídos periódicamente
- Validar integridad de archivos de salida
