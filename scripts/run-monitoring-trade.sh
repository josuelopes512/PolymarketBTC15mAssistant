#!/usr/bin/env bash
# run-monitoring-trade.sh — v1.9.2
# Referência canônica: SKILL.md polymarket-browser-trader v1.9.2

INDICATOR="$HOME/Sources/PolymarketBTC15mAssistant/scripts/run-openclaw-trade.sh"
POLL=3
ENTRY_MIN=30
ENTRY_MAX=55
PRICE_MIN=0.80
PRICE_MAX="${MAX_ENTRY_PRICE:-0.85}"
MIN_LIQ="${MIN_LIQUIDITY:-1000}"
STAKE="${STAKE_USD:-1}"
DRY="${DRY_RUN:-true}"
DEDUPE="$HOME/.polymarket-dedupe"
AUDIT="$HOME/.polymarket-audit.log"
LOG="$HOME/polymarket-monitor.log"
INDICATOR_STDERR="$HOME/polymarket-indicator-errors.log"

SESSION_START=$(date +%s)
SESSION_MAX="${POLYMARKET_SESSION_MAX:-7200}"  # padrão 2h, configurável
FAIL_COUNT=0
FAIL_MAX=20

touch "$DEDUPE" "$AUDIT"

# ── Rotacionar logs se > 5MB ──────────────────────────────────
for F in "$LOG" "$INDICATOR_STDERR"; do
  if [ -f "$F" ] && [ "$(stat -f%z "$F" 2>/dev/null || stat -c%s "$F")" -gt 5242880 ]; then
    mv "$F" "${F}.$(date '+%Y%m%d-%H%M%S').bak"
    touch "$F"
  fi
done

# ── Função de validação numérica (regex — fix decimal) ────────
is_numeric() {
  local v="$1"
  [ -z "$v" ] && return 1
  [ "$v" = "null" ] && return 1
  [[ "$v" =~ ^-?[0-9]+(\.[0-9]+)?$ ]] && return 0 || return 1
}

# ── Função de gravação em audit ───────────────────────────────
audit_write() {
  echo "$(date '+%Y-%m-%d %H:%M:%S')|$1|$2|$3|$4|$5|$6|$7|$8" >> "$AUDIT"
}

# ── Trap SIGINT/SIGTERM ───────────────────────────────────────
AUTHORIZED_MID=""
AUTHORIZED_EXEC_ID=""
trap '
  if [ -n "$AUTHORIZED_MID" ]; then
    grep -qx "$AUTHORIZED_MID" "$DEDUPE" || echo "$AUTHORIZED_MID" >> "$DEDUPE"
    audit_write "$AUTHORIZED_EXEC_ID" "$AUTHORIZED_MID" "" "" "" "$STAKE" "$DRY" "INTERRUPTED_AFTER_AUTH"
    echo "[$(date "+%H:%M:%S")] [ERROR_INTERRUPTED] Interrompido após autorização de ${AUTHORIZED_MID}" | tee -a "$LOG"
  fi
  exit 1
' INT TERM

