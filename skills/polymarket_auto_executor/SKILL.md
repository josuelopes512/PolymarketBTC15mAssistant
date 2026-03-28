---
name: polymarket-browser-trader
description: Monitora continuamente mercados Polymarket BTC Up/Down 5m e executa o trade automaticamente quando a janela de entrada for atingida, usando a sessão existente do Microsoft Edge do usuário.
version: 1.9.2
metadata:
  openclaw:
    requires:
      bins:
        - bash
        - jq
        - node
        - awk
      env:
        - DRY_RUN
        - STAKE_USD
        - MAX_ENTRY_PRICE
        - MIN_LIQUIDITY
        - EXECUTION_MODE
---

## Arquivos de estado

| Arquivo | Papel |
|---|---|
| `~/.polymarket-dedupe` | Deduplicação — contém apenas um `marketId` por linha |
| `~/.polymarket-audit.log` | Auditoria — linhas estruturadas pipe-delimited com status |
| `~/polymarket-monitor.log` | Log principal de eventos com taxonomia |
| `~/polymarket-indicator-errors.log` | stderr do indicador Node |

> Separar dedupe de auditoria resolve o bug de deduplicação da v1.9.0 e permite estados explícitos por trade.

---

## Variáveis de ambiente

| Variável          | Padrão     | Descrição                                                           |
|-------------------|------------|---------------------------------------------------------------------|
| `DRY_RUN`         | `true`     | `true`: loga decisão, NÃO abre browser, NÃO clica, NÃO confirma   |
| `STAKE_USD`       | `1`        | Valor fixo da ordem em dólares (deve ser > 0)                       |
| `MAX_ENTRY_PRICE` | `0.85`     | Compatibilidade com padrão real do `run-openclaw-trade.sh`          |
| `MIN_LIQUIDITY`   | `1000`     | Liquidez mínima exigida no JSON (deve ser ≥ 0)                      |
| `EXECUTION_MODE`  | `openclaw` | Modo de execução do script Node (valor aceito: `openclaw`)          |

> `MAX_ENTRY_PRICE=0.85` é padrão por **compatibilidade com o script Node**, não decisão estratégica.
> Para ampliar para `0.88`, exportar explicitamente antes de chamar.
>
> `DRY_RUN=true` por padrão. Com `DRY_RUN=true`:
> - loga `AUTH_TRADE_ALLOWED`
> - grava no audit com status `SKIPPED_DRY_RUN`
> - **não grava em dedupe** (mercado pode ser retentado após teste)
> - **não abre o browser, não clica, não preenche stake, não confirma ordem**

```bash
export DRY_RUN=false
export STAKE_USD=1
export MAX_ENTRY_PRICE=0.85
export MIN_LIQUIDITY=1000
export EXECUTION_MODE=openclaw
```

---

## Taxonomia de eventos de log

| Prefixo | Quando usar |
|---|---|
| `ERROR_*` | Falha técnica do sistema (JSON inválido, node falhou, Edge inacessível) |
| `REJECT_*` | Mercado válido, mas não elegível pelos critérios |
| `WAIT_*` | Aguardando condição temporária |
| `EVAL_*` | Avaliação de sinais em andamento |
| `AUTH_*` | Trade autorizado |
| `EXEC_*` | Ação executada no browser |
| `RESULT_*` | Resultado final da execução |

Códigos de uso:
```
ERROR_JSON_INVALID           ERROR_INDICATOR_FAILED
ERROR_FAIL_LIMIT             ERROR_SESSION_TIMEOUT
ERROR_INTERRUPTED            ERROR_CONFIG_INVALID
REJECT_OK_FALSE              REJECT_MID_EMPTY
REJECT_SLUG_EMPTY            REJECT_ALREADY_TRADED
REJECT_TIME_INVALID          REJECT_LOW_LIQUIDITY
REJECT_TIME_WINDOW           REJECT_SIGNALS_INSUFFICIENT
REJECT_PRICE_OUT_OF_RANGE    REJECT_SIGNAL_FIELD_INVALID
WAIT_ENTRY_WINDOW
EVAL_WINDOW_REACHED          EVAL_SIGNAL_DIVERGENCE
AUTH_TRADE_ALLOWED
EXEC_NAVIGATE                EXEC_CONFIRM_SLUG
EXEC_LIVE_MARKET             EXEC_BROWSER_CLICK
EXEC_STAKE_FILLED            EXEC_PRE_SUBMIT_CHECK
EXEC_CONFIRM_ORDER
RESULT_ORDER_SUBMITTED       RESULT_DRY_RUN_SKIPPED
RESULT_ABORT_PHASE3          RESULT_SIDE_DIVERGENCE
```

