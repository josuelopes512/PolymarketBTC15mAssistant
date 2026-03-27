---
name: polymarket-browser-trader
description: Monitora continuamente mercados Polymarket BTC Up/Down 5m, calcula o tempo restante e executa o trade automaticamente quando a janela de entrada for atingida, usando a sessão existente do Microsoft Edge do usuário.
version: 1.2.0
metadata:
  openclaw:
    requires:
      bins:
        - node
        - bash
        - bc
      env:
        - STAKE_USD
        - MAX_ENTRY_PRICE
        - MIN_LIQUIDITY
---

Use esta skill para monitorar, aguardar e executar trades na Polymarket via navegador no macOS, usando a sessão existente do Microsoft Edge do usuário.

Importante:
- Use sempre o browser profile `edge-user`.
- Nunca use o profile `openclaw`.
- O indicador apenas consulta o sinal; a execução da ordem deve ser feita pela UI da Polymarket no navegador.
- O valor da ordem deve ser sempre de **$1**.
- A skill deve **ficar em loop de espera ativa** consultando o indicador a cada 3 segundos até que a janela de entrada seja atingida.
- Só operar quando `timeLeftSec` estiver entre **30s e 55s** (janela de entrada).
- Só operar quando o preço do lado escolhido estiver entre **0.80 e 0.88**.
- Nunca operar duas vezes no mesmo `marketId`.

---

## Critérios de decisão (todos devem estar alinhados para SIM)

1. **Preço Polymarket** da direção escolhida entre **0.80 e 0.88**
2. **Pelo menos 4 dos 5 sinais** apontam para a mesma direção:
   - **TA Predict:** SHORT > 55% → DOWN | LONG > 55% → UP
   - **Heiken Ashi:** red → DOWN | green → UP *(peso maior se x2 ou x3)*
   - **RSI:** ↓ abaixo de 45 → DOWN | ↑ acima de 55 → UP
   - **MACD:** bearish → DOWN | bullish → UP
   - **currentPrice vs priceToBeat:** DOWN se `currentPrice < priceToBeat` | UP se `currentPrice > priceToBeat`
3. **timeLeftSec entre 30s e 55s** (janela de entrada)

Caso algum critério falhe → **não operar**.

---

## Procedimento completo

### Fase 1 — Inicialização

1. Garanta que o Microsoft Edge esteja acessível via profile `edge-user`.
   Se não responder, execute: `edge-debug`

2. Abra `https://polymarket.com` via browser tool com profile `edge-user`.

3. Inicialize o arquivo de mercados já operados (para evitar duplicatas):
   ```bash
   touch "$HOME/.polymarket-traded-markets"
   ```

---

### Fase 2 — Loop de monitoramento (espera ativa)

Execute o loop abaixo **continuamente**, com intervalo de **3 segundos** entre cada iteração:

```bash
POLL_INTERVAL=3
ENTRY_MIN=30
ENTRY_MAX=55
PRICE_MIN=0.80
PRICE_MAX=0.88
TRADED_FILE="$HOME/.polymarket-traded-markets"

while true; do
  # 1. Consultar o indicador
  JSON=$(bash "$HOME/Sources/PolymarketBTC15mAssistant/scripts/run-openclaw-trade.sh")

  # 2. Extrair campos
  TIME_LEFT=$(echo "$JSON" | jq '.timeLeftSec')
  MARKET_ID=$(echo "$JSON" | jq -r '.marketId')
  UP_PRICE=$(echo "$JSON"  | jq '.upPrice')
  DOWN_PRICE=$(echo "$JSON" | jq '.downPrice')
  TA_LONG=$(echo "$JSON"   | jq '.taLongPct')
  TA_SHORT=$(echo "$JSON"  | jq '.taShortPct')
  HEIKEN=$(echo "$JSON"    | jq -r '.heiken')
  RSI=$(echo "$JSON"       | jq '.rsi')
  MACD=$(echo "$JSON"      | jq -r '.macd')
  CURRENT=$(echo "$JSON"   | jq '.currentPrice')
  TO_BEAT=$(echo "$JSON"   | jq '.priceToBeat')

  echo "[$(date '+%H:%M:%S')] timeLeft=${TIME_LEFT}s | market=${MARKET_ID}"

  # 3. Verificar se já foi operado
  if grep -qx "$MARKET_ID" "$TRADED_FILE" 2>/dev/null; then
    echo "  → mercado já operado, aguardando próximo..."
    sleep $POLL_INTERVAL
    continue
  fi

  # 4. Verificar se ainda não chegou na janela de entrada
  if [ "$TIME_LEFT" -gt "$ENTRY_MAX" ]; then
    WAIT=$(( TIME_LEFT - ENTRY_MAX ))
    echo "  → aguardando ${WAIT}s para janela de entrada..."
    sleep $POLL_INTERVAL
    continue
  fi

  # 5. Verificar se já passou da janela de entrada
  if [ "$TIME_LEFT" -lt "$ENTRY_MIN" ]; then
    echo "  → janela expirada (${TIME_LEFT}s < ${ENTRY_MIN}s), não operar."
    sleep $POLL_INTERVAL
    continue
  fi

  # 6. JANELA DE ENTRADA ATINGIDA — avaliar sinais
  echo "  → janela atingida! Avaliando sinais..."

  UP_SIGNALS=0
  DOWN_SIGNALS=0

  # TA Predict
  [ "$(echo "$TA_SHORT > 55" | bc -l)" = "1" ] && ((DOWN_SIGNALS++)) || true
  [ "$(echo "$TA_LONG  > 55" | bc -l)" = "1" ] && ((UP_SIGNALS++))   || true

  # Heiken Ashi
  [[ "$HEIKEN" == red*   ]] && ((DOWN_SIGNALS++)) || true
  [[ "$HEIKEN" == green* ]] && ((UP_SIGNALS++))   || true

  # RSI
  [ "$(echo "$RSI < 45" | bc -l)" = "1" ] && ((DOWN_SIGNALS++)) || true
  [ "$(echo "$RSI > 55" | bc -l)" = "1" ] && ((UP_SIGNALS++))   || true

  # MACD
  [[ "$MACD" == bearish* ]] && ((DOWN_SIGNALS++)) || true
  [[ "$MACD" == bullish* ]] && ((UP_SIGNALS++))   || true

  # currentPrice vs priceToBeat
  if [ "$CURRENT" != "null" ] && [ "$TO_BEAT" != "null" ]; then
    [ "$(echo "$CURRENT < $TO_BEAT" | bc -l)" = "1" ] && ((DOWN_SIGNALS++)) || true
    [ "$(echo "$CURRENT > $TO_BEAT" | bc -l)" = "1" ] && ((UP_SIGNALS++))   || true
  fi

  echo "  → sinais: UP=${UP_SIGNALS} DOWN=${DOWN_SIGNALS}"

  # 7. Decidir lado
  SIDE=""
  SIDE_PRICE=""

  if [ "$DOWN_SIGNALS" -ge 4 ]; then
    SIDE="DOWN"
    SIDE_PRICE="$DOWN_PRICE"
  elif [ "$UP_SIGNALS" -ge 4 ]; then
    SIDE="UP"
    SIDE_PRICE="$UP_PRICE"
  fi

  if [ -z "$SIDE" ]; then
    echo "  → sinais insuficientes. Não operar."
    sleep $POLL_INTERVAL
    continue
  fi

  # 8. Verificar faixa de preço
  IN_RANGE=$(echo "$SIDE_PRICE >= $PRICE_MIN && $SIDE_PRICE <= $PRICE_MAX" | bc -l)
  if [ "$IN_RANGE" != "1" ]; then
    echo "  → preço ${SIDE_PRICE} fora da faixa [${PRICE_MIN}–${PRICE_MAX}]. Não operar."
    sleep $POLL_INTERVAL
    continue
  fi

  # 9. EXECUTAR TRADE
  echo "  ✅ TRADE: ${SIDE} @ ${SIDE_PRICE} | mercado ${MARKET_ID}"
  echo "$MARKET_ID" >> "$TRADED_FILE"

  # → Acionar execução no browser (ver Fase 3)
  EXECUTE_TRADE=true
  break
done
```

---

### Fase 3 — Execução no browser (após EXECUTE_TRADE=true)

1. Na Polymarket, localize o mercado usando `marketSlug`.
2. Entre na página correta do mercado.
3. Se existir o botão `Go to live market`, clique nele imediatamente.
4. Se houver contador chegando a zero, aguarde até aparecer `Go to live market` e clique.
5. Após clicar, aguarde a navegação para o mercado ativo e confirme que a página foi atualizada.
6. Se `SIDE === "UP"`, clique no outcome `UP` ou `Yes`.
7. Se `SIDE === "DOWN"`, clique no outcome `DOWN` ou `No`.
8. Preencha o valor da ordem com **$1**.
9. Revise o lado, o valor e a confirmação antes de submeter.
10. Confirme a ordem no navegador.

---

## Regras absolutas

- Nunca invente sinais.
- Nunca opere se `currentPrice` ou `priceToBeat` vierem nulos.
- Nunca opere duas vezes no mesmo `marketId`.
- Nunca opere se `timeLeftSec < 30` ou `timeLeftSec > 55`.
- Nunca opere se o preço do lado escolhido estiver fora de **0.80 a 0.88**.
- Nunca opere se menos de **4 dos 5 sinais** apontarem para a mesma direção.
- Sempre clicar em `Go to live market` se o mercado atual tiver expirado antes de operar.
- Se a página pedir login, interrompa e peça login manual no Edge do usuário.
- Se o Edge não estiver acessível via `edge-user`, tente `edge-debug` antes de falhar.

---

## Output obrigatório após execução

Sempre retorne:
1. JSON bruto do indicador no momento do trade
2. Decisão: lado escolhido, quantidade de sinais UP/DOWN, preço
3. Resumo do que foi clicado no browser
4. Resultado observado na tela
5. `filterReason` (caso não tenha operado)
6. `selectedPrice`