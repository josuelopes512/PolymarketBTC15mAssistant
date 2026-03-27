---
name: polymarket-browser-trader
description: Monitora continuamente mercados Polymarket BTC Up/Down 5m, calcula o tempo restante e executa o trade automaticamente quando a janela de entrada for atingida, usando a sessão existente do Microsoft Edge do usuário.
version: 1.3.0
metadata:
  openclaw:
    requires:
      bins:
        - node
        - bash
        - bc
        - jq
      env:
        - STAKE_USD
        - MAX_ENTRY_PRICE
        - MIN_LIQUIDITY
---

## Estrutura do JSON do indicador (referência canônica)

```json
{
  "ok": true,
  "marketId": "1734030",
  "marketSlug": "btc-updown-5m-1774638300",
  "timeLeftSec": 43,
  "currentPrice": null,
  "priceToBeat": null,
  "upPrice": 0.12,
  "downPrice": 0.87,
  "liquidity": 24940.4653,
  "taLongPct": 48,
  "taShortPct": 52,
  "heiken": "green",
  "rsi": 36.348967896289196,
  "macd": "bearish",
  "action": "NO_TRADE",
  "side": null,
  "phase": "LATE",
  "strength": null,
  "edgeUp": 0.3615196248196248,
  "edgeDown": -0.36151962481962474,
  "modelUp": 0.48273174603174,
  "modelDown": 0.51726825396825
}
```

### Campos utilizados na decisão

| Campo            | Tipo         | Uso                                                              |
|------------------|--------------|------------------------------------------------------------------|
| `ok`             | bool         | Se `false`, abortar imediatamente                                |
| `marketId`       | string       | Identificador único do mercado (deduplicação)                    |
| `marketSlug`     | string       | Slug para navegar até a página do mercado na Polymarket          |
| `timeLeftSec`    | int          | Tempo restante — controla a janela de entrada                    |
| `currentPrice`   | float\|null  | Preço atual do BTC — se `null`, desconsiderar sinal 5            |
| `priceToBeat`    | float\|null  | Preço alvo do mercado — se `null`, desconsiderar sinal 5         |
| `upPrice`        | float        | Preço Polymarket do lado UP                                      |
| `downPrice`      | float        | Preço Polymarket do lado DOWN                                    |
| `taLongPct`      | int          | % TA Predict para LONG                                           |
| `taShortPct`     | int          | % TA Predict para SHORT                                          |
| `heiken`         | string       | `"red"`, `"red x2"`, `"green"`, `"green x3"`…                   |
| `rsi`            | float        | RSI atual                                                        |
| `macd`           | string       | `"bearish"`, `"bearish (expanding)"`, `"bullish"`…               |
| `phase`          | string       | `"EARLY"` / `"MID"` / `"LATE"` — apenas informativo             |

> **Ignorados na decisão:** `action`, `side`, `strength`, `edgeUp`, `edgeDown`, `modelUp`, `modelDown`, `liquidity`
> A skill decide de forma independente — nunca delega para `action` ou `side` do indicador.

---

## Critérios de decisão (TODOS devem ser satisfeitos)

### 1. Preço do lado escolhido entre 0.80 e 0.88
- UP → verificar `upPrice`
- DOWN → verificar `downPrice`

### 2. Sinais técnicos

| Sinal                        | DOWN                              | UP                               |
|------------------------------|-----------------------------------|----------------------------------|
| **TA Predict**               | `taShortPct > 55`                 | `taLongPct > 55`                 |
| **Heiken Ashi**              | `heiken` começa com `"red"`       | `heiken` começa com `"green"`    |
| **RSI**                      | `rsi < 45`                        | `rsi > 55`                       |
| **MACD**                     | `macd` começa com `"bearish"`     | `macd` começa com `"bullish"`    |
| **currentPrice / priceToBeat** | `currentPrice < priceToBeat`    | `currentPrice > priceToBeat`     |

**Mínimo necessário:**
- Se `currentPrice` e `priceToBeat` ambos presentes → exigir **4 de 5** sinais
- Se qualquer um for `null` → sinal 5 desconsiderado, exigir **3 de 4** sinais restantes

### 3. Janela de tempo: `30 ≤ timeLeftSec ≤ 55`

---

## Procedimento completo

### Fase 1 — Inicialização

```bash
touch "$HOME/.polymarket-traded-markets"
# Garantir Edge acessível via profile edge-user
# Se não responder: edge-debug
```

---

