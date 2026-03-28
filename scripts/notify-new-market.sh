#!/usr/bin/env bash
# notify-new-market.sh — Watcher de nova janela Polymarket BTC 5m
# Detecta mudança de marketSlug e notifica via Telegram Bot API

BOT_TOKEN="${TELEGRAM_BOT_TOKEN}"
CHAT_ID="${TELEGRAM_CHAT_ID}"
INDICATOR="$HOME/Sources/PolymarketBTC15mAssistant/scripts/run-openclaw-trade.sh"
POLL=4
LAST_SLUG=""

send_msg() {
  curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
    --data-urlencode "chat_id=${CHAT_ID}" \
    --data-urlencode "text=$1" > /dev/null
}

echo "[$(date '+%H:%M:%S')] notify-new-market.sh iniciado. Monitorando..."

while true; do
  RAW=$(bash "$INDICATOR" 2>/dev/null)
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
    echo "[$(date '+%H:%M:%S')] Notificação enviada: $SLUG (UP=${UP} DOWN=${DOWN})"
    LAST_SLUG="$SLUG"
  fi

  sleep $POLL
done