while true; do

  # ── Timeout de sessão ────────────────────────────────────────
  NOW=$(date +%s)
  ELAPSED=$(( NOW - SESSION_START ))
  if [ "$ELAPSED" -gt "$SESSION_MAX" ]; then
    echo "[$(date '+%H:%M:%S')] [ERROR_SESSION_TIMEOUT] Sessão encerrada após ${ELAPSED}s (máx ${SESSION_MAX}s). Reiniciando..." | tee -a "$LOG"
    exec "$0" "$@"  # auto-restart
  fi

  # ── Consultar indicador ──────────────────────────────────────
  RAW=$(bash "$INDICATOR" 2>>"$INDICATOR_STDERR")
  EXIT_CODE=$?

  if [ $EXIT_CODE -ne 0 ]; then
    ((FAIL_COUNT++)) || true
    echo "[$(date '+%H:%M:%S')] [ERROR_INDICATOR_FAILED] exit=${EXIT_CODE} falhas=${FAIL_COUNT}/${FAIL_MAX}" | tee -a "$LOG"
    if [ "$FAIL_COUNT" -ge "$FAIL_MAX" ]; then
      echo "[$(date '+%H:%M:%S')] [ERROR_FAIL_LIMIT] Limite de falhas atingido. Encerrando." | tee -a "$LOG"
      exit 1
    fi
    sleep $POLL; continue
  fi

  # ── Validar JSON ─────────────────────────────────────────────
  if ! echo "$RAW" | jq . > /dev/null 2>&1; then
    ((FAIL_COUNT++)) || true
    echo "[$(date '+%H:%M:%S')] [ERROR_JSON_INVALID] falhas=${FAIL_COUNT}/${FAIL_MAX}" | tee -a "$LOG"
    if [ "$FAIL_COUNT" -ge "$FAIL_MAX" ]; then
      echo "[$(date '+%H:%M:%S')] [ERROR_FAIL_LIMIT] Limite de falhas atingido. Encerrando." | tee -a "$LOG"
      exit 1
    fi
    sleep $POLL; continue
  fi

  FAIL_COUNT=0

  # ── Extrair campos individualmente (fix bug @tsv com espaços) ─
  OK=$(echo "$RAW"       | jq -r '.ok // "false"')
  TIME=$(echo "$RAW"     | jq -r '.timeLeftSec // "null"')
  MID=$(echo "$RAW"      | jq -r '.marketId // ""')
  SLUG=$(echo "$RAW"     | jq -r '.marketSlug // ""')
  UP_P=$(echo "$RAW"     | jq -r '.upPrice // "null"')
  DOWN_P=$(echo "$RAW"   | jq -r '.downPrice // "null"')
  LIQ=$(echo "$RAW"      | jq -r '.liquidity // "null"')
  TA_LONG=$(echo "$RAW"  | jq -r '.taLongPct // "null"')
  TA_SHORT=$(echo "$RAW" | jq -r '.taShortPct // "null"')
  HEIKEN=$(echo "$RAW"   | jq -r '(.heiken // "") | ascii_downcase | ltrimstr(" ") | rtrimstr(" ")')
  RSI=$(echo "$RAW"      | jq -r '.rsi // "null"')
  MACD=$(echo "$RAW"     | jq -r '(.macd // "") | ascii_downcase | ltrimstr(" ") | rtrimstr(" ")')
  CUR=$(echo "$RAW"      | jq -r '.currentPrice // "null"')
  BEAT=$(echo "$RAW"     | jq -r '.priceToBeat // "null"')
  NODE_SIDE=$(echo "$RAW"| jq -r '.side // "null"')

  EXEC_ID="$(date '+%Y%m%d%H%M%S')-${MID:-unknown}"

  echo "[$(date '+%H:%M:%S')] [exec=${EXEC_ID}] market=${MID} slug=${SLUG} timeLeft=${TIME}s UP=${UP_P} DOWN=${DOWN_P} liq=${LIQ} dry=${DRY}" | tee -a "$LOG"

  # ── 1. Validação de identidade ───────────────────────────────
  if [ "$OK" != "true" ]; then
    echo "  [REJECT_OK_FALSE]" | tee -a "$LOG"
    sleep $POLL; continue
  fi

  if [ -z "$MID" ] || [ "$MID" = "null" ]; then
    echo "  [REJECT_MID_EMPTY]" | tee -a "$LOG"
    sleep $POLL; continue
  fi

  if [ -z "$SLUG" ] || [ "$SLUG" = "null" ]; then
    echo "  [REJECT_SLUG_EMPTY]" | tee -a "$LOG"
    sleep $POLL; continue
  fi

  if grep -qx "$MID" "$DEDUPE" 2>/dev/null; then
    echo "  [REJECT_ALREADY_TRADED] marketId=${MID}" | tee -a "$LOG"
    sleep $POLL; continue
  fi

  # ── 2. Campos de controle ────────────────────────────────────
  if ! [[ "$TIME" =~ ^[0-9]+$ ]]; then
    echo "  [REJECT_TIME_INVALID] timeLeftSec='${TIME}'" | tee -a "$LOG"
    sleep $POLL; continue
  fi

  if ! is_numeric "$LIQ"; then
    echo "  [REJECT_LOW_LIQUIDITY] liquidity inválido: '${LIQ}'" | tee -a "$LOG"
    sleep $POLL; continue
  fi
  LIQ_OK=$(awk -v l="$LIQ" -v m="$MIN_LIQ" 'BEGIN{print (l+0>=m+0)?"1":"0"}')
  if [ "$LIQ_OK" != "1" ]; then
    echo "  [REJECT_LOW_LIQUIDITY] liquidity=${LIQ} < min=${MIN_LIQ}" | tee -a "$LOG"
    sleep $POLL; continue
  fi

  # ── 3. Controle de tempo ─────────────────────────────────────
  if [ "$TIME" -gt "$ENTRY_MAX" ]; then
    WAIT=$(( TIME - ENTRY_MAX ))
    echo "  [WAIT_ENTRY_WINDOW] aguardando ${WAIT}s..." | tee -a "$LOG"
    sleep $POLL; continue
  fi

  if [ "$TIME" -lt "$ENTRY_MIN" ]; then
    echo "  [REJECT_TIME_WINDOW] timeLeftSec=${TIME} < ${ENTRY_MIN}s. Próximo mercado." | tee -a "$LOG"
    sleep $POLL; continue
  fi

  echo "  [EVAL_WINDOW_REACHED] Janela atingida. Avaliando sinais..." | tee -a "$LOG"

  # ── 4. Avaliar sinais ────────────────────────────────────────
  UP_SIG=0; DOWN_SIG=0; TOTAL_SIG=0

  # Sinal 1: TA Predict
  if is_numeric "$TA_SHORT" && is_numeric "$TA_LONG"; then
    ((TOTAL_SIG++)) || true
    [ "$(awk -v v="$TA_SHORT" 'BEGIN{print (v+0>55)?"1":"0"}')" = "1" ] && ((DOWN_SIG++)) || true
    [ "$(awk -v v="$TA_LONG"  'BEGIN{print (v+0>55)?"1":"0"}')" = "1" ] && ((UP_SIG++))   || true
  else
    echo "  [REJECT_SIGNAL_FIELD_INVALID] sinal 1 (TA Predict): taLongPct='${TA_LONG}' taShortPct='${TA_SHORT}'" | tee -a "$LOG"
  fi

  # Sinal 2: Heiken Ashi
  if [ -n "$HEIKEN" ] && [ "$HEIKEN" != "null" ]; then
    ((TOTAL_SIG++)) || true
    [[ "$HEIKEN" == red*   ]] && ((DOWN_SIG++)) || true
    [[ "$HEIKEN" == green* ]] && ((UP_SIG++))   || true
  else
    echo "  [REJECT_SIGNAL_FIELD_INVALID] sinal 2 (Heiken): heiken='${HEIKEN}'" | tee -a "$LOG"
  fi

  # Sinal 3: RSI
  if is_numeric "$RSI"; then
    ((TOTAL_SIG++)) || true
    [ "$(awk -v v="$RSI" 'BEGIN{print (v+0<45)?"1":"0"}')" = "1" ] && ((DOWN_SIG++)) || true
    [ "$(awk -v v="$RSI" 'BEGIN{print (v+0>55)?"1":"0"}')" = "1" ] && ((UP_SIG++))   || true
  else
    echo "  [REJECT_SIGNAL_FIELD_INVALID] sinal 3 (RSI): rsi='${RSI}'" | tee -a "$LOG"
  fi

  # Sinal 4: MACD (apenas prefixo — ignora sufixo como "(expanding)")
  if [ -n "$MACD" ] && [ "$MACD" != "null" ]; then
    ((TOTAL_SIG++)) || true
    [[ "$MACD" == bearish* ]] && ((DOWN_SIG++)) || true
    [[ "$MACD" == bullish* ]] && ((UP_SIG++))   || true
  else
    echo "  [REJECT_SIGNAL_FIELD_INVALID] sinal 4 (MACD): macd='${MACD}'" | tee -a "$LOG"
  fi

  # Sinal 5: currentPrice vs priceToBeat
  if is_numeric "$CUR" && is_numeric "$BEAT"; then
    ((TOTAL_SIG++)) || true
    [ "$(awk -v c="$CUR" -v b="$BEAT" 'BEGIN{print (c+0<b+0)?"1":"0"}')" = "1" ] && ((DOWN_SIG++)) || true
    [ "$(awk -v c="$CUR" -v b="$BEAT" 'BEGIN{print (c+0>b+0)?"1":"0"}')" = "1" ] && ((UP_SIG++))   || true
  else
    echo "  [REJECT_SIGNAL_FIELD_INVALID] sinal 5 (price): currentPrice='${CUR}' priceToBeat='${BEAT}'" | tee -a "$LOG"
  fi

  # Piso absoluto
  if [ "$TOTAL_SIG" -lt 3 ]; then
    echo "  [REJECT_SIGNALS_INSUFFICIENT] TOTAL_SIG=${TOTAL_SIG} < 3 (piso absoluto). Não operar." | tee -a "$LOG"
    sleep $POLL; continue
  fi

  MIN_SIG=$(awk -v t="$TOTAL_SIG" 'BEGIN{print (t>=5)?4:3}')
  echo "  sinais: UP=${UP_SIG} DOWN=${DOWN_SIG} | disponíveis: ${TOTAL_SIG} | mínimo: ${MIN_SIG}" | tee -a "$LOG"

  # ── Decidir lado ─────────────────────────────────────────────
  SIDE=""; SIDE_PRICE=""

  if [ "$DOWN_SIG" -ge "$MIN_SIG" ] && [ "$DOWN_SIG" -gt "$UP_SIG" ]; then
    SIDE="DOWN"; SIDE_PRICE="$DOWN_P"
  elif [ "$UP_SIG" -ge "$MIN_SIG" ] && [ "$UP_SIG" -gt "$DOWN_SIG" ]; then
    SIDE="UP"; SIDE_PRICE="$UP_P"
  fi

  if [ -z "$SIDE" ]; then
    echo "  [REJECT_SIGNALS_INSUFFICIENT] UP=${UP_SIG} DOWN=${DOWN_SIG} mínimo=${MIN_SIG}" | tee -a "$LOG"
    sleep $POLL; continue
  fi

  # Divergência Node vs skill
  if [ "$NODE_SIDE" != "null" ] && [ "$NODE_SIDE" != "$SIDE" ]; then
    echo "  [RESULT_SIDE_DIVERGENCE] Node=${NODE_SIDE} skill=${SIDE} — decisão da skill mantida" | tee -a "$LOG"
  fi

  # ── 5. Verificar faixa de preço ──────────────────────────────
  if ! is_numeric "$SIDE_PRICE"; then
    echo "  [REJECT_PRICE_OUT_OF_RANGE] ${SIDE} price inválido: '${SIDE_PRICE}'" | tee -a "$LOG"
    sleep $POLL; continue
  fi
  IN_RANGE=$(awk -v p="$SIDE_PRICE" -v mn="$PRICE_MIN" -v mx="$PRICE_MAX" \
    'BEGIN{print (p+0>=mn+0 && p+0<=mx+0)?"1":"0"}')
  if [ "$IN_RANGE" != "1" ]; then
    echo "  [REJECT_PRICE_OUT_OF_RANGE] ${SIDE} price=${SIDE_PRICE} fora [${PRICE_MIN}–${PRICE_MAX}]" | tee -a "$LOG"
    sleep $POLL; continue
  fi

  # ── TRADE AUTORIZADO ─────────────────────────────────────────
  AUTHORIZED_MID="$MID"
  AUTHORIZED_EXEC_ID="$EXEC_ID"

  {
    echo ""
    echo "  [AUTH_TRADE_ALLOWED]"
    echo "     exec_id:    ${EXEC_ID}"
    echo "     marketId:   ${MID}"
    echo "     marketSlug: ${SLUG}"
    echo "     Lado:       ${SIDE}"
    echo "     Preço:      ${SIDE_PRICE}"
    echo "     Stake:      \$${STAKE}"
    echo "     Sinais:     UP=${UP_SIG} DOWN=${DOWN_SIG} de ${TOTAL_SIG} (mín=${MIN_SIG})"
    echo "     DRY_RUN:    ${DRY}"
    echo "     Timestamp:  $(date '+%Y-%m-%d %H:%M:%S')"
    echo ""
    echo "     RAW_JSON: $RAW"
    echo ""
  } | tee -a "$LOG"

  if [ "$DRY" = "true" ]; then
    audit_write "$EXEC_ID" "$MID" "$SLUG" "$SIDE" "$SIDE_PRICE" "$STAKE" "$DRY" "SKIPPED_DRY_RUN"
    echo "  [RESULT_DRY_RUN_SKIPPED] DRY_RUN=true — browser não aberto, ordem não enviada." | tee -a "$LOG"
    AUTHORIZED_MID=""; AUTHORIZED_EXEC_ID=""
    sleep $POLL; continue
  fi

  # Gravar dedupe apenas para trades reais
  echo "$MID" >> "$DEDUPE"
  audit_write "$EXEC_ID" "$MID" "$SLUG" "$SIDE" "$SIDE_PRICE" "$STAKE" "$DRY" "AUTHORIZED"
  AUTHORIZED_MID=""; AUTHORIZED_EXEC_ID=""

  break  # vai para Fase 3 (gerenciada pela skill)

done
