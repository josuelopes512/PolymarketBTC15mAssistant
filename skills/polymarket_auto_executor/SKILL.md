---
name: polymarket-browser-trader
description: Monitora continuamente mercados Polymarket BTC Up/Down 5m e executa o trade automaticamente quando a janela de entrada for atingida, usando a sessão existente do Microsoft Edge do usuário.
version: 1.9.0
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

## Variáveis de ambiente

| Variável          | Padrão     | Descrição                                                        |
|-------------------|------------|------------------------------------------------------------------|
| `DRY_RUN`         | `true`     | Se `true`: loga decisão, não abre browser, não clica, não confirma |
| `STAKE_USD`       | `1`        | Valor fixo da ordem em dólares                                   |
| `MAX_ENTRY_PRICE` | `0.85`     | Compatibilidade com padrão real do `run-openclaw-trade.sh`       |
| `MIN_LIQUIDITY`   | `1000`     | Liquidez mínima exigida no JSON                                  |
| `EXECUTION_MODE`  | `openclaw` | Modo de execução do script Node                                  |

> `MAX_ENTRY_PRICE=0.85` é o padrão por compatibilidade com o script Node.
> É uma decisão de compatibilidade, não estratégica. Para ampliar, exportar explicitamente.
>
> `DRY_RUN=true` por padrão. Para operar de verdade, exportar `DRY_RUN=false` explicitamente.
> Com `DRY_RUN=true`: o loop loga `✅ TRADE AUTORIZADO`, grava no `TRADED`, mas
> **não abre o browser, não clica em nenhum lado, não preenche valor, não confirma ordem**.

```bash
export DRY_RUN=false
export STAKE_USD=1
export MAX_ENTRY_PRICE=0.85
export MIN_LIQUIDITY=1000
export EXECUTION_MODE=openclaw
```

---

## Taxonomia de eventos de log

Todos os eventos de log seguem esta taxonomia. Usar os códigos abaixo em cada mensagem.

| Prefixo       | Quando usar                                        |
|---------------|----------------------------------------------------|
| `ERROR_*`     | Falha técnica do sistema (JSON inválido, node falhou, Edge inacessível) |
| `REJECT_*`    | Mercado válido, mas não elegível pelos critérios   |
| `WAIT_*`      | Aguardando condição temporária (tempo, janela)     |
| `AUTH_*`      | Trade autorizado                                   |
| `EXEC_*`      | Ação executada no browser                          |
| `RESULT_*`    | Resultado final da execução                        |

