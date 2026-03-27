---
name: polymarket-browser-trader
description: Monitora continuamente mercados Polymarket BTC Up/Down 5m e executa o trade automaticamente quando a janela de entrada for atingida, usando a sessão existente do Microsoft Edge do usuário.
version: 1.7.0
metadata:
  openclaw:
    requires:
      bins:
        - bash
        - bc
        - jq
        - node
      env:
        - DRY_RUN
        - STAKE_USD
        - MAX_ENTRY_PRICE
        - MIN_LIQUIDITY
        - EXECUTION_MODE
---

## Variáveis de ambiente

| Variável          | Padrão       | Descrição                                              |
|-------------------|--------------|--------------------------------------------------------|
| `DRY_RUN`         | `true`       | Se `true`, simula sem executar ordem real              |
| `STAKE_USD`       | `1`          | Valor fixo da ordem em dólares                         |
| `MAX_ENTRY_PRICE` | `0.85`       | Preço máximo permitido para entrar                     |
| `MIN_LIQUIDITY`   | `1000`       | Liquidez mínima exigida (lida pelo script Node)        |
| `EXECUTION_MODE`  | `openclaw`   | Modo de execução do script Node                        |

> Exportar antes de chamar o script:
> ```bash
> export DRY_RUN=false
> export STAKE_USD=1
> export MAX_ENTRY_PRICE=0.88
> export MIN_LIQUIDITY=1000
> export EXECUTION_MODE=openclaw
> ```

---

## JSON real retornado por `run-openclaw-trade.sh`

O script executa `node src/autoTrade.js --mode openclaw` e enriquece o JSON com campos calculados.
O output completo tem esta estrutura:

```json
{
  "ok":                 true,
  "marketId":           "1734030",
  "marketSlug":         "btc-updown-5m-1774638300",
  "timeLeftSec":        43,
  "currentPrice":       65753.62,
  "priceToBeat":        65787.00,
  "upPrice":            0.12,
  "downPrice":          0.87,
  "taLongPct":          48,
  "taShortPct":         52,
  "heiken":             "red x3",
  "rsi":                40.8,
  "macd":               "bearish (expanding)",
  "action":             "NO_TRADE",
  "side":               null,
  "phase":              "LATE",
  "strength":           null,
  "edgeUp":             0.36,
  "edgeDown":          -0.36,
  "modelUp":            0.48,
  "modelDown":          0.51,
  "liquidity":          24940.46,
  "selectedPrice":      null,
  "fixedStakeUsd":      1,
  "browserTradeAllowed": false,
  "filterReason":       "action_not_enter"
}
```

### Campos computados pelo script (NÃO usados pela skill para decidir)

| Campo                 | Descrição                                                                 |
|-----------------------|---------------------------------------------------------------------------|
| `browserTradeAllowed` | `true` apenas se `action=ENTER`, preço 0.80–0.85, `timeLeftSec ≤ 40`    |
| `selectedPrice`       | `upPrice` ou `downPrice` conforme `side`; `null` se `side=null`          |
| `fixedStakeUsd`       | Sempre `1` (hardcoded no script)                                          |
| `filterReason`        | Motivo do bloqueio interno do script (`action_not_enter`, `price_outside_range_0.80_0.85`, etc.) |

> ⚠️ A skill usa **seus próprios critérios** para decidir operar.
> `browserTradeAllowed`, `action`, `side`, `filterReason`, `selectedPrice`,
> `phase`, `strength`, `edgeUp`, `edgeDown`, `modelUp`, `modelDown`, `liquidity`
> são **completamente ignorados** pela lógica de decisão da skill.

---

## Campos utilizados pela skill na decisão

```
ok, marketId, marketSlug, timeLeftSec,
upPrice, downPrice,
taLongPct, taShortPct,
heiken, rsi, macd,
currentPrice, priceToBeat
```

---

## Critérios de decisão da skill (TODOS devem ser satisfeitos)

### 1. Validação básica
- `ok = true`
- `marketId` não foi operado anteriormente
- JSON válido (não vazio, parseable)
- `timeLeftSec` é número inteiro válido

### 2. Janela de tempo: `30 ≤ timeLeftSec ≤ 55`

### 3. Sinais técnicos — mínimo 4 de 5 apontando para o mesmo lado

| Sinal | DOWN | UP |
|---|---|---|
| **TA Predict** | `taShortPct > 55` | `taLongPct > 55` |
| **Heiken Ashi** | `heiken` começa com `"red"` | `heiken` começa com `"green"` |
| **RSI** | `rsi < 45` | `rsi > 55` |
| **MACD** | `macd` começa com `"bearish"` | `macd` começa com `"bullish"` |
| **currentPrice vs priceToBeat** | `currentPrice < priceToBeat` | `currentPrice > priceToBeat` |

