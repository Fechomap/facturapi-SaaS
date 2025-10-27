# Análisis de Vulnerabilidades npm audit

**Fecha:** 2025-10-27
**Estado:** Análisis completo
**Severidad Total:** 16 vulnerabilidades (3 críticas, 6 altas, 7 bajas)

---

## 📋 Resumen Ejecutivo

**npm audit** reporta **16 vulnerabilidades** en las dependencias del proyecto:

| Severidad | Cantidad |
|-----------|----------|
| **Crítica** | 3 |
| **Alta** | 6 |
| **Media** | 0 |
| **Baja** | 7 |

**PRIORIDAD:** ⚠️ **ALTA** - Hay 3 vulnerabilidades críticas que deben resolverse.

---

## 🔴 Vulnerabilidades CRÍTICAS (3)

### 1. **xlsx - Prototype Pollution + ReDoS**

**Paquete:** `xlsx` (sin versión específica mencionada)
**Severidad:** CRÍTICA
**Vulnerabilidades:**
- GHSA-4r6h-8v6p-xvw6: Prototype Pollution in sheetJS
- GHSA-5pgg-2g8v-p4x9: SheetJS Regular Expression Denial of Service (ReDoS)

**Estado:** ❌ **No fix available**

**Impacto en el proyecto:**
```javascript
// Usado en:
// - bot/handlers/excel-report.handler.js
// - services/excel.service.js (si existe)
```

**Recomendaciones:**
1. **Evaluar alternativas:**
   - `exceljs` (más mantenido, menos vulnerabilidades)
   - `node-xlsx` (wrapper ligero)
2. **Si no es posible cambiar:**
   - Validar TODOS los inputs antes de procesar
   - Limitar tamaño de archivos procesados
   - Ejecutar en entorno aislado (sandbox)
3. **Monitorear:** Estar atento a cuando salga un fix

---

## 🟠 Vulnerabilidades ALTAS (6)

### 2. **axios - SSRF + DoS + CSRF**

**Paquete:** `axios` (versiones afectadas: <=0.30.1 || 1.0.0-1.11.0)
**Severidad:** ALTA
**Vulnerabilidades:**
- GHSA-jr5f-v2jv-69x6: SSRF and Credential Leakage via Absolute URL
- GHSA-4hjh-wcwx-xvwj: DoS attack through lack of data size check (2 instancias)
- GHSA-wf5p-g6vw-rhxx: Cross-Site Request Forgery (CSRF) - severity moderate

**Afecta a:** `bull-board` (dependencia indirecta)

**Fix disponible:** ✅ `npm audit fix --force`
⚠️ **BREAKING CHANGE:** Actualizará `bull-board@1.2.0`

**Impacto en el proyecto:**
- `bull-board` es usado para monitoreo de colas Bull
- Versión actual probablemente sea <1.2.0
- Actualizar a 1.2.0 puede romper compatibilidad

**Recomendaciones:**
1. **Probar en desarrollo:**
   ```bash
   npm install bull-board@latest --save-dev
   npm test
   ```
2. **Verificar cambios:** Revisar changelog de bull-board 1.x → 2.x
3. **Si funciona:** Aplicar en producción
4. **Si no funciona:** Considerar actualizar axios manualmente en bull-board

---

### 3. **body-parser - Denial of Service**

**Paquete:** `body-parser` (dependencia indirecta)
**Severidad:** ALTA
**Vulnerabilidad:**
- GHSA-qwcr-r2fm-qrc7: DoS when url encoding is enabled

**Fix disponible:** ✅ Probablemente a través de actualización de Express

**Recomendaciones:**
1. Verificar versión actual de Express
2. Actualizar Express a última versión estable
3. Configurar límites de payload:
   ```javascript
   app.use(express.json({ limit: '10mb' }));
   app.use(express.urlencoded({ extended: true, limit: '10mb' }));
   ```

---

### 4. **qs - Prototype Pollution**

**Paquete:** `qs` (versiones 6.7.0 - 6.7.2)
**Severidad:** ALTA
**Vulnerabilidad:**
- GHSA-hrpp-h998-j3pp: Prototype Pollution