Exemplos:
```
ERROR_JSON_INVALID
ERROR_INDICATOR_FAILED
REJECT_OK_FALSE
REJECT_MID_EMPTY
REJECT_LOW_LIQUIDITY
REJECT_TIME_WINDOW
REJECT_SIGNALS_INSUFFICIENT
REJECT_PRICE_OUT_OF_RANGE
REJECT_ALREADY_TRADED
WAIT_ENTRY_WINDOW
AUTH_TRADE_ALLOWED
EXEC_BROWSER_CLICK
EXEC_STAKE_FILLED
RESULT_ORDER_SUBMITTED
RESULT_DRY_RUN_SKIPPED
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

| Campo                 | O que significa                                                              |
|-----------------------|------------------------------------------------------------------------------|
| `browserTradeAllowed` | Critério interno do script: `action=ENTER` + preço 0.80–0.85 + `time ≤ 40` |
| `selectedPrice`       | `upPrice` ou `downPrice` conforme `side` interno; `null` se sem lado        |
| `fixedStakeUsd`       | Sempre `1` (hardcoded no script)                                             |
| `filterReason`        | Motivo de bloqueio interno do script                                         |

> ⚠️ A skill decide de forma **completamente independente**.
> `action`, `side`, `browserTradeAllowed`, `filterReason`, `selectedPrice`,
> `phase`, `strength`, `edgeUp`, `edgeDown`, `modelUp`, `modelDown`
> são **ignorados** pela lógica de decisão.
> Se `side` do Node divergir do `SIDE` da skill → logar divergência para debug, mas **não alterar a decisão**.

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

Todo campo numérico usado em comparação deve ser validado antes do uso.
Se um campo vier como `null`, string vazia, ou não numérico:
- **Sinais (taLongPct, taShortPct, rsi, upPrice, downPrice, currentPrice, priceToBeat):**
  o sinal correspondente é **desconsiderado** (não conta nem para UP nem para DOWN) e logado com `REJECT_SIGNAL_FIELD_NULL`.
- **Campos de controle (timeLeftSec, liquidity):**
  a **iteração inteira é rejeitada** com `REJECT_*` e motivo explícito.
- `heiken` vazio ou formato inesperado → sinal 2 desconsiderado, logado com `REJECT_SIGNAL_FIELD_NULL`.
- `macd` vazio ou formato inesperado → sinal 4 desconsiderado, logado com `REJECT_SIGNAL_FIELD_NULL`.

---

## Critérios de decisão (TODOS devem ser satisfeitos)

### 1. Validação de identidade
- `ok = true`
- JSON válido e parseable
- `marketId` não vazio, não `null`
- `marketSlug` não vazio, não `null`
- `marketId` não operado anteriormente (`TRADED`)

### 2. Campos de controle válidos
- `timeLeftSec` é número inteiro ≥ 0
- `liquidity` é número ≥ `MIN_LIQUIDITY`

### 3. Janela de tempo: `30 ≤ timeLeftSec ≤ 55`

### 4. Sinais técnicos — mínimo 4 de 5 para o mesmo lado

| # | Sinal | DOWN | UP | Se inválido |
|---|---|---|---|---|
| 1 | **TA Predict** | `taShortPct > 55` | `taLongPct > 55` | desconsiderar sinal |
| 2 | **Heiken Ashi** | começa com `"red"` (lowercase) | começa com `"green"` (lowercase) | desconsiderar sinal |
| 3 | **RSI** | `rsi < 45` | `rsi > 55` | desconsiderar sinal |
| 4 | **MACD** | começa com `"bearish"` (lowercase) | começa com `"bullish"` (lowercase) | desconsiderar sinal |
| 5 | **currentPrice vs priceToBeat** | `currentPrice < priceToBeat` | `currentPrice > priceToBeat` | desconsiderar sinal |

> Sinal 5 desconsiderado se `currentPrice` ou `priceToBeat` forem `null` → mínimo ajustado: **3 de 4**.
> Qualquer outro sinal desconsiderado por campo inválido → ajustar `TOTAL_SIG` e `MIN_SIG` proporcionalmente.

### 5. Preço: `0.80 ≤ sidePrice ≤ MAX_ENTRY_PRICE`
- DOWN → `downPrice`
- UP → `upPrice`

---

## Procedimento

### Fase 1 — Inicialização

```bash
export DRY_RUN=false
export STAKE_USD=1
export MAX_ENTRY_PRICE=0.85
export MIN_LIQUIDITY=1000
export EXECUTION_MODE=openclaw

TRADED="$HOME/.polymarket-traded-markets"
LOG="$HOME/polymarket-monitor.log"
INDICATOR_STDERR="$HOME/polymarket-indicator-errors.log"

touch "$TRADED"

# Rotacionar log principal se > 5MB
if [ -f "$LOG" ] && [ "$(stat -f%z "$LOG" 2>/dev/null || stat -c%s "$LOG")" -gt 5242880 ]; then
  mv "$LOG" "${LOG}.$(date '+%Y%m%d-%H%M%S').bak"
  touch "$LOG"
fi

