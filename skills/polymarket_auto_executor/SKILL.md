---
name: polymarket-browser-trader
description: Monitora continuamente mercados Polymarket BTC Up/Down 5m e executa o trade automaticamente quando a janela de entrada for atingida, usando a sessão existente do Microsoft Edge do usuário.
version: 1.8.0
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

| Variável          | Padrão     | Descrição                                          |
|-------------------|------------|----------------------------------------------------|
| `DRY_RUN`         | `true`     | Se `true`, loga decisão mas NÃO confirma no browser |
| `STAKE_USD`       | `1`        | Valor fixo da ordem em dólares                     |
| `MAX_ENTRY_PRICE` | `0.85`     | Preço máximo permitido (padrão real do script Node)|
| `MIN_LIQUIDITY`   | `1000`     | Liquidez mínima exigida                            |
| `EXECUTION_MODE`  | `openclaw` | Modo de execução do script Node                    |

> ⚠️ `MAX_ENTRY_PRICE` padrão é `0.85` — mesmo valor do `run-openclaw-trade.sh`.
> Para ampliar para `0.88`, exportar explicitamente antes de chamar.

```bash
export DRY_RUN=false
export STAKE_USD=1
export MAX_ENTRY_PRICE=0.85
export MIN_LIQUIDITY=1000
export EXECUTION_MODE=openclaw
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

| Campo                 | O que significa                                                            |
|-----------------------|----------------------------------------------------------------------------|
| `browserTradeAllowed` | Critério interno do script: `action=ENTER` + preço 0.80–0.85 + `time ≤ 40` |
| `selectedPrice`       | `upPrice` ou `downPrice` conforme `side` interno                           |
| `fixedStakeUsd`       | Sempre `1` (hardcoded no script)                                           |
| `filterReason`        | Motivo de bloqueio interno do script                                       |

> ⚠️ A skill decide de forma independente.
> Os campos `action`, `side`, `browserTradeAllowed`, `filterReason`, `selectedPrice`,
> `phase`, `strength`, `edgeUp`, `edgeDown`, `modelUp`, `modelDown`
> são **completamente ignorados** pela lógica de decisão.

---

## Campos utilizados pela skill

```
ok, marketId, marketSlug, timeLeftSec,
upPrice, downPrice, liquidity,
taLongPct, taShortPct,
heiken, rsi, macd,
currentPrice, priceToBeat
```

---

## Critérios de decisão (TODOS devem ser satisfeitos)

### 1. Validação básica
- `ok = true`
- JSON válido e parseable
- `marketId` não operado anteriormente
- `timeLeftSec` é número inteiro ≥ 0
- `heiken` em lowercase para comparação

### 2. Liquidez: `liquidity ≥ MIN_LIQUIDITY`

### 3. Janela de tempo: `30 ≤ timeLeftSec ≤ 55`

### 4. Sinais técnicos — mínimo 4 de 5 para o mesmo lado

| # | Sinal | DOWN | UP |
|---|---|---|---|
| 1 | **TA Predict** | `taShortPct > 55` | `taLongPct > 55` |
| 2 | **Heiken Ashi** | começa com `"red"` (case-insensitive) | começa com `"green"` (case-insensitive) |
| 3 | **RSI** | `rsi < 45` | `rsi > 55` |
| 4 | **MACD** | começa com `"bearish"` (case-insensitive) | começa com `"bullish"` (case-insensitive) |
| 5 | **currentPrice vs priceToBeat** | `currentPrice < priceToBeat` | `currentPrice > priceToBeat` |

> Se `currentPrice` ou `priceToBeat` forem `null` → sinal 5 desconsiderado.
> Mínimo ajustado: **3 de 4**.

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

touch "$TRADED"

# Rotacionar log se > 5MB
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

O script chama internamente `run-openclaw-trade.sh` a cada 3 segundos, aplica os critérios
da skill e aguarda a janela de entrada. Quando autorizado, imprime `✅ TRADE AUTORIZADO` e encerra.

> O comportamento do `run-monitoring-trade.sh` deve ser equivalente ao fallback inline abaixo.
> Se divergirem, o fallback inline é a referência canônica.

---

### Fase 2 (fallback inline) — caso `run-monitoring-trade.sh` não esteja disponível

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

touch "$TRADED"

# Handler para SIGINT/SIGTERM — garante que marketId seja gravado se trade foi autorizado
AUTHORIZED_MID=""
trap '
  if [ -n "$AUTHORIZED_MID" ]; then
    grep -qx "$AUTHORIZED_MID" "$TRADED" || echo "$AUTHORIZED_MID" >> "$TRADED"
    echo "[$(date "+%H:%M:%S")] ⚠ Interrompido após autorização de ${AUTHORIZED_MID}" | tee -a "$LOG"
  fi
  exit 1
' INT TERM

while true; do

  # ── Consultar indicador (stderr separado) ────────────────────
  RAW=$(bash "$INDICATOR" 2>>"$INDICATOR_STDERR")

  # ── Validar JSON em uma passagem só ─────────────────────────
  if ! echo "$RAW" | jq . > /dev/null 2>&1; then
    echo "[$(date '+%H:%M:%S')] → JSON inválido ou indicador falhou. Ver ${INDICATOR_STDERR}" | tee -a "$LOG"
    sleep $POLL; continue
  fi

  # ── Extrair todos os campos em uma única chamada jq ──────────
  read -r OK TIME MID SLUG UP_P DOWN_P LIQ TA_LONG TA_SHORT HEIKEN RSI MACD CUR BEAT <<< "$(
    echo "$RAW" | jq -r '[
      .ok,
      (.timeLeftSec // "null"),
      .marketId,
      .marketSlug,
      (.upPrice // "null"),
      (.downPrice // "null"),
      (.liquidity // "null"),
      (.taLongPct // "null"),
      (.taShortPct // "null"),
      ((.heiken // "") | ascii_downcase),
      (.rsi // "null"),
      ((.macd // "") | ascii_downcase),
      (.currentPrice // "null"),
      (.priceToBeat // "null")
    ] | @tsv'
  )"

  echo "[$(date '+%H:%M:%S')] market=${MID} | timeLeft=${TIME}s | UP=${UP_P} DOWN=${DOWN_P} | liq=${LIQ} | dry=${DRY}" | tee -a "$LOG"

  # ── Validação básica ─────────────────────────────────────────
  if [ "$OK" != "true" ]; then
    echo "  → REJEITADO: ok=false" | tee -a "$LOG"
    sleep $POLL; continue
  fi

  if grep -qx "$MID" "$TRADED" 2>/dev/null; then
    echo "  → REJEITADO: mercado já operado (${MID})" | tee -a "$LOG"
    sleep $POLL; continue
  fi

  if ! [[ "$TIME" =~ ^[0-9]+$ ]]; then
    echo "  → REJEITADO: timeLeftSec inválido (${TIME})" | tee -a "$LOG"
    sleep $POLL; continue
  fi

  # ── Validar liquidez ─────────────────────────────────────────
  LIQ_OK=$(awk -v l="$LIQ" -v m="$MIN_LIQ" 'BEGIN { print (l != "null" && l+0 >= m+0) ? "1" : "0" }')
  if [ "$LIQ_OK" != "1" ]; then
    echo "  → REJEITADO: liquidez ${LIQ} < mínimo ${MIN_LIQ}" | tee -a "$LOG"
    sleep $POLL; continue
  fi

  # ── Controle de tempo ────────────────────────────────────────
  if [ "$TIME" -gt "$ENTRY_MAX" ]; then
    WAIT=$(( TIME - ENTRY_MAX ))
    echo "  → aguardando ${WAIT}s para janela de entrada..." | tee -a "$LOG"
    sleep $POLL; continue
  fi

  if [ "$TIME" -lt "$ENTRY_MIN" ]; then
    echo "  → REJEITADO: janela expirada (${TIME}s < ${ENTRY_MIN}s). Próximo mercado." | tee -a "$LOG"
    sleep $POLL; continue
  fi

  echo "  → ⏱ JANELA ATINGIDA! Avaliando sinais..." | tee -a "$LOG"

  # ── Avaliar sinais (awk para comparações float, sem bc) ──────
  UP_SIG=0; DOWN_SIG=0; TOTAL_SIG=5

  # 1. TA Predict
  [ "$(awk -v v="$TA_SHORT" 'BEGIN{print (v!="null" && v+0>55)?"1":"0"}')" = "1" ] && ((DOWN_SIG++)) || true
  [ "$(awk -v v="$TA_LONG"  'BEGIN{print (v!="null" && v+0>55)?"1":"0"}')" = "1" ] && ((UP_SIG++))   || true

  # 2. Heiken Ashi (já em lowercase pelo jq)
  [[ "$HEIKEN" == red*   ]] && ((DOWN_SIG++)) || true
  [[ "$HEIKEN" == green* ]] && ((UP_SIG++))   || true

  # 3. RSI
  [ "$(awk -v v="$RSI" 'BEGIN{print (v!="null" && v+0<45)?"1":"0"}')" = "1" ] && ((DOWN_SIG++)) || true
  [ "$(awk -v v="$RSI" 'BEGIN{print (v!="null" && v+0>55)?"1":"0"}')" = "1" ] && ((UP_SIG++))   || true

  # 4. MACD (já em lowercase pelo jq)
  [[ "$MACD" == bearish* ]] && ((DOWN_SIG++)) || true
  [[ "$MACD" == bullish* ]] && ((UP_SIG++))   || true

  # 5. currentPrice vs priceToBeat
  if [ "$CUR" = "null" ] || [ "$BEAT" = "null" ]; then
    echo "  → sinal 5 indisponível (null). Mínimo ajustado: 3/4" | tee -a "$LOG"
    TOTAL_SIG=4
  else
    [ "$(awk -v c="$CUR" -v b="$BEAT" 'BEGIN{print (c+0<b+0)?"1":"0"}')" = "1" ] && ((DOWN_SIG++)) || true
    [ "$(awk -v c="$CUR" -v b="$BEAT" 'BEGIN{print (c+0>b+0)?"1":"0"}')" = "1" ] && ((UP_SIG++))   || true
  fi

  MIN_SIG=$([ "$TOTAL_SIG" = "5" ] && echo 4 || echo 3)
  echo "  → sinais: UP=${UP_SIG} DOWN=${DOWN_SIG} | mínimo: ${MIN_SIG}/${TOTAL_SIG}" | tee -a "$LOG"

  # ── Decidir lado ─────────────────────────────────────────────
  SIDE=""; SIDE_PRICE=""

  if [ "$DOWN_SIG" -ge "$MIN_SIG" ] && [ "$DOWN_SIG" -gt "$UP_SIG" ]; then
    SIDE="DOWN"; SIDE_PRICE="$DOWN_P"
  elif [ "$UP_SIG" -ge "$MIN_SIG" ] && [ "$UP_SIG" -gt "$DOWN_SIG" ]; then
    SIDE="UP"; SIDE_PRICE="$UP_P"
  fi

  if [ -z "$SIDE" ]; then
    echo "  → REJEITADO: sinais insuficientes ou empatados (UP=${UP_SIG} DOWN=${DOWN_SIG})" | tee -a "$LOG"
    sleep $POLL; continue
  fi

  # ── Verificar faixa de preço ─────────────────────────────────
  IN_RANGE=$(awk -v p="$SIDE_PRICE" -v mn="$PRICE_MIN" -v mx="$PRICE_MAX" \
    'BEGIN{print (p!="null" && p+0>=mn+0 && p+0<=mx+0)?"1":"0"}')
  if [ "$IN_RANGE" != "1" ]; then
    echo "  → REJEITADO: preço ${SIDE_PRICE} fora da faixa [${PRICE_MIN}–${PRICE_MAX}]" | tee -a "$LOG"
    sleep $POLL; continue
  fi

  # ── TRADE AUTORIZADO ─────────────────────────────────────────
  AUTHORIZED_MID="$MID"

  echo "" | tee -a "$LOG"
  echo "  ✅ TRADE AUTORIZADO" | tee -a "$LOG"
  echo "     Lado:      ${SIDE}" | tee -a "$LOG"
  echo "     Preço:     ${SIDE_PRICE}" | tee -a "$LOG"
  echo "     Stake:     \$${STAKE}" | tee -a "$LOG"
  echo "     Mercado:   ${MID} (${SLUG})" | tee -a "$LOG"
  echo "     Sinais:    UP=${UP_SIG} DOWN=${DOWN_SIG} de ${TOTAL_SIG}" | tee -a "$LOG"
  echo "     DRY_RUN:   ${DRY}" | tee -a "$LOG"
  echo "     Timestamp: $(date '+%Y-%m-%d %H:%M:%S')" | tee -a "$LOG"
  echo "" | tee -a "$LOG"

  echo "$MID" >> "$TRADED"
  AUTHORIZED_MID=""  # gravado com sucesso, limpar trap

  if [ "$DRY" = "true" ]; then
    echo "  🔵 DRY_RUN=true — decisão logada, ordem NÃO enviada ao browser." | tee -a "$LOG"
    sleep $POLL; continue  # continua monitorando sem executar
  fi

  break  # vai para Fase 3

done
```

