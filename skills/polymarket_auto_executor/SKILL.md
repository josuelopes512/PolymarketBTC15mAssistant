---
name: polymarket-browser-trader
description: Uses PolymarketBTC15mAssistant as an indicator and executes trades in the Polymarket web UI on macOS using the user's Microsoft Edge session.
version: 1.1.0
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
- Só operar quando `timeLeftSec ≥ 30s`.
- Só operar quando o preço do lado escolhido estiver entre **0.80 e 0.88**.
- O script `run-openclaw-trade.sh` já deve retornar `browserTradeAllowed`, `selectedPrice`, `fixedStakeUsd` e `filterReason`.

---

## Critérios de decisão (todos devem estar alinhados para SIM)

1. **Preço Polymarket** da direção escolhida entre **0.80 e 0.88**
2. **Pelo menos 4 dos 5 sinais** apontam para a mesma direção:
   - **TA Predict:** SHORT > 55% → DOWN | LONG > 55% → UP
   - **Heiken Ashi:** red → DOWN | green → UP *(peso maior se x2 ou x3)*
   - **RSI:** ↓ abaixo de 45 → DOWN | ↑ acima de 55 → UP
   - **MACD:** bearish → DOWN | bullish → UP
   - **currentPrice vs priceToBeat:** DOWN se currentPrice < priceToBeat | UP se currentPrice > priceToBeat
3. **timeLeftSec ≥ 30s**

Caso contrário: **não operar**.

---

## Procedimento

1. Garanta que o Microsoft Edge do usuário esteja disponível para o browser tool.
   Se o profile `edge-user` ainda não responder, execute via `exec`:

   `edge-debug`

2. Use o browser tool com o profile `edge-user` para abrir:
   `https://polymarket.com`

3. Rode o indicador:
   `bash $HOME/Sources/PolymarketBTC15mAssistant/scripts/run-openclaw-trade.sh`

4. Leia o JSON retornado pelo indicador.

5. Aplique os critérios de decisão acima. Se **algum critério falhar**, pare imediatamente e retorne o JSON bruto sem operar.

6. Se todos os critérios estiverem satisfeitos e `side` for `UP` ou `DOWN`:
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

---

## Regras

- Nunca invente sinais.
- Nunca opere se `browserTradeAllowed !== true`.
- Nunca opere se `currentPrice` ou `priceToBeat` vierem nulos.
- Nunca opere duas vezes no mesmo `marketId`.
- Nunca opere se `timeLeftSec < 30`.
- Nunca opere se o preço do lado escolhido estiver fora da faixa de **0.80 a 0.88**.
- Nunca opere se menos de 4 dos 5 sinais apontarem para a mesma direção.
- Use apenas a UI da Polymarket no browser tool.
- Sempre clicar em `Go to live market` se o mercado atual tiver expirado antes de operar.
- Se a página pedir login, interrompa e peça login manual no Edge do usuário.
- Se o Edge não estiver acessível via `edge-user`, tente iniciar o Edge com remote debugging antes de falhar.
- Sempre retorne:
  1. o JSON bruto do indicador
  2. um resumo do que foi clicado
  3. o resultado observado na tela
  4. `filterReason`
  5. `selectedPrice`