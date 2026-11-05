#!/bin/bash
# Double-click on macOS to start LocalPMS
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then echo "Node.js is not installed. Download the LTS version from https://nodejs.org"; read -r -p "Press Enter to close"; exit 1; fi
[ -d node_modules ] || npm install || { read -r -p "Install failed. Press Enter to close"; exit 1; }
OPEN_BROWSER=1 npm start
