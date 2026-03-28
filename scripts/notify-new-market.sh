#!/usr/bin/env bash
# notify-new-market.sh — v1.9.2
# Detecta mudança de marketSlug e notifica via Telegram Bot API

BOT_TOKEN="${TELEGRAM_BOT_TOKEN}"
CHAT_ID="${TELEGRAM_CHAT_ID}"
INDICATOR="$HOME/Sources/PolymarketBTC15mAssistant/scripts/run-openclaw-trade.sh"
LOG="$HOME/polymarket-monitor.log"
POLL=4
LAST_SLUG=""
FAIL_COUNT=0
FAIL_MAX=20
SESSION_START=$(date +%s)
SESSION_MAX="${POLYMARKET_SESSION_MAX:-7200}"  # 2h padrão

send_msg() {
  curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
    --data-urlencode "chat_id=${CHAT_ID}" \
    --data-urlencode "text=$1" > /dev/null
}

echo "[$(date '+%H:%M:%S')] [WATCHER] notify-new-market.sh v1.9.2 iniciado." | tee -a "$LOG"

while true; do

  # ── Timeout de sessão ────────────────────────────────────────
  NOW=$(date +%s)
  ELAPSED=$(( NOW - SESSION_START ))
  if [ "$ELAPSED" -gt "$SESSION_MAX" ]; then
    echo "[$(date '+%H:%M:%S')] [WATCHER] SESSION_MAX atingido (${ELAPSED}s). Reiniciando..." | tee -a "$LOG"
    exec "$0" "$@"
  fi

  RAW=$(bash "$INDICATOR" 2>/dev/null)
  EXIT_CODE=$?

  if [ $EXIT_CODE -ne 0 ] || ! echo "$RAW" | jq . > /dev/null 2>&1; then
    ((FAIL_COUNT++)) || true
    echo "[$(date '+%H:%M:%S')] [WATCHER] ERROR_INDICATOR falhas=${FAIL_COUNT}/${FAIL_MAX}" | tee -a "$LOG"
    if [ "$FAIL_COUNT" -ge "$FAIL_MAX" ]; then
      echo "[$(date '+%H:%M:%S')] [WATCHER] FAIL_LIMIT atingido. Encerrando watcher." | tee -a "$LOG"
      exit 1
    fi
    sleep $POLL; continue
  fi

  FAIL_COUNT=0

  SLUG=$(echo "$RAW" | jq -r '.marketSlug // ""')
  TIME=$(echo "$RAW" | jq -r '.timeLeftSec // ""')
  UP=$(echo "$RAW"   | jq -r '.upPrice // ""')
  DOWN=$(echo "$RAW" | jq -r '.downPrice // ""')
  LIQ=$(echo "$RAW"  | jq -r '.liquidity // ""')

  if [ -n "$SLUG" ] && [ "$SLUG" != "null" ] && [ "$SLUG" != "$LAST_SLUG" ]; then
    HORA=$(date '+%H:%M')
    MSG="🔄 Nova janela aberta! (${HORA})

Mercado: ${SLUG}
⬆️ UP: ${UP} | ⬇️ DOWN: ${DOWN}
💧 Liquidez: \$${LIQ}
⏱ ${TIME}s restantes"

    send_msg "$MSG"
    echo "[$(date '+%H:%M:%S')] [WATCHER] Notificação enviada: ${SLUG} (UP=${UP} DOWN=${DOWN})" | tee -a "$LOG"
    LAST_SLUG="$SLUG"
  fi

  sleep $POLL
done
