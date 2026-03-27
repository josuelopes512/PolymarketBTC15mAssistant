INDICATOR="$HOME/Sources/PolymarketBTC15mAssistant/scripts/run-openclaw-trade.sh"
POLL=3
ENTRY_MIN=30
ENTRY_MAX=55
PRICE_MIN=0.80
PRICE_MAX=0.88
TRADED="$HOME/.polymarket-traded-markets"

while true; do

  # ── Consultar indicador ──────────────────────────────────────
  JSON=$(bash "$INDICATOR" 2>/dev/null)

  # ── Extrair apenas os campos utilizados ─────────────────────
  OK=$(echo "$JSON"       | jq -r '.ok')
  TIME=$(echo "$JSON"     | jq    '.timeLeftSec')
  MID=$(echo "$JSON"      | jq -r '.marketId')
  SLUG=$(echo "$JSON"     | jq -r '.marketSlug')
  UP_P=$(echo "$JSON"     | jq    '.upPrice')
  DOWN_P=$(echo "$JSON"   | jq    '.downPrice')
  TA_LONG=$(echo "$JSON"  | jq    '.taLongPct')
  TA_SHORT=$(echo "$JSON" | jq    '.taShortPct')
  HEIKEN=$(echo "$JSON"   | jq -r '.heiken')
  RSI=$(echo "$JSON"      | jq    '.rsi')
  MACD=$(echo "$JSON"     | jq -r '.macd')
  CUR=$(echo "$JSON"      | jq    '.currentPrice')
  BEAT=$(echo "$JSON"     | jq    '.priceToBeat')

  echo "[$(date '+%H:%M:%S')] market=${MID} | timeLeft=${TIME}s | UP=${UP_P} DOWN=${DOWN_P}"

  # ── Validação básica ─────────────────────────────────────────
  [ "$OK" != "true" ] && echo "  → ok=false, abortando." && sleep $POLL && continue
  grep -qx "$MID" "$TRADED" 2>/dev/null && echo "  → mercado já operado." && sleep $POLL && continue

  # ── Controle de tempo ────────────────────────────────────────
  if [ "$TIME" -gt "$ENTRY_MAX" ]; then
    WAIT=$(( TIME - ENTRY_MAX ))
    echo "  → aguardando ${WAIT}s para janela de entrada..."
    sleep $POLL
    continue
  fi

  if [ "$TIME" -lt "$ENTRY_MIN" ]; then
    echo "  → janela expirada (${TIME}s). Aguardando próximo mercado."
    sleep $POLL
    continue
  fi

  echo "  → ⏱ JANELA ATINGIDA! Avaliando sinais..."

  # ── Avaliar sinais ───────────────────────────────────────────
  UP_SIG=0; DOWN_SIG=0; TOTAL_SIG=5

  # 1. TA Predict
  [ "$(echo "$TA_SHORT > 55" | bc -l)" = "1" ] && ((DOWN_SIG++)) || true
  [ "$(echo "$TA_LONG  > 55" | bc -l)" = "1" ] && ((UP_SIG++))   || true

  # 2. Heiken Ashi
  [[ "$HEIKEN" == red*   ]] && ((DOWN_SIG++)) || true
  [[ "$HEIKEN" == green* ]] && ((UP_SIG++))   || true

  # 3. RSI
  [ "$(echo "$RSI < 45" | bc -l)" = "1" ] && ((DOWN_SIG++)) || true
  [ "$(echo "$RSI > 55" | bc -l)" = "1" ] && ((UP_SIG++))   || true

  # 4. MACD
  [[ "$MACD" == bearish* ]] && ((DOWN_SIG++)) || true
  [[ "$MACD" == bullish* ]] && ((UP_SIG++))   || true

  # 5. currentPrice vs priceToBeat
  if [ "$CUR" = "null" ] || [ "$BEAT" = "null" ]; then
    echo "  → sinal 5 indisponível (null). Mínimo ajustado: 3/4"
    TOTAL_SIG=4
  else
    [ "$(echo "$CUR < $BEAT" | bc -l)" = "1" ] && ((DOWN_SIG++)) || true
    [ "$(echo "$CUR > $BEAT" | bc -l)" = "1" ] && ((UP_SIG++))   || true
  fi

  MIN_SIG=$([ "$TOTAL_SIG" = "5" ] && echo 4 || echo 3)
  echo "  → sinais: UP=${UP_SIG} DOWN=${DOWN_SIG} | mínimo: ${MIN_SIG}/${TOTAL_SIG}"

  # ── Decidir lado ─────────────────────────────────────────────
  SIDE=""; SIDE_PRICE=""

  if [ "$DOWN_SIG" -ge "$MIN_SIG" ] && [ "$DOWN_SIG" -gt "$UP_SIG" ]; then
    SIDE="DOWN"; SIDE_PRICE="$DOWN_P"
  elif [ "$UP_SIG" -ge "$MIN_SIG" ] && [ "$UP_SIG" -gt "$DOWN_SIG" ]; then
    SIDE="UP"; SIDE_PRICE="$UP_P"
  fi

  if [ -z "$SIDE" ]; then
    echo "  → sinais insuficientes ou empatados. Não operar."
    sleep $POLL
    continue
  fi

  # ── Verificar faixa de preço ─────────────────────────────────
  IN_RANGE=$(echo "$SIDE_PRICE >= $PRICE_MIN && $SIDE_PRICE <= $PRICE_MAX" | bc -l)
  if [ "$IN_RANGE" != "1" ]; then
    echo "  → preço ${SIDE_PRICE} fora da faixa [${PRICE_MIN}–${PRICE_MAX}]. Não operar."
    sleep $POLL
    continue
  fi

  # ── TRADE AUTORIZADO ─────────────────────────────────────────
  echo ""
  echo "  ✅ TRADE AUTORIZADO"
  echo "     Lado:    ${SIDE}"
  echo "     Preço:   ${SIDE_PRICE}"
  echo "     Mercado: ${MID} (${SLUG})"
  echo "     Sinais:  UP=${UP_SIG} DOWN=${DOWN_SIG} de ${TOTAL_SIG}"
  echo ""

  echo "$MID" >> "$TRADED"
  break

done