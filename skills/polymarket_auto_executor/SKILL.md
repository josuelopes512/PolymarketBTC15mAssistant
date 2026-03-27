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

Importante:
- Use sempre o browser profile `edge-user`.
- Nunca use o profile `openclaw`.
- O indicador apenas consulta o sinal; a execução da ordem deve ser feita pela UI da Polymarket no navegador.
- Se o Edge ainda não estiver acessível via `edge-user`, inicie o Edge com remote debugging usando `exec`.

Procedimento:

1. Primeiro, garanta que o Microsoft Edge do usuário esteja disponível para o browser tool.
   Se o profile `edge-user` ainda não responder, execute via `exec`:

   `edge-debug`

2. Depois use o browser tool com o profile `edge-user` para abrir:
   `https://polymarket.com`

3. Rode o indicador:
   `bash $HOME/Sources/PolymarketBTC15mAssistant/scripts/run-openclaw-trade.sh`

4. Leia o JSON retornado pelo indicador.

5. Se `action !== "ENTER"`, pare imediatamente e retorne o JSON bruto sem operar.

6. Se `action === "ENTER"` e `side` for `UP` ou `DOWN`:
   - Use o browser profile `edge-user`.
   - Na Polymarket, localize o mercado usando `marketSlug`.
   - Entre na página correta do mercado.
   - Se existir o botão `Go to live market`, clique nele imediatamente antes de qualquer ação.
   - Se houver contador chegando a zero, aguarde até aparecer `Go to live market` e clique.
   - Após clicar, aguarde a navegação para o mercado ativo e confirme que a página foi atualizada.
   - Se `side === "UP"`, clique no outcome `UP` ou `Yes`.
   - Se `side === "DOWN"`, clique no outcome `DOWN` ou `No`.
   - Preencha o valor da ordem usando `STAKE_USD`.
   - Revise o lado, o valor e a confirmação.
   - Confirme a ordem no navegador.

Regras:
- Nunca invente sinais.
- Nunca opere se `action !== "ENTER"`.
- Nunca opere se `currentPrice` ou `priceToBeat` vierem nulos.
- Nunca opere duas vezes no mesmo `marketId`.
- Use apenas a UI da Polymarket no browser tool.
- Sempre clicar em `Go to live market` se o mercado atual tiver expirado antes de operar.
- Se a página pedir login, interrompa e peça login manual no Edge do usuário.
- Se o Edge não estiver acessível via `edge-user`, tente iniciar o Edge com remote debugging antes de falhar.
- Sempre retorne:
  1. o JSON bruto do indicador
  2. um resumo do que foi clicado
  3. o resultado observado na tela