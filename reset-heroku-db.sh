#!/bin/bash

# Script para resetear la base de datos en Heroku

# Verificar si se proporcionó el nombre de la aplicación
if [ -z "$1" ]; then
  echo "Error: Debes proporcionar el nombre de la aplicación de Heroku."
  echo "Uso: ./reset-heroku-db.sh nombre-de-tu-app"
  exit 1
fi

APP_NAME=$1

echo "Reseteando la base de datos en $APP_NAME..."

# Ejecutar el script en Heroku
heroku run --app $APP_NAME "node reset-heroku-db.js"

echo "Script ejecutado. Verifica los logs para confirmar que se completó correctamente."