**Afecta a:** `bull-board` (dependencia indirecta)

**Fix disponible:** ✅ Via actualización de bull-board

---

### 5. **send - Template Injection → XSS**

**Paquete:** `send` (<0.19.0)
**Severidad:** ALTA
**Vulnerabilidad:**
- GHSA-m6fv-jmcg-4jfg: Template injection that can lead to XSS

**Afecta a:** `bull-board → serve-static → send`

**Fix disponible:** ✅ Via actualización de bull-board

---

## 🟡 Vulnerabilidades BAJAS (7)

### 6. **pm2 - ReDoS**

**Paquete:** `pm2` (<=6.0.8)
**Severidad:** BAJA
**Vulnerabilidad:**
- GHSA-x5gf-qvw8-r2rm: Regular Expression Denial of Service

**Fix disponible:** ✅ `npm audit fix --force`
⚠️ **BREAKING CHANGE:** Actualizará a pm2@6.0.13

**Impacto:** PM2 es usado en producción para clustering

**Recomendaciones:**
1. **Actualizar en desarrollo primero:**
   ```bash
   npm install pm2@latest --save-dev
   ```
2. **Probar el cluster:**
   ```bash
   pm2 start ecosystem.config.js
   pm2 logs
   ```
3. **Verificar que no haya cambios de configuración**

---

### 7. **path-to-regexp - ReDoS**

**Paquete:** `path-to-regexp` (dependencia de bull-board)
**Severidad:** BAJA
**Vulnerabilidad:**
- GHSA-rhx6-c78j-4q9w: ReDoS

**Fix disponible:** ✅ Via actualización de bull-board

---

### 8. **tmp - Symlink Vulnerability**

**Paquete:** `tmp` (<=0.2.3)
**Severidad:** BAJA
**Vulnerabilidad:**
- GHSA-52f5-9888-hmc6: Arbitrary temporary file/directory write via symlink

**Fix disponible:** ✅ `npm audit fix` (sin breaking changes)

**Recomendaciones:**
- Ejecutar `npm audit fix` directamente

---

## 📊 Plan de Acción Priorizado

### FASE 1: Fixes Simples (SIN breaking changes) ⚡

```bash
# Ejecutar esto primero (arregla vulnerabilidades bajas sin romper nada)
npm audit fix
```

**Arreglará:**
- ✅ tmp (symlink vulnerability)
- ✅ Algunas otras vulnerabilidades menores

**Tiempo estimado:** 5 minutos
**Riesgo:** BAJO

---

### FASE 2: Actualizar bull-board ⚠️

**Problema:** bull-board trae consigo varias vulnerabilidades (axios, qs, send, path-to-regexp)

**Opción A: Actualizar bull-board (RECOMENDADO)**

```bash
# 1. Hacer backup
git add -A && git commit -m "backup: antes de actualizar bull-board"

# 2. Actualizar
npm install bull-board@latest

# 3. Verificar que la app funciona
npm start
# Abrir http://localhost:3000/admin/queues (o la URL de bull-board)

# 4. Si funciona, commitear
git add package*.json
git commit -m "fix: actualizar bull-board para resolver vulnerabilidades de axios, qs, send"
```

**Tiempo estimado:** 30 minutos (pruebas incluidas)
**Riesgo:** MEDIO (puede haber breaking changes)

**Opción B: Remover bull-board si no se usa**

```bash
# ¿Realmente usas bull-board en producción?
# Si NO lo usas, mejor eliminarlo:
npm uninstall bull-board
```

---

### FASE 3: Actualizar PM2 ⚠️

```bash
# 1. Backup
git add -A && git commit -m "backup: antes de actualizar pm2"

# 2. Actualizar
npm install pm2@latest

# 3. Probar localmente
pm2 delete all
pm2 start ecosystem.config.js
pm2 logs

# 4. Verificar que el cluster funciona
# 5. Commitear
```

**Tiempo estimado:** 20 minutos
**Riesgo:** BAJO-MEDIO

---

### FASE 4: Evaluar xlsx (NO hay fix automático) 🔴