# Garantir Edge via profile edge-user; se não responder: edge-debug
```

---

### Fase 2 — Executar o script de monitoramento

```bash
bash "$HOME/Sources/PolymarketBTC15mAssistant/scripts/run-monitoring-trade.sh"
```

> O `run-monitoring-trade.sh` deve implementar exatamente a mesma política do fallback inline abaixo.
> O fallback inline é a **referência canônica de comportamento**.
> Em caso de divergência, o fallback inline prevalece.
> Para garantir equivalência, recomenda-se comparar decisões entre os dois periodicamente.

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
TRADED="$HOME/.polymarket-traded-markets"
LOG="$HOME/polymarket-monitor.log"
INDICATOR_STDERR="$HOME/polymarket-indicator-errors.log"

# Limite de sessão: máximo 30 minutos ou 20 falhas técnicas consecutivas
SESSION_START=$(date +%s)
SESSION_MAX=1800
FAIL_COUNT=0
FAIL_MAX=20

touch "$TRADED"

# Trap SIGINT/SIGTERM — gravar marketId se interrompido após autorização
AUTHORIZED_MID=""
trap '
  if [ -n "$AUTHORIZED_MID" ]; then
    grep -qx "$AUTHORIZED_MID" "$TRADED" || echo "$AUTHORIZED_MID" >> "$TRADED"
    echo "[$(date "+%H:%M:%S")] [ERROR_INTERRUPTED] Interrompido após autorização de ${AUTHORIZED_MID}" | tee -a "$LOG"
  fi
  exit 1
' INT TERM

while true; do

  # ── Timeout de sessão ────────────────────────────────────────
  NOW=$(date +%s)
  ELAPSED=$(( NOW - SESSION_START ))
  if [ "$ELAPSED" -gt "$SESSION_MAX" ]; then
    echo "[$(date '+%H:%M:%S')] [ERROR_SESSION_TIMEOUT] Sessão encerrada após ${ELAPSED}s (máximo ${SESSION_MAX}s)." | tee -a "$LOG"
    exit 0
  fi

  # ── Consultar indicador (stderr separado) ────────────────────
  RAW=$(bash "$INDICATOR" 2>>"$INDICATOR_STDERR")
  EXIT_CODE=$?

  if [ $EXIT_CODE -ne 0 ]; then
    ((FAIL_COUNT++)) || true
    echo "[$(date '+%H:%M:%S')] [ERROR_INDICATOR_FAILED] exit_code=${EXIT_CODE} falhas=${FAIL_COUNT}/${FAIL_MAX}. Ver ${INDICATOR_STDERR}" | tee -a "$LOG"
    if [ "$FAIL_COUNT" -ge "$FAIL_MAX" ]; then
      echo "[$(date '+%H:%M:%S')] [ERROR_FAIL_LIMIT] Limite de falhas atingido. Encerrando." | tee -a "$LOG"
      exit 1
    fi
    sleep $POLL; continue
  fi

  # ── Validar JSON ─────────────────────────────────────────────
  if ! echo "$RAW" | jq . > /dev/null 2>&1; then
    ((FAIL_COUNT++)) || true
    echo "[$(date '+%H:%M:%S')] [ERROR_JSON_INVALID] falhas=${FAIL_COUNT}/${FAIL_MAX}." | tee -a "$LOG"
    if [ "$FAIL_COUNT" -ge "$FAIL_MAX" ]; then
      echo "[$(date '+%H:%M:%S')] [ERROR_FAIL_LIMIT] Limite de falhas atingido. Encerrando." | tee -a "$LOG"
      exit 1
    fi
    sleep $POLL; continue
  fi

  FAIL_COUNT=0  # reset em leitura válida

  # ── Extrair todos os campos em uma única chamada jq ──────────
  read -r OK TIME MID SLUG UP_P DOWN_P LIQ TA_LONG TA_SHORT HEIKEN RSI MACD CUR BEAT NODE_SIDE <<< "$(
    echo "$RAW" | jq -r '[
      .ok,
      (.timeLeftSec // "null"),
      (.marketId // ""),
      (.marketSlug // ""),
      (.upPrice // "null"),
      (.downPrice // "null"),
      (.liquidity // "null"),
      (.taLongPct // "null"),
      (.taShortPct // "null"),
      ((.heiken // "") | ascii_downcase | ltrimstr(" ") | rtrimstr(" ")),
      (.rsi // "null"),
      ((.macd // "") | ascii_downcase | ltrimstr(" ") | rtrimstr(" ")),
      (.currentPrice // "null"),
      (.priceToBeat // "null"),
      (.side // "null")
    ] | @tsv'
  )"

  # Gerar execution_id único para rastreabilidade
  EXEC_ID="$(date '+%Y%m%d%H%M%S')-${MID:-unknown}"

  echo "[$(date '+%H:%M:%S')] [exec=${EXEC_ID}] market=${MID} slug=${SLUG} timeLeft=${TIME}s UP=${UP_P} DOWN=${DOWN_P} liq=${LIQ} dry=${DRY}" | tee -a "$LOG"

  # ── 1. Validação de identidade ───────────────────────────────
  if [ "$OK" != "true" ]; then
    echo "  [REJECT_OK_FALSE] ok=false" | tee -a "$LOG"
    sleep $POLL; continue
  fi

  if [ -z "$MID" ] || [ "$MID" = "null" ]; then
    echo "  [REJECT_MID_EMPTY] marketId ausente ou null" | tee -a "$LOG"
    sleep $POLL; continue
  fi

  if [ -z "$SLUG" ] || [ "$SLUG" = "null" ]; then
    echo "  [REJECT_SLUG_EMPTY] marketSlug ausente ou null" | tee -a "$LOG"
    sleep $POLL; continue
  fi

  if grep -qx "$MID" "$TRADED" 2>/dev/null; then
    echo "  [REJECT_ALREADY_TRADED] marketId=${MID}" | tee -a "$LOG"
    sleep $POLL; continue
  fi

  # ── 2. Validar campos de controle ───────────────────────────
  if ! [[ "$TIME" =~ ^[0-9]+$ ]]; then
    echo "  [REJECT_TIME_INVALID] timeLeftSec='${TIME}'" | tee -a "$LOG"
    sleep $POLL; continue
  fi

  LIQ_OK=$(awk -v l="$LIQ" -v m="$MIN_LIQ" 'BEGIN{print (l!="null" && l+0>=m+0)?"1":"0"}')
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

  echo "  [WAIT_ENTRY_WINDOW] ⏱ JANELA ATINGIDA! Avaliando sinais..." | tee -a "$LOG"

  # ── 4. Avaliar sinais ────────────────────────────────────────
  UP_SIG=0; DOWN_SIG=0; TOTAL_SIG=0

  # Sinal 1: TA Predict
  if [ "$TA_SHORT" != "null" ] && [ "$TA_LONG" != "null" ]; then
    ((TOTAL_SIG++)) || true
    [ "$(awk -v v="$TA_SHORT" 'BEGIN{print (v+0>55)?"1":"0"}')" = "1" ] && ((DOWN_SIG++)) || true
    [ "$(awk -v v="$TA_LONG"  'BEGIN{print (v+0>55)?"1":"0"}')" = "1" ] && ((UP_SIG++))   || true
  else
    echo "  [REJECT_SIGNAL_FIELD_NULL] sinal 1 (TA Predict) desconsiderado: taLongPct=${TA_LONG} taShortPct=${TA_SHORT}" | tee -a "$LOG"
  fi

  # Sinal 2: Heiken Ashi
  if [ -n "$HEIKEN" ]; then
    ((TOTAL_SIG++)) || true
    [[ "$HEIKEN" == red*   ]] && ((DOWN_SIG++)) || true
    [[ "$HEIKEN" == green* ]] && ((UP_SIG++))   || true
  else
    echo "  [REJECT_SIGNAL_FIELD_NULL] sinal 2 (Heiken) desconsiderado: heiken='${HEIKEN}'" | tee -a "$LOG"
  fi

  # Sinal 3: RSI
  if [ "$RSI" != "null" ]; then
    ((TOTAL_SIG++)) || true
    [ "$(awk -v v="$RSI" 'BEGIN{print (v+0<45)?"1":"0"}')" = "1" ] && ((DOWN_SIG++)) || true
    [ "$(awk -v v="$RSI" 'BEGIN{print (v+0>55)?"1":"0"}')" = "1" ] && ((UP_SIG++))   || true
  else
    echo "  [REJECT_SIGNAL_FIELD_NULL] sinal 3 (RSI) desconsiderado: rsi=null" | tee -a "$LOG"
  fi

  # Sinal 4: MACD
  if [ -n "$MACD" ]; then
    ((TOTAL_SIG++)) || true
    [[ "$MACD" == bearish* ]] && ((DOWN_SIG++)) || true
    [[ "$MACD" == bullish* ]] && ((UP_SIG++))   || true
  else
    echo "  [REJECT_SIGNAL_FIELD_NULL] sinal 4 (MACD) desconsiderado: macd='${MACD}'" | tee -a "$LOG"
  fi

  # Sinal 5: currentPrice vs priceToBeat
  if [ "$CUR" != "null" ] && [ "$BEAT" != "null" ]; then
    ((TOTAL_SIG++)) || true
    [ "$(awk -v c="$CUR" -v b="$BEAT" 'BEGIN{print (c+0<b+0)?"1":"0"}')" = "1" ] && ((DOWN_SIG++)) || true
    [ "$(awk -v c="$CUR" -v b="$BEAT" 'BEGIN{print (c+0>b+0)?"1":"0"}')" = "1" ] && ((UP_SIG++))   || true
  else
    echo "  [REJECT_SIGNAL_FIELD_NULL] sinal 5 (price) desconsiderado: currentPrice=${CUR} priceToBeat=${BEAT}" | tee -a "$LOG"
  fi

  MIN_SIG=$(awk -v t="$TOTAL_SIG" 'BEGIN{print (t>=5)?4:(t>=4)?3:t}')
  echo "  sinais: UP=${UP_SIG} DOWN=${DOWN_SIG} | total disponível: ${TOTAL_SIG} | mínimo: ${MIN_SIG}" | tee -a "$LOG"

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

  # Logar divergência Node vs skill (sem alterar decisão)
  if [ "$NODE_SIDE" != "null" ] && [ "$NODE_SIDE" != "$SIDE" ]; then
    echo "  [DEBUG_SIDE_DIVERGENCE] Node diz side=${NODE_SIDE}, skill decidiu SIDE=${SIDE}" | tee -a "$LOG"
  fi

  # ── 5. Verificar faixa de preço ──────────────────────────────
  IN_RANGE=$(awk -v p="$SIDE_PRICE" -v mn="$PRICE_MIN" -v mx="$PRICE_MAX" \
    'BEGIN{print (p!="null" && p+0>=mn+0 && p+0<=mx+0)?"1":"0"}')
  if [ "$IN_RANGE" != "1" ]; then
    echo "  [REJECT_PRICE_OUT_OF_RANGE] ${SIDE} price=${SIDE_PRICE} fora [${PRICE_MIN}–${PRICE_MAX}]" | tee -a "$LOG"
    sleep $POLL; continue
  fi

  # ── TRADE AUTORIZADO ─────────────────────────────────────────
  AUTHORIZED_MID="$MID"

  {
    echo ""
    echo "  [AUTH_TRADE_ALLOWED]"
    echo "     exec_id:   ${EXEC_ID}"
    echo "     Lado:      ${SIDE}"
    echo "     Preço:     ${SIDE_PRICE}"
    echo "     Stake:     \$${STAKE}"
    echo "     marketId:  ${MID}"
    echo "     marketSlug:${SLUG}"
    echo "     Sinais:    UP=${UP_SIG} DOWN=${DOWN_SIG} de ${TOTAL_SIG} (mín=${MIN_SIG})"
    echo "     DRY_RUN:   ${DRY}"
    echo "     Timestamp: $(date '+%Y-%m-%d %H:%M:%S')"
    echo ""
  } | tee -a "$LOG"

  # Persistir trade com rastreabilidade completa
  echo "$(date '+%Y-%m-%d %H:%M:%S')|${EXEC_ID}|${MID}|${SLUG}|${SIDE}|${SIDE_PRICE}|${STAKE}|${DRY}" >> "$TRADED"
  AUTHORIZED_MID=""

  if [ "$DRY" = "true" ]; then
    echo "  [RESULT_DRY_RUN_SKIPPED] DRY_RUN=true — browser não aberto, ordem não enviada." | tee -a "$LOG"
    sleep $POLL; continue
  fi

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
RECHECK_LIQ=$(echo "$RECHECK_JSON"  | jq '.liquidity // 0')
RECHECK_UP=$(echo "$RECHECK_JSON"   | jq '.upPrice // 0')
RECHECK_DOWN=$(echo "$RECHECK_JSON" | jq '.downPrice // 0')

RECHECK_PRICE=$([ "$SIDE" = "UP" ] && echo "$RECHECK_UP" || echo "$RECHECK_DOWN")

ABORT=""
[ "$RECHECK_TIME" -lt 10 ]                           && ABORT="timeLeftSec=${RECHECK_TIME} < 10s"
[ "$RECHECK_MID" != "$MID" ]                          && ABORT="marketId mudou: esperado=${MID} atual=${RECHECK_MID}"
[ "$(awk -v p="$RECHECK_PRICE" -v mn="$PRICE_MIN" -v mx="$PRICE_MAX" \
  'BEGIN{print (p+0<mn+0||p+0>mx+0)?"1":"0"}')" = "1" ] && ABORT="preço fora da faixa: ${RECHECK_PRICE}"
[ "$(awk -v l="$RECHECK_LIQ" -v m="$MIN_LIQ" 'BEGIN{print (l+0<m+0)?"1":"0"}')" = "1" ] \
  && ABORT="liquidez insuficiente: ${RECHECK_LIQ}"

if [ -n "$ABORT" ]; then
  echo "  [RESULT_ABORT_PHASE3] ${ABORT}" | tee -a "$LOG"
  exit 1
fi
```

