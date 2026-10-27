#!/usr/bin/env bash
# Double-click (Mac) or run ./start-mac-linux.command (Linux) to start B-E Motion.
cd "$(dirname "$0")" || exit 1
echo
echo "  B-E Motion"
echo "  =========="
echo
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is needed to run B-E Motion on this computer."
  echo "Install the LTS version from https://nodejs.org/ and run this again."
  (open https://nodejs.org/ || xdg-open https://nodejs.org/) >/dev/null 2>&1
  read -r -p "Press Enter to close..."
  exit 1
fi
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
if [ ! -d node_modules ]; then
  echo "First start: installing, this takes a minute..."
  npm ci || { echo "Install failed. Check your internet connection and try again."; read -r -p "Press Enter to close..."; exit 1; }
fi
echo "Starting... your browser will open B-E Motion. Keep this window open while you use it."
npm run dev -- --open
