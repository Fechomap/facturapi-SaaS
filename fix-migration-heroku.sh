#!/bin/bash

# Script para ejecutar fix-migration.js en Heroku

# Verificar si se proporcionó el nombre de la aplicación
if [ -z "$1" ]; then
  echo "Error: Debes proporcionar el nombre de la aplicación de Heroku."
  echo "Uso: ./fix-migration-heroku.sh nombre-de-tu-app"
  exit 1
fi

APP_NAME=$1

echo "Ejecutando script de corrección de migración en $APP_NAME..."

# Ejecutar el script en Heroku
heroku run --app $APP_NAME "node fix-migration.js"

echo "Script ejecutado. Verifica los logs para confirmar que se completó correctamente."
