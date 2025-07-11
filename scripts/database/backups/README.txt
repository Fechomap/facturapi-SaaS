# 👉 Ejecutar backup (genera carpeta con timestamp)
bash scripts/database/backups/backup_dbs.sh

# 👉 Ejecutar restore (te pedirá el nombre de la carpeta y qué base deseas restaurar)
bash scripts/database/backups/restore_dbs.sh 20250415_1712

# 👉 O desde package.json
npm run backup:create
npm run backup:restore