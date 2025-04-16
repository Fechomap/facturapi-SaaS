#!/bin/bash

# restore_dbs.sh
# Restaurar una base de datos desde un backup existente

# Verifica que se haya proporcionado el nombre de la carpeta
if [ -z "$1" ]; then
  echo "❌ Debes indicar el nombre de la carpeta de backup (ej: 20250415_1712)"
  exit 1
fi

# Variables
BACKUP_FOLDER="backups/$1"

# Verifica que existan los archivos
if [ ! -f "$BACKUP_FOLDER/staging.dump" ] && [ ! -f "$BACKUP_FOLDER/saas.dump" ]; then
  echo "❌ No se encontraron archivos de dump en $BACKUP_FOLDER"
  exit 1
fi

echo "✅ Dump encontrado en: $BACKUP_FOLDER"
echo ""
echo "¿Qué base deseas restaurar?"
select target in "Staging" "Producción (SAAS)" "Cancelar"; do
  case $target in
    "Staging")
      DB_URL="postgres://u4ad4ejkviurjc:p631b55abb6f683d2b976021af44279f0cac59ebc398a4452bd31b40c16854446@ca932070ke6bv1.cluster-czrs8kj4isg7.us-east-1.rds.amazonaws.com:5432/dapeugj3ip9rt"
      DUMP_FILE="$BACKUP_FOLDER/staging.dump"
      break
      ;;
    "Producción (SAAS)")
      DB_URL="postgres://uevg5uanv9qbbq:pce6ccd9538c636892c1d1c4b852cc2ad40f202101176e6e798de72b2287bf42f@c3cj4hehegopde.cluster-czrs8kj4isg7.us-east-1.rds.amazonaws.com:5432/dmbe4ekvsb6ed"
      DUMP_FILE="$BACKUP_FOLDER/saas.dump"
      break
      ;;
    "Cancelar")
      echo "❌ Restauración cancelada."
      exit 0
      ;;
    *) echo "Opción inválida. Intenta de nuevo."; continue;;
  esac
done

echo ""
echo "⚠️  ATENCIÓN: estás a punto de restaurar la base de datos."
echo "📦 Dump: $DUMP_FILE"
echo "💾 Destino: $DB_URL"
read -p "¿Estás seguro? (sí/no): " confirm

if [[ "$confirm" == "sí" || "$confirm" == "s" ]]; then
  echo "🚀 Restaurando base de datos..."
  pg_restore --clean --no-owner --no-privileges --verbose -d "$DB_URL" "$DUMP_FILE"
  echo "✅ Restauración completada."
else
  echo "❌ Restauración cancelada por el usuario."
fi