---

## JSON retornado por `run-openclaw-trade.sh` (estrutura real)

```json
{
  "ok":                  true,
  "marketId":            "1734030",
  "marketSlug":          "btc-updown-5m-1774638300",
  "timeLeftSec":         43,
  "currentPrice":        65753.62,
  "priceToBeat":         65787.00,
  "upPrice":             0.12,
  "downPrice":           0.87,
  "taLongPct":           48,
  "taShortPct":          52,
  "heiken":              "red x3",
  "rsi":                 40.8,
  "macd":                "bearish (expanding)",
  "action":              "NO_TRADE",
  "side":                null,
  "phase":               "LATE",
  "strength":            null,
  "edgeUp":              0.36,
  "edgeDown":           -0.36,
  "modelUp":             0.48,
  "modelDown":           0.51,
  "liquidity":           24940.46,
  "selectedPrice":       null,
  "fixedStakeUsd":       1,
  "browserTradeAllowed": false,
  "filterReason":        "action_not_enter"
}
```

### Campos computados pelo script — NÃO usados na decisão da skill

`action`, `side`, `browserTradeAllowed`, `filterReason`, `selectedPrice`,
`phase`, `strength`, `edgeUp`, `edgeDown`, `modelUp`, `modelDown`
→ **completamente ignorados** pela lógica de decisão.

Se `side` do Node divergir do `SIDE` da skill → logar `RESULT_SIDE_DIVERGENCE`, não alterar decisão.

---

## Campos utilizados pela skill

```
ok, marketId, marketSlug, timeLeftSec,
upPrice, downPrice, liquidity,
taLongPct, taShortPct,
heiken, rsi, macd,
currentPrice, priceToBeat
```

### Política de campos numéricos

Função de validação usada antes de qualquer comparação:

```bash
is_numeric() {
  # Retorna 0 (sucesso) se o valor é numérico (inteiro ou decimal, positivo ou negativo)
  # Usa regex — fix do bug de decimais com awk em macOS
  local v="$1"
  [ -z "$v" ] && return 1
  [ "$v" = "null" ] && return 1
  [[ "$v" =~ ^-?[0-9]+(\.[0-9]+)?$ ]] && return 0 || return 1
}
```

Política por tipo de campo:
- **Campos de controle** (`timeLeftSec`, `liquidity`): inválido → **rejeitar iteração inteira** com `REJECT_TIME_INVALID` ou `REJECT_LOW_LIQUIDITY`
- **Campos de sinal** (`taLongPct`, `taShortPct`, `rsi`, `upPrice`, `downPrice`, `currentPrice`, `priceToBeat`): inválido → **descartar aquele sinal**, decrementar `TOTAL_SIG`, logar `REJECT_SIGNAL_FIELD_INVALID`
- **Campos de texto** (`heiken`, `macd`): vazio, `null` ou formato inesperado → descartar sinal, logar `REJECT_SIGNAL_FIELD_INVALID`

---

## Critérios de decisão (TODOS devem ser satisfeitos)

### 1. Validação de config (boot)
- `STAKE_USD` > 0
- `MAX_ENTRY_PRICE` ≥ 0.80
- `MIN_LIQUIDITY` ≥ 0
- `EXECUTION_MODE` = `"openclaw"`

### 2. Validação de identidade (por iteração)
- `ok = true`
- JSON válido e parseable
- `marketId` não vazio, não `null`
- `marketSlug` não vazio, não `null`
- `marketId` não presente em `~/.polymarket-dedupe`

### 3. Campos de controle válidos
- `timeLeftSec` é inteiro ≥ 0
- `liquidity` é número ≥ `MIN_LIQUIDITY`

### 4. Janela de tempo: `30 ≤ timeLeftSec ≤ 55`

### 5. Sinais técnicos

