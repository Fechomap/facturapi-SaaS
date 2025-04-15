#!/bin/bash
# Script para ejecutar la prueba de flujo de suscripciones

# Colores para la salida
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Iniciando prueba de flujo de suscripciones...${NC}"
echo -e "${YELLOW}=======================================${NC}"

# Verificar que Node.js esté instalado
if ! command -v node &> /dev/null; then
    echo -e "${RED}Error: Node.js no está instalado. Por favor, instala Node.js para ejecutar esta prueba.${NC}"
    exit 1
fi

# Verificar que el archivo de prueba exista
if [ ! -f "tests/test-subscription-flow.js" ]; then
    echo -e "${RED}Error: No se encontró el archivo tests/test-subscription-flow.js${NC}"
    exit 1
fi

# Ejecutar la prueba
echo -e "${YELLOW}Ejecutando prueba...${NC}"
node tests/test-subscription-flow.js

# Verificar el resultado
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ La prueba se completó exitosamente.${NC}"
    exit 0
else
    echo -e "${RED}❌ La prueba falló. Revisa los logs para más detalles.${NC}"
    exit 1
fi