**Esta es la más crítica pero también la más difícil.**

**Opción A: Migrar a `exceljs`**

```bash
npm install exceljs
npm uninstall xlsx
```

Luego refactorizar el código:

```javascript
// ANTES (xlsx):
const XLSX = require('xlsx');
const workbook = XLSX.readFile(filePath);

// DESPUÉS (exceljs):
const ExcelJS = require('exceljs');
const workbook = new ExcelJS.Workbook();
await workbook.xlsx.readFile(filePath);
```

**Tiempo estimado:** 4-8 horas (depende de cuánto uses xlsx)
**Riesgo:** ALTO (requiere refactoring)
**Beneficio:** Elimina vulnerabilidades críticas

**Opción B: Mitigación temporal**

Si NO puedes cambiar xlsx ahora mismo:

```javascript
// Agregar validaciones estrictas:
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_EXTENSIONS = ['.xlsx', '.xls'];

function validateExcelFile(file) {
  // 1. Verificar tamaño
  if (file.size > MAX_FILE_SIZE) {
    throw new Error('Archivo demasiado grande');
  }

  // 2. Verificar extensión
  const ext = path.extname(file.name).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    throw new Error('Formato no permitido');
  }

  // 3. Validar que sea de fuente confiable (solo admins pueden subir)
  if (!user.isAdmin) {
    throw new Error('Sin permisos');
  }

  return true;
}
```

---

## 🎯 Resumen de Comandos

### Ejecución Secuencial (RECOMENDADO)

```bash
# PASO 1: Fixes simples sin breaking changes
npm audit fix
git add package*.json
git commit -m "fix: resolver vulnerabilidades bajas con npm audit fix"

# PASO 2: Actualizar bull-board (PROBAR EN DESARROLLO PRIMERO)
npm install bull-board@latest
npm start  # Verificar que funciona
git add package*.json
git commit -m "fix: actualizar bull-board para resolver axios, qs, send vulnerabilities"

# PASO 3: Actualizar PM2 (PROBAR EN DESARROLLO PRIMERO)
npm install pm2@latest
pm2 start ecosystem.config.js  # Probar
git add package*.json
git commit -m "fix: actualizar pm2 a 6.0.13+ para resolver ReDoS"

# PASO 4: Plan para xlsx
# (Requiere análisis de código y potencial refactoring - ver Opción A o B arriba)
```

---

## 📈 Resultados Esperados

Después de ejecutar **PASO 1-3**:

| Estado Actual | Estado Esperado |
|---------------|-----------------|
| 16 vulnerabilidades | ~4-5 vulnerabilidades |
| 3 críticas | 2 críticas (solo xlsx) |
| 6 altas | 0-1 altas |
| 7 bajas | 0 bajas |

**El único problema restante sería xlsx**, que requiere decisión estratégica (migrar vs mitigar).

---

## ⚠️ Consideraciones Importantes

1. **SIEMPRE probar en desarrollo ANTES de producción**
2. **Hacer backup/commit antes de cada paso**
3. **bull-board puede tener breaking changes** - revisar changelog
4. **PM2 actualizado puede cambiar comportamiento de cluster** - monitorear logs
5. **xlsx requiere análisis de uso** - no hay fix automático disponible

---

## 🔗 Referencias

- [npm audit documentation](https://docs.npmjs.com/cli/v9/commands/npm-audit)
- [GitHub Advisory Database](https://github.com/advisories)
- [exceljs (alternativa a xlsx)](https://www.npmjs.com/package/exceljs)
- [bull-board changelog](https://github.com/felixmosh/bull-board/releases)

---

## ✅ Conclusión

**Estado:** ⚠️ **ACCIÓN REQUERIDA**

- **Vulnerabilidades bajas:** Fácil de resolver con `npm audit fix`
- **Vulnerabilidades altas:** Requieren actualización de bull-board y PM2 (PROBAR PRIMERO)
- **Vulnerabilidades críticas (xlsx):** Requieren decisión estratégica (migrar o mitigar)

**Recomendación:** Ejecutar PASO 1-3 de inmediato, planificar migración de xlsx para próximo sprint.