---

### Fase 3 — Execução no browser (apenas se `DRY_RUN=false`)

> Antes de qualquer clique: consultar o indicador novamente e confirmar `timeLeftSec ≥ 10`.
> Se `< 10s` → abortar, logar `"Fase 3 abortada: tempo insuficiente"` e não clicar.

```bash
# Verificação de segurança pré-browser
RECHECK=$(bash "$INDICATOR" 2>/dev/null | jq '.timeLeftSec // 0')
if [ "$RECHECK" -lt 10 ]; then
  echo "  ⛔ Fase 3 ABORTADA: timeLeftSec=${RECHECK} < 10s" | tee -a "$LOG"
  exit 1
fi
```

Passos no browser:
1. Abrir `https://polymarket.com/event/${SLUG}` via browser tool, profile `edge-user`.
2. Se existir `Go to live market` → clicar imediatamente.
3. Aguardar navegação e confirmar que o mercado está ativo.
4. `SIDE = "UP"` → clicar em `UP` ou `Yes`.
5. `SIDE = "DOWN"` → clicar em `DOWN` ou `No`.
6. Preencher valor com **`$STAKE`**.
7. Revisar: lado correto, valor correto, mercado correto.
8. Confirmar a ordem.

---

## Troubleshooting

| Sintoma | Causa provável | Ação |
|---|---|---|
| `JSON inválido` repetido | Node falhou ou `autoTrade.js` com erro | Ver `$HOME/polymarket-indicator-errors.log` |
| `ok=false` constante | API Polymarket fora ou sem autenticação | Verificar sessão no Edge manualmente |
| Edge não responde | Remote debugging não iniciado | Executar `edge-debug` no terminal |
| `mercado já operado` toda iteração | `TRADED` com ID antigo | Verificar `~/.polymarket-traded-markets` |
| Loop nunca entra na janela | `timeLeftSec` sempre acima de 55 | Mercado pode estar em fase errada; aguardar próximo ciclo |
| `DRY_RUN=true` e nada executa | Variável não foi exportada como `false` | `export DRY_RUN=false` antes de rodar |
| Log > 5MB | Sessão longa sem rotação | Rotação automática na Fase 1 já trata isso |