#### Checklist mandatória no browser

Execute cada item em ordem. Não avançar sem confirmar o anterior.

1. **[EXEC_NAVIGATE]** Abrir `https://polymarket.com/event/${SLUG}` via browser tool, profile `edge-user`.
2. **[EXEC_CONFIRM_SLUG]** Confirmar que `${SLUG}` aparece na URL ou no título da página antes de qualquer clique.
3. **[EXEC_LIVE_MARKET]** Se existir `Go to live market` → clicar imediatamente. Aguardar navegação completa.
4. **[EXEC_BROWSER_CLICK]** `SIDE=UP` → clicar em `UP` ou `Yes`. `SIDE=DOWN` → clicar em `DOWN` ou `No`. Confirmar visualmente que o botão correto foi ativado.
5. **[EXEC_STAKE_FILLED]** Preencher campo de valor com exatamente `$STAKE`. Confirmar que o campo mostra o valor correto.
6. **[EXEC_PRE_SUBMIT_CHECK]** Verificar resumo pré-confirmação: lado = `SIDE`, valor = `$STAKE`, mercado = `SLUG`. Só avançar se os três estiverem corretos.
7. **[EXEC_CONFIRM_ORDER]** Confirmar a ordem.
8. **[RESULT_ORDER_SUBMITTED]** Logar resultado observado na tela + screenshot se disponível.

