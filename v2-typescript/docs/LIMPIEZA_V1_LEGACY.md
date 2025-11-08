# 🧹 LIMPIEZA DE CÓDIGO LEGACY V1

**⚠️ EJECUTAR SOLO DESPUÉS DE 1 SEMANA DE V2 EN PRODUCCIÓN SIN INCIDENTES**

Este documento describe cómo eliminar permanentemente el código JavaScript V1 del repositorio una vez que V2 esté estable en producción.

---

## ⏰ ¿CUÁNDO EJECUTAR ESTA LIMPIEZA?

Ejecutar SOLO si se cumplen **TODAS** estas condiciones:

- ✅ V2 ha estado corriendo en producción durante **mínimo 7 días**
- ✅ **Cero incidentes críticos** reportados
- ✅ Todas las funcionalidades funcionan correctamente:
  - Facturación CHUBB (3 facturas)
  - Facturación Club de Asistencia
  - Facturación Qualitas (5 servicios)
  - Facturación AXA
  - Facturación ESCOTEL
  - Facturación normal (clientes custom)
  - Complemento de pago
  - Reportes Excel
  - Descarga PDF/XML
- ✅ Los logs no muestran errores recurrentes
- ✅ El equipo está de acuerdo en eliminar V1

**Si alguna condición NO se cumple → NO ejecutar esta limpieza y seguir monitoreando.**

---

## 📁 ARCHIVOS Y CARPETAS A ELIMINAR

### Código JavaScript V1

```bash
# Archivos principales
server.js
cluster.js
bot.js

# Carpetas completas
bot/              # Handlers, commands, views de V1
routes/           # Rutas Express de V1
services/         # Services de V1 (si existen en raíz)
middleware/       # Middleware de V1 (si existe en raíz)
config/           # Config de V1 (si existe en raíz)
lib/              # Libs de V1 (si existe en raíz)
core/             # Core de V1 (si existe en raíz)
tests/            # Tests V1

# Scripts deprecated
scripts/admin/
scripts/database/ (algunos)
scripts/monitoring/ (algunos)
scripts/testing/

# Documentación legacy
docs/legacy/ (si existe)
```

### Archivos a CONSERVAR

```bash
# Mantener
v2-typescript/     # TODO el código V2
prisma/            # Schema y migraciones
frontend/          # Frontend React
.env.example
.gitignore
railway.json       # Ya actualizado para V2
package.json       # Actualizar (ver abajo)
README.md          # Actualizar para V2
```

---

## 🔧 PROCEDIMIENTO DE LIMPIEZA

### PASO 1: Crear rama de limpieza

```bash
cd /Users/jhonvc/NODE\ HEROKU/facturapi-SaaS

# Asegurarse de estar en main actualizado
git checkout main
git pull origin main

# Crear rama de limpieza
git checkout -b cleanup/remove-v1-legacy
```

### PASO 2: Eliminar archivos V1

```bash
# Archivos principales
rm server.js
rm cluster.js
rm bot.js

# Carpetas legacy
rm -rf bot/
rm -rf routes/
rm -rf tests/

# Scripts legacy (revisar manualmente cuáles conservar)
# Algunos scripts en /scripts pueden ser útiles
```

### PASO 3: Actualizar `package.json` raíz

El `package.json` raíz debería apuntar a V2. Crear nuevo contenido:

```json
{
  "name": "facturapi-saas",
  "version": "2.0.0",
  "description": "Sistema de facturación SaaS basado en FacturAPI con soporte multi-tenant - TypeScript Edition",
  "type": "module",
  "private": true,
  "workspaces": [
    "v2-typescript",
    "frontend"
  ],
  "scripts": {
    "dev": "cd v2-typescript && npm run dev:all",
    "build": "cd v2-typescript && npm run build",
    "start": "cd v2-typescript && npm run start:all",
    "start:cluster": "cd v2-typescript && npm run start:cluster",
    "start:bot": "cd v2-typescript && npm run start:bot",
    "prisma:studio": "cd v2-typescript && npm run prisma:studio",
    "migrate": "cd v2-typescript && npm run prisma:migrate",
    "postinstall": "cd v2-typescript && npm install && cd ../frontend && npm install"
  },
  "engines": {
    "node": ">=18.x"
  }
}
```