### Fase 2 — Loop de monitoramento (espera ativa, poll a cada 3s)

```bash
INDICATOR="$HOME/Sources/PolymarketBTC15mAssistant/scripts/run-openclaw-trade.sh"
POLL=3
ENTRY_MIN=30
ENTRY_MAX=55
PRICE_MIN=0.80
PRICE_MAX=0.88
TRADED="$HOME/.polymarket-traded-markets"

while true; do

  # 1. Consultar indicador
  JSON=$(bash "$INDICATOR" 2>/dev/null)

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
  PHASE=$(echo "$JSON"    | jq -r '.phase')

  echo "[$(date '+%H:%M:%S')] market=${MID} | timeLeft=${TIME}s | UP=${UP_P} DOWN=${DOWN_P} | phase=${PHASE}"

  # 2. Validações básicas
  [ "$OK" != "true" ] && echo "  → ok=false, abortando." && sleep $POLL && continue
  grep -qx "$MID" "$TRADED" 2>/dev/null && echo "  → mercado já operado." && sleep $POLL && continue

  # 3. Controle de tempo
  if [ "$TIME" -gt "$ENTRY_MAX" ]; then
    WAIT=$(( TIME - ENTRY_MAX ))
    echo "  → aguardando ${WAIT}s para janela de entrada..."
    sleep $POLL
    continue
  fi

  if [ "$TIME" -lt "$ENTRY_MIN" ]; then
    echo "  → janela expirada (${TIME}s < ${ENTRY_MIN}s). Aguardando próximo mercado."
    sleep $POLL
    continue
  fi

  echo "  → ⏱ JANELA DE ENTRADA! Avaliando sinais..."

  # 4. Avaliar sinais
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
    echo "  → currentPrice/priceToBeat null: sinal 5 desconsiderado (mínimo 3/4)"
    TOTAL_SIG=4
  else
    [ "$(echo "$CUR < $BEAT" | bc -l)" = "1" ] && ((DOWN_SIG++)) || true
    [ "$(echo "$CUR > $BEAT" | bc -l)" = "1" ] && ((UP_SIG++))   || true
  fi

  MIN_SIG=$([ "$TOTAL_SIG" = "5" ] && echo 4 || echo 3)
  echo "  → sinais: UP=${UP_SIG} DOWN=${DOWN_SIG} (mínimo: ${MIN_SIG}/${TOTAL_SIG})"

  # 5. Decidir lado
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

  # 6. Verificar faixa de preço
  IN_RANGE=$(echo "$SIDE_PRICE >= $PRICE_MIN && $SIDE_PRICE <= $PRICE_MAX" | bc -l)
  if [ "$IN_RANGE" != "1" ]; then
    echo "  → preço ${SIDE_PRICE} fora da faixa [${PRICE_MIN}–${PRICE_MAX}]. Não operar."
    sleep $POLL
    continue
  fi

  # 7. TRADE AUTORIZADO
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
```

---

### Fase 3 — Execução no browser

1. Abrir `https://polymarket.com/event/${SLUG}` via browser tool, profile `edge-user`.
2. Se existir botão `Go to live market` → clicar imediatamente.
3. Aguardar navegação para o mercado ativo.
4. `SIDE = "UP"` → clicar em `UP` ou `Yes`.
5. `SIDE = "DOWN"` → clicar em `DOWN` ou `No`.
6. Preencher valor: **$1**.
7. Revisar: lado, valor, mercado.
8. Confirmar a ordem.

---

## Regras absolutas

- `ok = false` → abortar.
- `currentPrice` ou `priceToBeat` null → desconsiderar sinal 5, exigir 3/4.
- Nunca operar duas vezes no mesmo `marketId`.
- Nunca operar fora da janela `30s ≤ timeLeftSec ≤ 55s`.
- Nunca operar com preço fora de `0.80–0.88`.
- Nunca inventar sinais nem usar `action`/`side` do indicador.
- Login pedido pela página → parar e pedir ao usuário.
- Edge inacessível → tentar `edge-debug` antes de falhar.

---

## Output obrigatório

**A cada iteração do loop:**
```
[HH:MM:SS] market=<id> | timeLeft=<N>s | UP=<p> DOWN=<p> | phase=<fase>
  → sinais: UP=<n> DOWN=<n> (mínimo: <n>/<total>)
  → <decisão + motivo>
```

**Após trade executado:**
1. JSON bruto do indicador no momento do trade
2. Lado + preço + sinais
3. Ações realizadas no browser
4. Resultado observado na tela