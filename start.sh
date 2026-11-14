#!/bin/bash
cd "$(dirname "$0")"
command -v node >/dev/null 2>&1 || { echo "Reel needs Node.js 20 or newer: https://nodejs.org/en/download"; exit 1; }
exec node scripts/launch.mjs
