# ARCHIVOS Y CARPETAS V1 LEGACY A ELIMINAR

**IMPORTANTE:** Solo ejecutar después de 7+ días sin incidentes en V2.

---

## ARCHIVOS JAVASCRIPT V1 (Raíz)

Eliminar estos archivos:

```bash
rm /Users/jhonvc/NODE\ HEROKU/facturapi-SaaS/bot.js
rm /Users/jhonvc/NODE\ HEROKU/facturapi-SaaS/cluster.js
rm /Users/jhonvc/NODE\ HEROKU/facturapi-SaaS/server.js
rm /Users/jhonvc/NODE\ HEROKU/facturapi-SaaS/delete-tenant-simple.js
```

**Razón:** Reemplazados por:
- `bot.js` → `v2-typescript/src/bot.ts`
- `server.js` → `v2-typescript/src/server.ts`
- `cluster.js` → `v2-typescript/src/cluster.ts`

---

## ARCHIVOS DE CONFIGURACIÓN V1

Eliminar estos archivos:

```bash
rm /Users/jhonvc/NODE\ HEROKU/facturapi-SaaS/package.json
rm /Users/jhonvc/NODE\ HEROKU/facturapi-SaaS/package-lock.json
rm /Users/jhonvc/NODE\ HEROKU/facturapi-SaaS/jest.config.js
rm /Users/jhonvc/NODE\ HEROKU/facturapi-SaaS/ecosystem.config.js
rm /Users/jhonvc/NODE\ HEROKU/facturapi-SaaS/.eslintrc.json
rm /Users/jhonvc/NODE\ HEROKU/facturapi-SaaS/.eslintignore
rm /Users/jhonvc/NODE\ HEROKU/facturapi-SaaS/.prettierrc
```

**Razón:**
- `package.json` V1 apunta a `server.js` (obsoleto)
- `jest.config.js` V1 busca en `/api`, `/services` (carpetas V1)
- V2 tiene sus propias configs en `v2-typescript/`

**NOTA:** V2 tiene:
- `v2-typescript/package.json` (V2)
- `v2-typescript/jest.config.js` (V2)
- `v2-typescript/.eslintrc.json` (V2)

---

## CARPETAS V1 LEGACY

Eliminar estas carpetas:

```bash
rm -rf /Users/jhonvc/NODE\ HEROKU/facturapi-SaaS/api
rm -rf /Users/jhonvc/NODE\ HEROKU/facturapi-SaaS/bot
rm -rf /Users/jhonvc/NODE\ HEROKU/facturapi-SaaS/config
rm -rf /Users/jhonvc/NODE\ HEROKU/facturapi-SaaS/core
rm -rf /Users/jhonvc/NODE\ HEROKU/facturapi-SaaS/jobs
rm -rf /Users/jhonvc/NODE\ HEROKU/facturapi-SaaS/lib
rm -rf /Users/jhonvc/NODE\ HEROKU/facturapi-SaaS/services
rm -rf /Users/jhonvc/NODE\ HEROKU/facturapi-SaaS/tests
rm -rf /Users/jhonvc/NODE\ HEROKU/facturapi-SaaS/test
rm -rf /Users/jhonvc/NODE\ HEROKU/facturapi-SaaS/utils
rm -rf /Users/jhonvc/NODE\ HEROKU/facturapi-SaaS/feature-multiuser
```

**Razón:** Reemplazadas por equivalentes en `v2-typescript/src/`:
- `/api` → `v2-typescript/src/api`
- `/bot` → `v2-typescript/src/bot`
- `/config` → `v2-typescript/src/config`
- `/core` → `v2-typescript/src/core`
- `/jobs` → `v2-typescript/src/jobs`
- `/services` → `v2-typescript/src/services`

---

## ARCHIVOS A CONSERVAR

**NO eliminar estos archivos:**

```bash
✅ railway.json              # Config Railway (CRÍTICO)
✅ .env                      # Variables producción (CRÍTICO)
✅ .gitignore                # Git config
✅ README.md                 # Documentación (actualizar con V2)
✅ .env.example              # Template variables
✅ ROADMAP_MIGRACION_TYPESCRIPT.md  # Historial
✅ ROLLBACK_V1.md            # Plan rollback (temporal)
```

