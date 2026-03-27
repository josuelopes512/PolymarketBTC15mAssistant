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
- O valor da ordem deve ser sempre de **1 dólar**.
- Só operar quando faltarem **40 segundos ou menos** para finalizar o mercado.
- Só operar quando o preço do lado escolhido estiver entre **0.80 e 0.85**.

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

6. Antes de operar, valide estas condições obrigatórias:
   - `timeLeftSec` deve ser **menor ou igual a 40**
   - se `side === "UP"`, então `upPrice` deve estar entre **0.80 e 0.85**
   - se `side === "DOWN"`, então `downPrice` deve estar entre **0.80 e 0.85**
   - o valor da ordem deve ser sempre **$1**

7. Se qualquer uma dessas condições não for atendida, pare imediatamente e retorne o JSON bruto sem operar.

8. Se `action === "ENTER"` e `side` for `UP` ou `DOWN`:
   - Use o browser profile `edge-user`.
   - Na Polymarket, localize o mercado usando `marketSlug`.
   - Entre na página correta do mercado.
   - Se existir o botão `Go to live market`, clique nele imediatamente antes de qualquer ação.
   - Se houver contador chegando a zero, aguarde até aparecer `Go to live market` e clique.
   - Após clicar, aguarde a navegação para o mercado ativo e confirme que a página foi atualizada.
   - Se `side === "UP"`, clique no outcome `UP` ou `Yes`.
   - Se `side === "DOWN"`, clique no outcome `DOWN` ou `No`.
   - Preencha o valor da ordem com **$1**.
   - Revise o lado, o valor e a confirmação.
   - Confirme a ordem no navegador.

Regras:
- Nunca invente sinais.
- Nunca opere se `action !== "ENTER"`.
- Nunca opere se `currentPrice` ou `priceToBeat` vierem nulos.
- Nunca opere duas vezes no mesmo `marketId`.
- Nunca opere se faltarem mais de 40 segundos para finalizar.
- Nunca opere se o preço do lado escolhido estiver fora da faixa de 0.80 a 0.85.
- Use apenas a UI da Polymarket no browser tool.
- Sempre clicar em `Go to live market` se o mercado atual tiver expirado antes de operar.
- Se a página pedir login, interrompa e peça login manual no Edge do usuário.
- Se o Edge não estiver acessível via `edge-user`, tente iniciar o Edge com remote debugging antes de falhar.
- Sempre retorne:
  1. o JSON bruto do indicador
  2. um resumo do que foi clicado
  3. o resultado observado na tela