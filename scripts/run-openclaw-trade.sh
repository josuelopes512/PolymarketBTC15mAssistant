#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$HOME/source/repos/PolymarketBTC15mAssistant"

export DRY_RUN="${DRY_RUN:-true}"
export STAKE_USD="${STAKE_USD:-5}"
export MAX_ENTRY_PRICE="${MAX_ENTRY_PRICE:-0.97}"
export MIN_LIQUIDITY="${MIN_LIQUIDITY:-1000}"

# Se usa nvm:
export NVM_DIR="$HOME/.nvm"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  . "$NVM_DIR/nvm.sh"
fi

cd "$PROJECT_DIR"
node src/autoTrade.js