| # | Sinal | DOWN | UP | Campo(s) necessário(s) |
|---|---|---|---|---|
| 1 | **TA Predict** | `taShortPct > 55` | `taLongPct > 55` | `taShortPct`, `taLongPct` |
| 2 | **Heiken Ashi** | começa com `"red"` | começa com `"green"` | `heiken` não vazio |
| 3 | **RSI** | `rsi < 45` | `rsi > 55` | `rsi` numérico |
| 4 | **MACD** | começa com `"bearish"` | começa com `"bullish"` | `macd` não vazio |
| 5 | **currentPrice vs priceToBeat** | `currentPrice < priceToBeat` | `currentPrice > priceToBeat` | ambos numéricos |

**Piso absoluto:** se `TOTAL_SIG < 3` após descartes → **rejeitar iteração** com `REJECT_SIGNALS_INSUFFICIENT`.
**Mínimo de aprovação:**
- `TOTAL_SIG = 5` → `MIN_SIG = 4`
- `TOTAL_SIG = 4` → `MIN_SIG = 3`
- `TOTAL_SIG = 3` → `MIN_SIG = 3`
- `TOTAL_SIG < 3` → **rejeitar, nunca operar**

### 6. Preço: `0.80 ≤ sidePrice ≤ MAX_ENTRY_PRICE`
- DOWN → `downPrice`; UP → `upPrice`

---

## Procedimento

### Fase 1 — Inicialização e validação de config

```bash
export DRY_RUN=false
export STAKE_USD=1
export MAX_ENTRY_PRICE=0.85
export MIN_LIQUIDITY=1000
export EXECUTION_MODE=openclaw

DEDUPE="$HOME/.polymarket-dedupe"
AUDIT="$HOME/.polymarket-audit.log"
LOG="$HOME/polymarket-monitor.log"
INDICATOR_STDERR="$HOME/polymarket-indicator-errors.log"

touch "$DEDUPE" "$AUDIT"

# ── Validar variáveis de ambiente ─────────────────────────────
CONFIG_ERR=""
[ "$(awk -v v="$STAKE_USD"       'BEGIN{print (v+0>0)?"ok":"err"}')" != "ok" ]        && CONFIG_ERR="STAKE_USD deve ser > 0 (atual: ${STAKE_USD})"
[ "$(awk -v v="$MAX_ENTRY_PRICE" 'BEGIN{print (v+0>=0.80)?"ok":"err"}')" != "ok" ]    && CONFIG_ERR="MAX_ENTRY_PRICE deve ser >= 0.80 (atual: ${MAX_ENTRY_PRICE})"
[ "$(awk -v v="$MIN_LIQUIDITY"   'BEGIN{print (v+0>=0)?"ok":"err"}')" != "ok" ]       && CONFIG_ERR="MIN_LIQUIDITY deve ser >= 0 (atual: ${MIN_LIQUIDITY})"
[ "$EXECUTION_MODE" != "openclaw" ]                                                    && CONFIG_ERR="EXECUTION_MODE deve ser 'openclaw' (atual: ${EXECUTION_MODE})"

if [ -n "$CONFIG_ERR" ]; then
  echo "[$(date '+%H:%M:%S')] [ERROR_CONFIG_INVALID] ${CONFIG_ERR}" | tee -a "$LOG"
  exit 1
fi

# ── Rotacionar logs se > 5MB ──────────────────────────────────
for F in "$LOG" "$INDICATOR_STDERR"; do
  if [ -f "$F" ] && [ "$(stat -f%z "$F" 2>/dev/null || stat -c%s "$F")" -gt 5242880 ]; then
    mv "$F" "${F}.$(date '+%Y%m%d-%H%M%S').bak"
    touch "$F"
  fi
done

# Garantir Edge via profile edge-user; se não responder: edge-debug
```

---

### Fase 2 — Executar o watcher de notificações e o script de monitoramento

Sempre iniciar os dois processos em paralelo (background + foreground):

```bash
# Watcher: notifica no Telegram a cada nova janela de mercado
bash "$HOME/Sources/PolymarketBTC15mAssistant/scripts/notify-new-market.sh" &
WATCHER_PID=$!
echo "[$(date '+%H:%M:%S')] Watcher iniciado (PID=${WATCHER_PID})"

# Monitor principal: avalia sinais e executa trades
bash "$HOME/Sources/PolymarketBTC15mAssistant/scripts/run-monitoring-trade.sh"

# Encerrar watcher quando o monitor terminar
kill $WATCHER_PID 2>/dev/null
```