**O simplemente:**

Mover todo el contenido de `v2-typescript/package.json` al raíz y eliminar la carpeta wrapper.

### PASO 4: Actualizar README.md

Actualizar referencias:
- Cambiar instrucciones de instalación a V2
- Actualizar estructura del proyecto
- Eliminar referencias a JavaScript
- Agregar nota de migración completada

### PASO 5: Revisar y Commit

```bash
# Ver qué se va a eliminar
git status

# Asegurarse que NO estamos eliminando nada importante
git diff

# Agregar cambios
git add .

# Commit
git commit -m "chore: eliminar código legacy V1 JavaScript

V2 TypeScript completó 1 semana en producción sin incidentes.
Eliminando código JavaScript legacy innecesario.

Archivos eliminados:
- server.js, cluster.js, bot.js
- /bot (handlers V1)
- /routes (Express V1)
- /tests (tests V1)

V2 TypeScript es ahora la única versión activa.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

### PASO 6: Push y crear Pull Request

```bash
# Push de la rama
git push origin cleanup/remove-v1-legacy

# Crear PR desde GitHub
# Título: "chore: Eliminar código legacy V1 JavaScript"
# Descripción: Enlazar a este documento
```

### PASO 7: Revisión y Merge

1. **Revisar PR cuidadosamente**
2. **Verificar que V2 sigue funcionando** en producción
3. **Merge a main**
4. **Monitorear** que Railway no se rompa con los cambios

---

## 🚨 SI ALGO SALE MAL DURANTE LA LIMPIEZA

### Problema: Railway falla después del merge

**Solución:**

```bash
# Revertir el merge
git revert HEAD
git push origin main

# Railway volverá al estado anterior
```

### Problema: Se eliminó algo importante por error

**Solución:**

```bash
# Recuperar archivos de commits anteriores
git checkout <commit-hash-antes-limpieza> -- archivo_importante.js

# Commit y push
git add archivo_importante.js
git commit -m "fix: recuperar archivo importante eliminado por error"
git push origin main
```

---

## 📝 CHECKLIST PRE-LIMPIEZA

**VERIFICAR ANTES DE EJECUTAR:**

- [ ] V2 lleva **7+ días** corriendo en producción
- [ ] **Cero incidentes críticos** en la última semana
- [ ] Logs muestran operación normal
- [ ] Todas las funcionalidades probadas y funcionando
- [ ] Equipo de acuerdo en eliminar V1
- [ ] Backup reciente de BD disponible en Railway
- [ ] Has revisado los archivos a eliminar (no hay nada crítico)

**SI TODAS LAS CASILLAS ESTÁN MARCADAS → Proceder con limpieza**

---

## 📊 DESPUÉS DE LA LIMPIEZA

### Reorganización del Proyecto (Opcional)

Si quieres mover V2 al raíz (eliminar carpeta `v2-typescript`):

```bash
# Crear nueva rama
git checkout -b refactor/move-v2-to-root

# Mover contenido de v2-typescript/ al raíz
mv v2-typescript/src ./
mv v2-typescript/prisma ./
mv v2-typescript/tsconfig.json ./
# etc...

# Eliminar carpeta v2-typescript
rm -rf v2-typescript/

# Actualizar imports (buscar @/ y ajustar paths)
# Actualizar railway.json (quitar cd v2-typescript)

# Commit y PR
git add .
git commit -m "refactor: mover V2 TypeScript al directorio raíz"
git push origin refactor/move-v2-to-root
```

**⚠️ NOTA:** Esta reorganización es opcional y requiere pruebas adicionales.

---

## ✅ RESULTADO FINAL

Después de la limpieza, el repositorio contendrá:

```
facturapi-SaaS/
├── src/                 # Código TypeScript (antes v2-typescript/src)
├── prisma/              # Schema y migraciones
├── frontend/            # Frontend React
├── scripts/             # Scripts útiles
├── dist/                # Build output (gitignored)
├── docs/                # Documentación
├── railway.json         # Config Railway → V2
├── package.json         # Config npm → V2
├── tsconfig.json        # TypeScript config
└── README.md            # Docs actualizadas
```

**Sin rastro de código JavaScript V1 ✨**

---

**Creado:** 2025-11-08
**Versión:** 1.0
