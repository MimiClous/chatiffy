#!/bin/sh
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo 'Установите Node.js 20+ и pnpm, затем откройте меню снова.'
  read -r answer
  exit 1
fi
node scripts/dev-menu.mjs