> O `notify-new-market.sh` detecta mudança de `marketSlug` e envia mensagem direto no Telegram via Bot API a cada nova janela de 5 minutos.
> Variáveis opcionais: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `POLYMARKET_SESSION_MAX` (padrão: 7200s = 2h).
> O watcher faz auto-restart ao atingir `SESSION_MAX` e encerra após `FAIL_MAX=20` falhas técnicas consecutivas.

> O `run-monitoring-trade.sh` deve implementar exatamente a mesma política do fallback inline abaixo.
> O fallback inline é a **referência canônica de comportamento**.
> Em caso de divergência, o fallback inline prevalece.

---

### Fase 2 (fallback inline) — referência canônica

```bash
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
SESSION_MAX="${POLYMARKET_SESSION_MAX:-7200}"  # padrão 2h; configurável via env
FAIL_COUNT=0
FAIL_MAX=20

# ── Função de validação numérica ─────────────────────────────
is_numeric() {
  local v="$1"
  [ -z "$v" ] && return 1
  [ "$v" = "null" ] && return 1
  echo "$v" | awk '{if($0+0==$0 && $0!="") exit 0; else exit 1}' 2>/dev/null
}

# ── Função de gravação em audit ───────────────────────────────
audit_write() {
  # audit_write EXEC_ID MID SLUG SIDE PRICE STAKE DRY STATUS
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
    exec "$0" "$@"  # auto-restart: substitui o processo atual por uma nova instância
  fi

  # ── Consultar indicador ──────────────────────────────────────
  RAW=$(bash "$INDICATOR" 2>>"$INDICATOR_STDERR")
  EXIT_CODE=$?

  if [ $EXIT_CODE -ne 0 ]; then
    ((FAIL_COUNT++)) || true
    echo "[$(date '+%H:%M:%S')] [ERROR_INDICATOR_FAILED] exit=${EXIT_CODE} falhas=${FAIL_COUNT}/${FAIL_MAX}" | tee -a "$LOG"
    [ "$FAIL_COUNT" -ge "$FAIL_MAX" ] && echo "[ERROR_FAIL_LIMIT] Encerrando." | tee -a "$LOG" && exit 1
    sleep $POLL; continue
  fi

  # ── Validar JSON ─────────────────────────────────────────────
  if ! echo "$RAW" | jq . > /dev/null 2>&1; then
    ((FAIL_COUNT++)) || true
    echo "[$(date '+%H:%M:%S')] [ERROR_JSON_INVALID] falhas=${FAIL_COUNT}/${FAIL_MAX}" | tee -a "$LOG"
    [ "$FAIL_COUNT" -ge "$FAIL_MAX" ] && echo "[ERROR_FAIL_LIMIT] Encerrando." | tee -a "$LOG" && exit 1
    sleep $POLL; continue
  fi

  FAIL_COUNT=0

  # ── Extrair campos em uma única chamada jq ───────────────────
  # Extrair campos individualmente — fix bug @tsv com espaços em campos como "bearish (expanding)"
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

  # Deduplicação via arquivo separado de um campo só
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

  # Sinal 4: MACD
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

  # Piso absoluto: mínimo 3 sinais válidos disponíveis
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
    # Salvar JSON bruto para rastreabilidade
    echo "     RAW_JSON: $RAW"
    echo ""
  } | tee -a "$LOG"

  if [ "$DRY" = "true" ]; then
    # DRY_RUN: NÃO grava em dedupe (mercado pode ser retentado)
    audit_write "$EXEC_ID" "$MID" "$SLUG" "$SIDE" "$SIDE_PRICE" "$STAKE" "$DRY" "SKIPPED_DRY_RUN"
    echo "  [RESULT_DRY_RUN_SKIPPED] DRY_RUN=true — browser não aberto, ordem não enviada." | tee -a "$LOG"
    AUTHORIZED_MID=""; AUTHORIZED_EXEC_ID=""
    sleep $POLL; continue
  fi

  # Gravar dedupe apenas para trades reais
  echo "$MID" >> "$DEDUPE"
  audit_write "$EXEC_ID" "$MID" "$SLUG" "$SIDE" "$SIDE_PRICE" "$STAKE" "$DRY" "AUTHORIZED"
  AUTHORIZED_MID=""; AUTHORIZED_EXEC_ID=""

  break  # vai para Fase 3

done
```

---

### Fase 3 — Execução no browser (apenas se `DRY_RUN=false`)

#### Recheck obrigatório antes de qualquer clique

