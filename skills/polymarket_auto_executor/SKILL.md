---
name: polymarket-browser-trader
description: Uses PolymarketBTC15mAssistant as an indicator and executes trades in the Polymarket web UI on macOS via OpenClaw browser automation.
version: 1.0.0
metadata:
  openclaw:
    requires:
      bins:
        - node
        - bash
      env:
        - STAKE_USD
        - MAX_ENTRY_PRICE
        - MIN_LIQUIDITY
---

Use esta skill para fazer trading na Polymarket via navegador no macOS.

Fluxo:
1. Execute:
   `bash $HOME/Sources/PolymarketBTC15mAssistant/scripts/run-openclaw-trade.sh`
   ou rode diretamente:
   `node $HOME/Sources/PolymarketBTC15mAssistant/src/index.js`

2. Leia o JSON retornado.

3. Se `action !== "ENTER"`, pare e retorne o JSON bruto.

4. Se `side === "UP"` ou `side === "DOWN"`:
   - Abra o browser profile `openclaw` ou o profile configurado para sessão logada.
   - Navegue até `https://polymarket.com`.
   - Procure o mercado correspondente a `marketSlug`.
   - Entre na página do mercado.
   - Clique no outcome correto:
     - `UP` => botão de compra do lado UP/Yes
     - `DOWN` => botão de compra do lado DOWN/No
   - Preencha o valor de stake usando `STAKE_USD`.
   - Revise preço e quantidade.
   - Confirme a ordem no navegador.

Regras:
- Nunca invente sinais.
- Nunca opere se `action !== "ENTER"`.
- Nunca opere se `currentPrice` ou `priceToBeat` vierem nulos.
- Nunca opere duas vezes no mesmo `marketId`.
- Use apenas a UI da Polymarket no browser tool.
- Sempre retorne um resumo bruto do que foi clicado e do resultado observado na tela.
- Se a página pedir login, interrompa e peça login manual no browser controlado pelo OpenClaw.