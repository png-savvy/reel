#!/bin/bash
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo
  echo "Reel needs Node.js, which is not installed yet."
  echo "A download page will open. Install the LTS version, then double-click this file again."
  open "https://nodejs.org/en/download"
  read -n 1 -s -r -p "Press any key to close."
  exit 1
fi
node scripts/launch.mjs
echo
read -n 1 -s -r -p "Reel has stopped. Press any key to close."