---

## Troubleshooting

| Sintoma | Causa provável | Ação |
|---|---|---|
| `ERROR_JSON_INVALID` repetido | Node falhou ou `autoTrade.js` com erro | Ver `$HOME/polymarket-indicator-errors.log` |
| `REJECT_OK_FALSE` constante | API Polymarket fora ou sem autenticação | Verificar sessão no Edge manualmente |
| `REJECT_MID_EMPTY` | Indicador retornou sem `marketId` | Checar saída bruta do indicador |
| Edge não responde | Remote debugging não iniciado | Executar `edge-debug` no terminal |
| `REJECT_ALREADY_TRADED` toda iteração | `TRADED` com entrada do mesmo mercado | Ver `~/.polymarket-traded-markets` |
| `WAIT_ENTRY_WINDOW` sem entrar | `timeLeftSec` nunca atinge 30–55 | Mercado em fase errada; aguardar próximo ciclo |
| `RESULT_DRY_RUN_SKIPPED` | `DRY_RUN` não exportado como `false` | `export DRY_RUN=false` antes de rodar |
| `ERROR_SESSION_TIMEOUT` | Loop rodou por mais de 30 minutos | Normal; reiniciar manualmente se necessário |
| `ERROR_FAIL_LIMIT` | 20 falhas técnicas consecutivas | Verificar indicador e reiniciar |
| `RESULT_ABORT_PHASE3` | Condições mudaram entre loop e browser | Condição esperada; não é erro crítico |

