---
name: polymarket-browser-trader
description: Monitora continuamente mercados Polymarket BTC Up/Down 5m e executa o trade automaticamente quando a janela de entrada for atingida, usando a sessão existente do Microsoft Edge do usuário.
version: 1.6.0
metadata:
  openclaw:
    requires:
      bins:
        - bash
        - bc
        - jq
      env:
        - STAKE_USD
        - MAX_ENTRY_PRICE
        - MIN_LIQUIDITY
---

## Campos do JSON utilizados (única fonte de verdade)

Apenas estes campos são lidos e processados. Todos os outros são ignorados.

```json
{
  "ok":           true,
  "marketId":     "1734030",
  "marketSlug":   "btc-updown-5m-1774638300",
  "timeLeftSec":  43,
  "upPrice":      0.12,
  "downPrice":    0.87,
  "taLongPct":    48,
  "taShortPct":   52,
  "heiken":       "red x3",
  "rsi":          40.8,
  "macd":         "bearish (expanding)",
  "currentPrice": 65753.62,
  "priceToBeat":  65787.00
}
```

> `currentPrice` e `priceToBeat` podem vir como `null`.
> Todos os outros campos (`action`, `side`, `phase`, `strength`,
> `edgeUp`, `edgeDown`, `modelUp`, `modelDown`, `liquidity`) são **completamente ignorados**.

---

## Variáveis de ambiente

| Variável          | Descrição                                 | Exemplo  |
|-------------------|-------------------------------------------|----------|
| `STAKE_USD`       | Valor fixo da ordem em dólares            | `1`      |
| `MAX_ENTRY_PRICE` | Preço máximo permitido para entrar        | `0.88`   |
| `MIN_LIQUIDITY`   | Liquidez mínima exigida (não usada agora) | `1000`   |

---

## Critérios de decisão (TODOS devem ser satisfeitos)

### 1. Preço do lado escolhido entre 0.80 e `$MAX_ENTRY_PRICE`
- Considerar `upPrice` se avaliar UP
- Considerar `downPrice` se avaliar DOWN

### 2. Sinais técnicos

| Sinal | DOWN | UP |
|---|---|---|
| **TA Predict** | `taShortPct > 55` | `taLongPct > 55` |
| **Heiken Ashi** | `heiken` começa com `"red"` | `heiken` começa com `"green"` |
| **RSI** | `rsi < 45` | `rsi > 55` |
| **MACD** | `macd` começa com `"bearish"` | `macd` começa com `"bullish"` |
| **currentPrice vs priceToBeat** | `currentPrice < priceToBeat` | `currentPrice > priceToBeat` |

**Mínimo para operar:**
- `currentPrice` e `priceToBeat` presentes → **4 de 5** sinais
- Qualquer um `null` → sinal 5 desconsiderado, exigir **3 de 4**

### 3. Janela de tempo: `30 ≤ timeLeftSec ≤ 55`

---

## Procedimento

### Fase 1 — Inicialização

Garanta que o Microsoft Edge esteja acessível via profile `edge-user`.
Se não responder, execute: `edge-debug`

---

### Fase 2 — Executar o script de monitoramento com parâmetros

```bash
STAKE_USD=1 \
MAX_ENTRY_PRICE=0.88 \
MIN_LIQUIDITY=1000 \
bash "$HOME/Sources/PolymarketBTC15mAssistant/scripts/run-monitoring-trade.sh" \
  --stake "$STAKE_USD" \
  --max-price "$MAX_ENTRY_PRICE" \
  --min-liquidity "$MIN_LIQUIDITY"
```

O script ficará em loop ativo, consultando o indicador a cada 3 segundos, exibindo o tempo restante e aguardando a janela de entrada (`30s ≤ timeLeftSec ≤ 55s`).

Quando todos os critérios forem satisfeitos, o script imprimirá `✅ TRADE AUTORIZADO` com o lado, preço e mercado — e encerrará o loop.

---

### Fase 2 (alternativa) — Loop inline caso o script externo não esteja disponível

```bash
INDICATOR="$HOME/Sources/PolymarketBTC15mAssistant/scripts/run-openclaw-trade.sh"
POLL=3
ENTRY_MIN=30
ENTRY_MAX=55
PRICE_MIN=0.80
PRICE_MAX="${MAX_ENTRY_PRICE:-0.88}"
STAKE="${STAKE_USD:-1}"
TRADED="$HOME/.polymarket-traded-markets"

touch "$TRADED"

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

  echo "[$(date '+%H:%M:%S')] market=${MID} | timeLeft=${TIME}s | UP=${UP_P} DOWN=${DOWN_P} | stake=\$${STAKE}"

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
  echo "     Stake:   \$${STAKE}"
  echo "     Mercado: ${MID} (${SLUG})"
  echo "     Sinais:  UP=${UP_SIG} DOWN=${DOWN_SIG} de ${TOTAL_SIG}"
  echo ""

  echo "$MID" >> "$TRADED"
  break

done
```

---

### Fase 3 — Execução no browser (após TRADE AUTORIZADO)

1. Abrir `https://polymarket.com/event/${SLUG}` via browser tool, profile `edge-user`.
2. Se existir `Go to live market` → clicar imediatamente.
3. Aguardar navegação para o mercado ativo.
4. `SIDE = "UP"` → clicar em `UP` ou `Yes`.
5. `SIDE = "DOWN"` → clicar em `DOWN` ou `No`.
6. Preencher valor com **`$STAKE_USD`** (padrão: $1).
7. Revisar: lado, valor, mercado.
8. Confirmar a ordem.

---

## Regras absolutas

- `ok = false` → abortar.
- `currentPrice` ou `priceToBeat` null → desconsiderar sinal 5, exigir 3/4.
- Nunca operar duas vezes no mesmo `marketId`.
- Nunca operar fora da janela `30s ≤ timeLeftSec ≤ 55s`.
- Nunca operar com preço fora de `0.80–$MAX_ENTRY_PRICE`.
- Campos `action`, `side`, `phase`, `strength`, `edgeUp`, `edgeDown`, `modelUp`, `modelDown`, `liquidity` → **nunca ler, nunca usar**.
- Login pedido → parar e pedir ao usuário.
- Edge inacessível → tentar `edge-debug` antes de falhar.

---

## Output obrigatório após trade

1. JSON bruto (apenas campos utilizados) no momento do trade
2. Lado + preço + stake + sinais
3. Ações realizadas no browser
4. Resultado observado na tela