```bash
RECHECK_JSON=$(bash "$INDICATOR" 2>/dev/null)
RECHECK_TIME=$(echo "$RECHECK_JSON" | jq '.timeLeftSec // 0')
RECHECK_MID=$(echo "$RECHECK_JSON"  | jq -r '.marketId // ""')
RECHECK_SLUG=$(echo "$RECHECK_JSON" | jq -r '.marketSlug // ""')
RECHECK_LIQ=$(echo "$RECHECK_JSON"  | jq '.liquidity // 0')
RECHECK_UP=$(echo "$RECHECK_JSON"   | jq '.upPrice // 0')
RECHECK_DOWN=$(echo "$RECHECK_JSON" | jq '.downPrice // 0')

RECHECK_PRICE=$([ "$SIDE" = "UP" ] && echo "$RECHECK_UP" || echo "$RECHECK_DOWN")

ABORT=""
[ "$RECHECK_TIME" -lt 10 ]            && ABORT="timeLeftSec=${RECHECK_TIME} < 10s"
[ "$RECHECK_MID"  != "$MID"  ]        && ABORT="marketId mudou: esperado=${MID} atual=${RECHECK_MID}"
[ "$RECHECK_SLUG" != "$SLUG" ]        && ABORT="marketSlug mudou: esperado=${SLUG} atual=${RECHECK_SLUG}"
[ "$(awk -v p="$RECHECK_PRICE" -v mn="$PRICE_MIN" -v mx="$PRICE_MAX" \
  'BEGIN{print (p+0<mn+0||p+0>mx+0)?"1":"0"}')" = "1" ] && ABORT="preço fora da faixa: ${RECHECK_PRICE}"
[ "$(awk -v l="$RECHECK_LIQ" -v m="$MIN_LIQ" \
  'BEGIN{print (l+0<m+0)?"1":"0"}')" = "1" ]             && ABORT="liquidez insuficiente: ${RECHECK_LIQ}"

if [ -n "$ABORT" ]; then
  echo "  [RESULT_ABORT_PHASE3] ${ABORT}" | tee -a "$LOG"
  audit_write "$EXEC_ID" "$MID" "$SLUG" "$SIDE" "$SIDE_PRICE" "$STAKE" "$DRY" "ABORTED_PHASE3"
  exit 1
fi
```

#### Checklist mandatória no browser

Execute cada item em ordem. Não avançar sem confirmar o anterior.

1. **[EXEC_NAVIGATE]** Abrir `https://polymarket.com/event/${SLUG}` via browser tool, profile `edge-user`.
2. **[EXEC_CONFIRM_SLUG]** Confirmar que `${SLUG}` aparece na URL ou título da página. Se não corresponder → abortar com `RESULT_ABORT_PHASE3`.
3. **[EXEC_LIVE_MARKET]** Se existir `Go to live market` → clicar imediatamente. Aguardar navegação completa.
4. **[EXEC_BROWSER_CLICK]** `SIDE=UP` → clicar em `UP` ou `Yes`. `SIDE=DOWN` → clicar em `DOWN` ou `No`. Confirmar visualmente que o botão correto foi ativado.
5. **[EXEC_STAKE_FILLED]** Preencher campo de valor com exatamente `$STAKE`. Confirmar que o campo exibe o valor correto.
6. **[EXEC_PRE_SUBMIT_CHECK]** Verificar resumo pré-confirmação: lado = `SIDE`, valor = `$STAKE`, mercado = `SLUG`. Só avançar se os três estiverem corretos.
7. **[EXEC_CONFIRM_ORDER]** Confirmar a ordem.
8. **[RESULT_ORDER_SUBMITTED]** Logar resultado observado na tela. Atualizar audit:
   ```bash
   audit_write "$EXEC_ID" "$MID" "$SLUG" "$SIDE" "$SIDE_PRICE" "$STAKE" "$DRY" "SUBMITTED"
   ```

---

## Troubleshooting