**NO eliminar estas carpetas:**

```bash
✅ /v2-typescript/           # TODO el código V2 (CRÍTICO)
✅ /prisma/                  # Database schema (CRÍTICO)
✅ /docs/                    # Documentación general
✅ /backups/                 # Backups importantes
✅ /logs/                    # Logs históricos
✅ /temp/                    # Temporales
✅ /frontend/                # React frontend (si existe)
✅ /.claude/                 # Claude Code config
✅ /.git/                    # Git repo
```

---

## ESTRUCTURA FINAL DESPUÉS DE LIMPIEZA

```
facturapi-SaaS/
├── .env                    ← Variables producción
├── .env.example            ← Template
├── .gitignore              ← Git config
├── railway.json            ← Config Railway
├── README.md               ← Documentación actualizada
│
├── v2-typescript/          ← TODO el código TypeScript
│   ├── src/
│   ├── dist/
│   ├── package.json
│   ├── tsconfig.json
│   └── ...
│
├── prisma/                 ← Database
│   ├── schema.prisma
│   └── migrations/
│
├── docs/                   ← Documentación
├── backups/                ← Backups
├── logs/                   ← Logs
└── frontend/               ← Frontend (si existe)
```

---

## COMANDO COMPLETO DE LIMPIEZA

**SOLO ejecutar después de 7+ días sin incidentes:**

```bash
cd /Users/jhonvc/NODE\ HEROKU/facturapi-SaaS

# Crear rama de limpieza
git checkout -b cleanup/remove-v1-legacy

# Eliminar archivos V1
rm bot.js cluster.js server.js delete-tenant-simple.js
rm package.json package-lock.json jest.config.js ecosystem.config.js
rm .eslintrc.json .eslintignore .prettierrc

# Eliminar carpetas V1
rm -rf api/ bot/ config/ core/ jobs/ lib/ services/ tests/ test/ utils/ feature-multiuser/

# Verificar que v2-typescript/ y prisma/ están intactos
ls -la v2-typescript/
ls -la prisma/

# Verificar que railway.json existe
cat railway.json

# Commit
git add .
git status  # Revisar que NO se eliminó nada crítico

git commit -m "chore: eliminar código V1 JavaScript legacy

V2 TypeScript ha estado en producción 7+ días sin incidentes.
Eliminando código JavaScript V1 obsoleto.

Conservado:
- v2-typescript/ (código V2)
- prisma/ (database)
- railway.json (config)
- .env (producción)

Eliminado:
- Archivos JS V1: bot.js, server.js, cluster.js
- Carpetas V1: /api, /bot, /config, /core, /services, etc.
- Configs V1: package.json, jest.config.js, etc.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"

# Push y crear PR
git push origin cleanup/remove-v1-legacy
gh pr create --title "chore: Eliminar código V1 JavaScript legacy" --body "V2 TypeScript funcionando 7+ días sin incidentes. Ver ARCHIVOS_A_ELIMINAR_V1.md"
```

---

## VERIFICACIÓN POST-LIMPIEZA

Después de merge a main, verificar que Railway funciona:

```bash
# Ver logs de Railway
railway logs --tail 100

# Verificar que el bot inicia correctamente
railway logs | grep "Bot iniciado en modo polling"

# Probar bot en Telegram
# Enviar: /start, /menu
```

Si Railway falla, revertir inmediatamente:

```bash
git revert HEAD
git push origin main
```

---

## CHECKLIST PRE-LIMPIEZA

**TODOS deben estar ✅ antes de ejecutar limpieza:**

- [ ] V2 funcionando en Railway 7+ días consecutivos
- [ ] 0 incidentes críticos en última semana
- [ ] Todas las funcionalidades probadas (Chubb, Qualitas, AXA, Club)
- [ ] Logs NO muestran errores recurrentes
- [ ] Backup reciente de BD disponible
- [ ] Equipo de acuerdo en eliminar V1
- [ ] Este documento revisado y entendido

---

**Fecha creación:** 2025-11-08
**Versión:** 1.0
**Ejecutar después de:** 2025-11-15 (7+ días post-migración)