> Se `currentPrice` ou `priceToBeat` forem `null` → sinal 5 desconsiderado.
> Mínimo ajustado: **3 de 4**.

### 4. Preço do lado escolhido entre `0.80` e `$MAX_ENTRY_PRICE` (padrão 0.88)
- Lado DOWN → verificar `downPrice`
- Lado UP → verificar `upPrice`

### 5. Liquidez: `liquidity ≥ $MIN_LIQUIDITY`
- Ler `liquidity` do JSON e rejeitar se abaixo do mínimo configurado.

---

## Procedimento

### Fase 1 — Inicialização

```bash
export DRY_RUN=false
export STAKE_USD=1
export MAX_ENTRY_PRICE=0.88
export MIN_LIQUIDITY=1000
export EXECUTION_MODE=openclaw

touch "$HOME/.polymarket-traded-markets"
# Garantir Edge via profile edge-user; se não responder: edge-debug
```

---

### Fase 2 — Executar o script de monitoramento

```bash
bash "$HOME/Sources/PolymarketBTC15mAssistant/scripts/run-monitoring-trade.sh"
```

O script `run-monitoring-trade.sh` chama internamente `run-openclaw-trade.sh` a cada 3 segundos,
lê o JSON retornado, aplica os critérios da skill e aguarda a janela de entrada.

Quando todos os critérios forem satisfeitos, imprimirá `✅ TRADE AUTORIZADO` e encerrará o loop.

---

### Fase 2 (fallback inline) — caso `run-monitoring-trade.sh` não esteja disponível

```bash
INDICATOR="$HOME/Sources/PolymarketBTC15mAssistant/scripts/run-openclaw-trade.sh"
POLL=3
ENTRY_MIN=30
ENTRY_MAX=55
PRICE_MIN=0.80
PRICE_MAX="${MAX_ENTRY_PRICE:-0.88}"
MIN_LIQ="${MIN_LIQUIDITY:-1000}"
STAKE="${STAKE_USD:-1}"
TRADED="$HOME/.polymarket-traded-markets"
LOG="$HOME/polymarket-monitor.log"

touch "$TRADED"

while true; do

  # ── Consultar indicador ──────────────────────────────────────
  RAW=$(bash "$INDICATOR" 2>/dev/null)

  # ── Validar JSON ─────────────────────────────────────────────
  if ! echo "$RAW" | jq . > /dev/null 2>&1; then
    echo "[$(date '+%H:%M:%S')] → JSON inválido ou indicador falhou. Aguardando..." | tee -a "$LOG"
    sleep $POLL; continue
  fi

  # ── Extrair campos utilizados ─────────────────────────────────
  OK=$(echo "$RAW"       | jq -r '.ok')
  TIME=$(echo "$RAW"     | jq    '.timeLeftSec')
  MID=$(echo "$RAW"      | jq -r '.marketId')
  SLUG=$(echo "$RAW"     | jq -r '.marketSlug')
  UP_P=$(echo "$RAW"     | jq    '.upPrice')
  DOWN_P=$(echo "$RAW"   | jq    '.downPrice')
  LIQ=$(echo "$RAW"      | jq    '.liquidity')
  TA_LONG=$(echo "$RAW"  | jq    '.taLongPct')
  TA_SHORT=$(echo "$RAW" | jq    '.taShortPct')
  HEIKEN=$(echo "$RAW"   | jq -r '.heiken')
  RSI=$(echo "$RAW"      | jq    '.rsi')
  MACD=$(echo "$RAW"     | jq -r '.macd')
  CUR=$(echo "$RAW"      | jq    '.currentPrice')
  BEAT=$(echo "$RAW"     | jq    '.priceToBeat')

  echo "[$(date '+%H:%M:%S')] market=${MID} | timeLeft=${TIME}s | UP=${UP_P} DOWN=${DOWN_P} | liq=${LIQ}" | tee -a "$LOG"

  # ── Validação básica ─────────────────────────────────────────
  if [ "$OK" != "true" ]; then
    echo "  → REJEITADO: ok=false" | tee -a "$LOG"
    sleep $POLL; continue
  fi

  if grep -qx "$MID" "$TRADED" 2>/dev/null; then
    echo "  → REJEITADO: mercado já operado (${MID})" | tee -a "$LOG"
    sleep $POLL; continue
  fi

  # ── Validar timeLeftSec é número ─────────────────────────────
  if ! [[ "$TIME" =~ ^[0-9]+$ ]]; then
    echo "  → REJEITADO: timeLeftSec inválido (${TIME})" | tee -a "$LOG"
    sleep $POLL; continue
  fi

  # ── Validar liquidez ─────────────────────────────────────────
  LIQ_OK=$(echo "$LIQ >= $MIN_LIQ" | bc -l)
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

  # ── Avaliar sinais ───────────────────────────────────────────
  UP_SIG=0; DOWN_SIG=0; TOTAL_SIG=5

  [ "$(echo "$TA_SHORT > 55" | bc -l)" = "1" ] && ((DOWN_SIG++)) || true
  [ "$(echo "$TA_LONG  > 55" | bc -l)" = "1" ] && ((UP_SIG++))   || true

  [[ "$HEIKEN" == red*   ]] && ((DOWN_SIG++)) || true
  [[ "$HEIKEN" == green* ]] && ((UP_SIG++))   || true

  [ "$(echo "$RSI < 45" | bc -l)" = "1" ] && ((DOWN_SIG++)) || true
  [ "$(echo "$RSI > 55" | bc -l)" = "1" ] && ((UP_SIG++))   || true

  [[ "$MACD" == bearish* ]] && ((DOWN_SIG++)) || true
  [[ "$MACD" == bullish* ]] && ((UP_SIG++))   || true

  if [ "$CUR" = "null" ] || [ "$BEAT" = "null" ]; then
    echo "  → sinal 5 indisponível (null). Mínimo ajustado: 3/4" | tee -a "$LOG"
    TOTAL_SIG=4
  else
    [ "$(echo "$CUR < $BEAT" | bc -l)" = "1" ] && ((DOWN_SIG++)) || true
    [ "$(echo "$CUR > $BEAT" | bc -l)" = "1" ] && ((UP_SIG++))   || true
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
  IN_RANGE=$(echo "$SIDE_PRICE >= $PRICE_MIN && $SIDE_PRICE <= $PRICE_MAX" | bc -l)
  if [ "$IN_RANGE" != "1" ]; then
    echo "  → REJEITADO: preço ${SIDE_PRICE} fora da faixa [${PRICE_MIN}–${PRICE_MAX}]" | tee -a "$LOG"
    sleep $POLL; continue
  fi

  # ── TRADE AUTORIZADO ─────────────────────────────────────────
  echo "" | tee -a "$LOG"
  echo "  ✅ TRADE AUTORIZADO" | tee -a "$LOG"
  echo "     Lado:      ${SIDE}" | tee -a "$LOG"
  echo "     Preço:     ${SIDE_PRICE}" | tee -a "$LOG"
  echo "     Stake:     \$${STAKE}" | tee -a "$LOG"
  echo "     Mercado:   ${MID} (${SLUG})" | tee -a "$LOG"
  echo "     Sinais:    UP=${UP_SIG} DOWN=${DOWN_SIG} de ${TOTAL_SIG}" | tee -a "$LOG"
  echo "     Timestamp: $(date '+%Y-%m-%d %H:%M:%S')" | tee -a "$LOG"
  echo "" | tee -a "$LOG"

  echo "$MID" >> "$TRADED"
  break

done
```

