# 🚀 FASE 0: PREPARACIÓN CON RAILWAY

## 1️⃣ Login a Railway

```bash
railway login
```

## 2️⃣ Verificar proyectos

```bash
railway status
railway list
```

## 3️⃣ Conectar a PostgreSQL

```bash
# Opción 1: Usar Railway CLI
railway connect

# Opción 2: Usar URL directa de PostgreSQL
# (la tienes en tu .env como DATABASE_URL)
```

## 4️⃣ Crear backup

```bash
# Usando Railway
railway db dump > backup-$(date +%Y%m%d-%H%M%S).sql

# O usando pg_dump con URL
pg_dump $DATABASE_URL > backup-$(date +%Y%m%d-%H%M%S).sql
```

---

## 🔍 COMANDOS RAILWAY ÚTILES

- `railway logs` - Ver logs en tiempo real
- `railway deploy` - Hacer deploy
- `railway db connect` - Conectar a PostgreSQL
- `railway variables` - Ver variables de entorno

---

**SIGUIENTE PASO**: Ejecuta `railway login` y luego continúa