---

## Regras absolutas

- `ok = false` → abortar imediatamente.
- JSON inválido → aguardar, logar stderr em `polymarket-indicator-errors.log`.
- `timeLeftSec` não inteiro → rejeitar com motivo.
- `liquidity < MIN_LIQUIDITY` → rejeitar com motivo.
- `currentPrice` ou `priceToBeat` null → desconsiderar sinal 5, exigir 3/4.
- Nunca operar duas vezes no mesmo `marketId`.
- Nunca operar fora da janela `30s ≤ timeLeftSec ≤ 55s`.
- Nunca operar com preço fora de `0.80–MAX_ENTRY_PRICE`.
- `DRY_RUN=true` → logar `✅ TRADE AUTORIZADO` mas **não abrir browser, não confirmar ordem**.
- `browserTradeAllowed`, `action`, `side`, `filterReason`, `selectedPrice`, `phase`, `strength`, `edgeUp`, `edgeDown`, `modelUp`, `modelDown` → **nunca usar na decisão**.
- `heiken` e `macd` sempre comparados em lowercase.
- SIGINT/SIGTERM durante trade autorizado → gravar `marketId` antes de sair.
- Log rotaciona automaticamente ao atingir 5MB.
- Fase 3 requer recheck de `timeLeftSec ≥ 10s` antes de qualquer clique.
- Login pedido pelo browser → parar e pedir ao usuário.
- Edge inacessível → tentar `edge-debug` antes de falhar.

---

## Output obrigatório após trade

1. JSON bruto completo no momento do trade
2. Lado + preço + stake + sinais UP/DOWN de TOTAL
3. `DRY_RUN` status
4. Ações realizadas no browser (cliques, valores preenchidos)
5. Resultado observado na tela
6. Timestamp da execução