---

### Fase 3 — Execução no browser (após TRADE AUTORIZADO)

> Verificar `timeLeftSec` novamente antes de clicar. Se `< 10s`, abortar.

1. Abrir `https://polymarket.com/event/${SLUG}` via browser tool, profile `edge-user`.
2. Se existir `Go to live market` → clicar imediatamente.
3. Aguardar navegação para o mercado ativo.
4. `SIDE = "UP"` → clicar em `UP` ou `Yes`.
5. `SIDE = "DOWN"` → clicar em `DOWN` ou `No`.
6. Preencher valor com **`$STAKE`** (padrão: $1).
7. Revisar: lado, valor, mercado correto.
8. Confirmar a ordem.

---

## Regras absolutas

- `ok = false` → abortar imediatamente.
- JSON inválido → aguardar próxima iteração, nunca operar.
- `timeLeftSec` não numérico → rejeitar.
- `currentPrice` ou `priceToBeat` null → desconsiderar sinal 5, exigir 3/4.
- `liquidity < MIN_LIQUIDITY` → rejeitar com motivo explícito.
- Nunca operar duas vezes no mesmo `marketId`.
- Nunca operar fora da janela `30s ≤ timeLeftSec ≤ 55s`.
- Nunca operar com preço fora de `0.80–MAX_ENTRY_PRICE`.
- `browserTradeAllowed`, `action`, `side`, `filterReason`, `selectedPrice`, `phase`, `strength`, `edgeUp`, `edgeDown`, `modelUp`, `modelDown` → **nunca usar na decisão**.
- `DRY_RUN=true` → logar decisão mas não confirmar ordem no browser.
- Login pedido pelo browser → parar e pedir ao usuário.
- Edge inacessível → tentar `edge-debug` antes de falhar.
- Sempre gravar log em `$HOME/polymarket-monitor.log`.

---

## Output obrigatório após trade

1. JSON bruto completo retornado pelo script no momento do trade
2. Lado + preço + stake + sinais UP/DOWN de TOTAL
3. Ações realizadas no browser (cliques, valores)
4. Resultado observado na tela
5. Timestamp da execução