---

## Regras absolutas

- `ok = false` → **rejeitar a iteração** (não abortar a sessão).
- JSON inválido → rejeitar iteração, logar `ERROR_JSON_INVALID`, incrementar `FAIL_COUNT`.
- `FAIL_COUNT ≥ 20` → encerrar sessão com `ERROR_FAIL_LIMIT`.
- Sessão > 30 minutos → encerrar com `ERROR_SESSION_TIMEOUT`.
- `marketId` vazio ou null → rejeitar iteração com `REJECT_MID_EMPTY`.
- `marketSlug` vazio ou null → rejeitar iteração com `REJECT_SLUG_EMPTY`.
- `timeLeftSec` não inteiro → rejeitar iteração com `REJECT_TIME_INVALID`.
- `liquidity < MIN_LIQUIDITY` → rejeitar com `REJECT_LOW_LIQUIDITY`.
- Campo numérico de sinal inválido → desconsiderar **apenas aquele sinal**, logar `REJECT_SIGNAL_FIELD_NULL`, ajustar `TOTAL_SIG`.
- Nunca operar duas vezes no mesmo `marketId`.
- Nunca operar fora da janela `30s ≤ timeLeftSec ≤ 55s`.
- Nunca operar com preço fora de `0.80–MAX_ENTRY_PRICE`.
- `DRY_RUN=true` → logar `AUTH_TRADE_ALLOWED`, gravar em `TRADED`, **não abrir browser, não clicar, não preencher stake, não confirmar ordem**.
- `action`, `side`, `browserTradeAllowed`, `filterReason`, `selectedPrice`, `phase`, `strength`, `edgeUp`, `edgeDown`, `modelUp`, `modelDown` → **nunca usar na decisão**.
- Divergência `NODE_SIDE` vs `SIDE` → logar `DEBUG_SIDE_DIVERGENCE`, não alterar decisão.
- `heiken` e `macd` sempre em lowercase com trim antes de comparar.
- `heiken` ou `macd` vazios → desconsiderar sinal correspondente.
- SIGINT/SIGTERM durante trade autorizado → gravar `marketId` em `TRADED` via trap antes de sair.
- Log rotaciona automaticamente ao atingir 5MB.
- Fase 3 exige recheck completo: `timeLeftSec`, `marketId`, preço e liquidez antes de qualquer clique.
- Checklist da Fase 3 é mandatória — cada item deve ser confirmado antes do próximo.
- Login pedido pelo browser → parar e pedir ao usuário.
- Edge inacessível → tentar `edge-debug` antes de falhar.
- Todos os eventos de log devem usar a taxonomia `ERROR_*`/`REJECT_*`/`WAIT_*`/`AUTH_*`/`EXEC_*`/`RESULT_*`.

---

## Output obrigatório após trade

1. JSON bruto completo no momento do trade
2. `exec_id` da execução
3. `marketId` + `marketSlug` destacados
4. Lado + preço + stake + sinais UP/DOWN de TOTAL
5. `DRY_RUN` status
6. Ações realizadas no browser com códigos `EXEC_*`
7. Resultado observado na tela com código `RESULT_*`
8. Timestamp da execução