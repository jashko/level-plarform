#!/bin/bash
# Загружаем ключ из .env.local если он есть
if [ -f .env.local ]; then
  export $(grep -v '^#' .env.local | xargs)
  echo "✓ Ключ загружен из .env.local"
fi
npm run bundle
echo "✓ Сборка готова"
