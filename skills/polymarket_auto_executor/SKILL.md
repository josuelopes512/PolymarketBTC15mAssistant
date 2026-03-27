---
name: polymarket-browser-trader
description: Uses PolymarketBTC15mAssistant as an indicator and executes trades in the Polymarket web UI on macOS using the user's Microsoft Edge session.
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

Use esta skill para fazer trading na Polymarket via navegador no macOS usando a sessão existente do Microsoft Edge do usuário.

Pré-condições:
- O Microsoft Edge deve estar aberto com remote debugging habilitado.
- O OpenClaw deve usar o browser profile `edge-user`.
- O usuário já deve estar logado na Polymarket no Edge.
- O projeto deve estar em `$HOME/Sources/PolymarketBTC15mAssistant`.

Fluxo:
1. Execute:
   `bash $HOME/Sources/PolymarketBTC15mAssistant/scripts/run-openclaw-trade.sh`

2. Leia o JSON retornado.

3. Se `action !== "ENTER"`, pare e retorne o JSON bruto sem operar.

4. Se `action === "ENTER"` e `side` for `UP` ou `DOWN`:
   - Use sempre o browser profile `edge-user`.
   - Abra `https://polymarket.com`.
   - Localize o mercado usando `marketSlug`.
   - Entre na página correta do mercado.
   - Se `side === "UP"`, clique no outcome `UP` ou `Yes`.
   - Se `side === "DOWN"`, clique no outcome `DOWN` ou `No`.
   - Preencha o valor usando `STAKE_USD`.
   - Revise o lado, o valor e a tela de confirmação.
   - Confirme a ordem no navegador.

Regras:
- Nunca invente sinais.
- Nunca opere se `action !== "ENTER"`.
- Nunca opere se `currentPrice` ou `priceToBeat` vierem nulos.
- Nunca opere duas vezes no mesmo `marketId`.
- Nunca use o profile `openclaw`; use sempre `edge-user`.
- Use apenas a UI da Polymarket no browser tool.
- Sempre retorne um resumo bruto do que foi clicado e do resultado observado na tela.
- Se a página pedir login, interrompa e peça login manual no Edge do usuário.
- Se o Edge não estiver acessível via `edge-user`, interrompa com erro em vez de abrir um novo navegador.