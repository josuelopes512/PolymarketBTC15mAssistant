#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$HOME/Sources/PolymarketBTC15mAssistant"

export DRY_RUN="${DRY_RUN:-true}"
export STAKE_USD="${STAKE_USD:-1}"
export MAX_ENTRY_PRICE="${MAX_ENTRY_PRICE:-0.85}"
export MIN_LIQUIDITY="${MIN_LIQUIDITY:-1000}"
export EXECUTION_MODE="${EXECUTION_MODE:-openclaw}"

# Se usa nvm:
export NVM_DIR="$HOME/.nvm"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  . "$NVM_DIR/nvm.sh"
fi

cd "$PROJECT_DIR"

RAW_JSON="$(node src/autoTrade.js --mode openclaw)"

FILTERED_JSON="$(
  echo "$RAW_JSON" | node -e '
let input = "";
process.stdin.on("data", c => input += c);
process.stdin.on("end", () => {
  try {
    const data = JSON.parse(input);

    const side = data.side ?? data.signal?.side ?? null;
    const timeLeftSec = data.timeLeftSec ?? data.signal?.timeLeftSec ?? null;
    const currentPrice = data.currentPrice ?? data.signal?.currentPrice ?? null;
    const priceToBeat = data.priceToBeat ?? data.signal?.priceToBeat ?? null;
    const marketId = data.marketId ?? data.signal?.marketId ?? null;
    const marketSlug = data.marketSlug ?? data.signal?.marketSlug ?? null;

    const upPrice = data.upPrice ?? data.signal?.upPrice ?? null;
    const downPrice = data.downPrice ?? data.signal?.downPrice ?? null;

    const selectedPrice =
      side === "UP" ? upPrice :
      side === "DOWN" ? downPrice :
      null;

    const action = data.action ?? data.signal?.action ?? null;

    const browserTradeAllowed =
      action === "ENTER" &&
      currentPrice !== null &&
      priceToBeat !== null &&
      typeof timeLeftSec === "number" &&
      timeLeftSec <= 40 &&
      typeof selectedPrice === "number" &&
      selectedPrice >= 0.80 &&
      selectedPrice <= 0.85;

    let filterReason = "OK";
    if (action !== "ENTER") filterReason = "action_not_enter";
    else if (currentPrice === null || priceToBeat === null) filterReason = "missing_price_fields";
    else if (typeof timeLeftSec !== "number") filterReason = "missing_time_left";
    else if (timeLeftSec > 40) filterReason = "time_left_above_40";
    else if (selectedPrice === null) filterReason = "missing_side_or_selected_price";
    else if (selectedPrice < 0.80 || selectedPrice > 0.85) filterReason = "price_outside_range_0.80_0.85";

    const result = {
      ...data,
      marketId,
      marketSlug,
      side,
      action,
      timeLeftSec,
      currentPrice,
      priceToBeat,
      upPrice,
      downPrice,
      selectedPrice,
      fixedStakeUsd: 1,
      browserTradeAllowed,
      filterReason
    };

    process.stdout.write(JSON.stringify(result));
  } catch (err) {
    process.stdout.write(JSON.stringify({
      ok: false,
      browserTradeAllowed: false,
      error: err.message
    }));
    process.exit(1);
  }
});
'
)"

echo "$FILTERED_JSON"
