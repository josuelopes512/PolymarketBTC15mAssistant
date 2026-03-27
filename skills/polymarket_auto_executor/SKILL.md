---
name: polymarket-browser-trader
description: Monitora continuamente mercados Polymarket BTC Up/Down 5m e executa o trade automaticamente quando a janela de entrada for atingida, usando a sessão existente do Microsoft Edge do usuário.
version: 1.5.0
metadata:
  openclaw:
    requires:
      bins:
        - bash
        - bc
        - jq
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

## Critérios de decisão (TODOS devem ser satisfeitos)

### 1. Preço do lado escolhido entre 0.80 e 0.88
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

### Fase 2 — Executar o script de monitoramento

```bash
bash "$HOME/Sources/PolymarketBTC15mAssistant/scripts/run-monitoring-trade.sh"
```

O script ficará em loop ativo, consultando o indicador a cada 3 segundos, calculando o tempo restante e aguardando a janela de entrada (`30s ≤ timeLeftSec ≤ 55s`).

Quando todos os critérios forem satisfeitos, o script imprimirá `✅ TRADE AUTORIZADO` com o lado, preço e mercado — e encerrará o loop.

---

### Fase 3 — Execução no browser (após TRADE AUTORIZADO)

1. Abrir `https://polymarket.com/event/${SLUG}` via browser tool, profile `edge-user`.
2. Se existir `Go to live market` → clicar imediatamente.
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
- Campos `action`, `side`, `phase`, `strength`, `edgeUp`, `edgeDown`, `modelUp`, `modelDown`, `liquidity` → **nunca ler, nunca usar**.
- Login pedido → parar e pedir ao usuário.
- Edge inacessível → tentar `edge-debug` antes de falhar.

---

## Output obrigatório após trade

1. JSON bruto (apenas campos utilizados) no momento do trade
2. Lado + preço + sinais
3. Ações realizadas no browser
4. Resultado observado na tela