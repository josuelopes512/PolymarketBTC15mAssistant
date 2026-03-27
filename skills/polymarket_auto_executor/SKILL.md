---
name: polymarket-auto-executor
description: Consults PolymarketBTC15mAssistant JSON output and automatically executes validated trades on Polymarket.
version: 1.0.0
metadata:
  openclaw:
    requires:
      bins:
        - node
        - bash
      env:
        - POLYMARKET_HOST
        - CHAIN_ID
        - PRIVATE_KEY
        - FUNDER
        - DRY_RUN
        - STAKE_USD
        - MAX_ENTRY_PRICE
        - MIN_LIQUIDITY
---

Run bash scripts/run-openclaw-trade.sh on Unix or powershell scripts/run-openclaw-trade.ps1 on Windows.
Never invent signals.
Never trade if action !== "ENTER".
Never trade if prices are null.
Never trade twice on the same marketId.
Always return the raw JSON result.