| Sintoma | Causa provável | Ação |
|---|---|---|
| `ERROR_JSON_INVALID` repetido | Node falhou ou `autoTrade.js` com erro | Ver `polymarket-indicator-errors.log` |
| `ERROR_CONFIG_INVALID` no boot | Env var inválida ou ausente | Verificar e exportar variáveis antes de rodar |
| `REJECT_OK_FALSE` constante | API fora ou sessão expirada | Verificar sessão no Edge manualmente |
| `REJECT_MID_EMPTY` | Indicador sem `marketId` | Checar saída bruta do indicador |
| Edge não responde | Remote debugging não iniciado | Executar `edge-debug` |
| `REJECT_ALREADY_TRADED` toda iteração | `DEDUPE` com ID do mercado atual | Ver `~/.polymarket-dedupe` |
| `WAIT_ENTRY_WINDOW` sem entrar | `timeLeftSec` nunca entre 30–55 | Aguardar próximo ciclo de mercado |
| `RESULT_DRY_RUN_SKIPPED` | `DRY_RUN` não exportado como `false` | `export DRY_RUN=false` |
| `ERROR_SESSION_TIMEOUT` | Loop rodou > 30 min | Normal; reiniciar manualmente |
| `ERROR_FAIL_LIMIT` | 20 falhas técnicas consecutivas | Verificar indicador e reiniciar |
| `RESULT_ABORT_PHASE3` | Condições mudaram entre loop e browser | Esperado; mercado marcado como `ABORTED_PHASE3` no audit |
| `RESULT_SIDE_DIVERGENCE` | Node e skill decidiram lados opostos | Informativo; skill prevalece |

---

## Regras absolutas

- JSON inválido → rejeitar iteração, logar `ERROR_JSON_INVALID`, incrementar `FAIL_COUNT`.
- `FAIL_COUNT ≥ 20` → encerrar com `ERROR_FAIL_LIMIT`.
- Sessão > 30 min → encerrar com `ERROR_SESSION_TIMEOUT`.
- `ok = false` → **rejeitar iteração** (não encerrar sessão).
- `marketId` vazio/null → `REJECT_MID_EMPTY`.
- `marketSlug` vazio/null → `REJECT_SLUG_EMPTY`.
- `timeLeftSec` não inteiro → `REJECT_TIME_INVALID`.
- `liquidity` inválida ou abaixo do mínimo → `REJECT_LOW_LIQUIDITY`.
- Campo numérico de sinal inválido → descartar sinal, `REJECT_SIGNAL_FIELD_INVALID`.
- `TOTAL_SIG < 3` → `REJECT_SIGNALS_INSUFFICIENT` — nunca operar.
- Nunca operar duas vezes no mesmo `marketId` (via `~/.polymarket-dedupe`).
- Nunca operar fora de `30s ≤ timeLeftSec ≤ 55s`.
- Nunca operar com preço fora de `0.80–MAX_ENTRY_PRICE`.
- `DRY_RUN=true` → logar `AUTH_TRADE_ALLOWED`, gravar audit como `SKIPPED_DRY_RUN`, **não gravar em dedupe**, não abrir browser.
- `DRY_RUN=false` → gravar `marketId` em dedupe, audit como `AUTHORIZED`, executar Fase 3.
- `action`, `side`, `browserTradeAllowed`, `filterReason`, `selectedPrice`, `phase`, `strength`, `edgeUp`, `edgeDown`, `modelUp`, `modelDown` → **nunca usar na decisão**.
- Divergência `NODE_SIDE` vs `SIDE` → logar `RESULT_SIDE_DIVERGENCE`, manter decisão da skill.
- `heiken` e `macd` em lowercase com trim antes de comparar.
- Trap SIGINT/SIGTERM → gravar em dedupe e audit como `INTERRUPTED_AFTER_AUTH` antes de sair.
- Logs rotatam ao atingir 5MB (principal e stderr do indicador).
- Fase 3: recheck completo de `timeLeftSec`, `marketId`, `marketSlug`, preço e liquidez antes de qualquer clique.
- Fase 3: checklist mandatória — cada item confirmado antes do próximo.
- Audit atualizado com status final (`SUBMITTED`, `ABORTED_PHASE3`) ao fim da Fase 3.
- Todos os eventos usam a taxonomia definida.

---

## Output obrigatório após trade

1. JSON bruto completo salvo no log junto com `AUTH_TRADE_ALLOWED`
2. `exec_id` da execução
3. `marketId` + `marketSlug`
4. Lado + preço + stake + sinais UP/DOWN de TOTAL/MIN
5. `DRY_RUN` status
6. Ações no browser com código `EXEC_*`
7. Resultado com código `RESULT_*`
8. Timestamp
9. Status final gravado em `~/.polymarket-audit.log`