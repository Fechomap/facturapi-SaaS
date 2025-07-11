#!/bin/bash

# Script mejorado: genera backups en una subcarpeta por fecha/hora

# Timestamp actual
TIMESTAMP=$(date +%Y%m%d_%H%M)

# Ruta base
BACKUP_DIR="backups/${TIMESTAMP}"

# URLs de conexión a bases
STAGING_URL="postgres://u4ad4ejkviurjc:p631b55abb6f683d2b976021af44279f0cac59ebc398a4452bd31b40c16854446@ca932070ke6bv1.cluster-czrs8kj4isg7.us-east-1.rds.amazonaws.com:5432/dapeugj3ip9rt"
PROD_URL="postgres://uevg5uanv9qbbq:pce6ccd9538c636892c1d1c4b852cc2ad40f202101176e6e798de72b2287bf42f@c3cj4hehegopde.cluster-czrs8kj4isg7.us-east-1.rds.amazonaws.com:5432/dmbe4ekvsb6ed"
RAILWAY_URL="postgresql://postgres:eLQHlZEgKsaLftJFoUXcxipIdoyKhvJy@hopper.proxy.rlwy.net:17544/railway"

# Crear carpeta nueva para este backup
mkdir -p "$BACKUP_DIR"

echo "🔁 Iniciando respaldo en: $BACKUP_DIR"

# Backup STAGING
echo "📦 Respaldando STAGING..."
pg_dump "$STAGING_URL" -Fc -f "$BACKUP_DIR/staging.dump"
echo "✅ Backup de STAGING listo en: $BACKUP_DIR/staging.dump"

# Backup SAAS
echo "📦 Respaldando SAAS (producción)..."
pg_dump "$PROD_URL" -Fc -f "$BACKUP_DIR/saas.dump"
echo "✅ Backup de SAAS listo en: $BACKUP_DIR/saas.dump"

# Backup RAILWAY
echo "📦 Respaldando RAILWAY (actual)..."
pg_dump "$RAILWAY_URL" -Fc -f "$BACKUP_DIR/railway.dump"
echo "✅ Backup de RAILWAY listo en: $BACKUP_DIR/railway.dump"

echo "🎉 Todos los backups guardados en: $BACKUP_DIR"