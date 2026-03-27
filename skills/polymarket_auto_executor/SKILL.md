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

Use esta skill para rodar o pipeline automático de trading da Polymarket no macOS.

Procedimento:
1. Execute:
   `bash $HOME/Source/PolymarketBTC15mAssistant/scripts/run-openclaw-trade.sh`
2. Leia o JSON retornado.
3. Retorne o JSON bruto ao usuário sem reinterpretar o sinal.

Regras:
- Nunca invente sinais.
- Nunca opere se `action !== "ENTER"`.
- Nunca opere se os preços vierem nulos.
- Nunca opere duas vezes no mesmo `marketId`.
- Sempre retorne o JSON bruto do resultado.
- Se houver erro, retorne o erro bruto.