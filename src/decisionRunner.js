import "dotenv/config";
import { CONFIG } from "./config.js";
import { fetchKlines, fetchLastPrice } from "./data/binance.js";
import { fetchChainlinkBtcUsd } from "./data/chainlink.js";
import { fetchPolymarketSnapshot } from "./data/polymarket.js";
import { computeVwapSeries } from "./indicators/vwap.js";
import { computeRsi, slopeLast } from "./indicators/rsi.js";
import { computeMacd } from "./indicators/macd.js";
import { computeHeikenAshi, countConsecutive } from "./indicators/heikenAshi.js";
import { getCandleWindowTiming } from "./utils.js";
import { applyGlobalProxyFromEnv } from "./net/proxy.js";
import { computeDecision } from "./engine/decision.js";
import { pathToFileURL } from "node:url";

function parsePriceToBeat(market) {
  const text = String(market?.question ?? market?.title ?? "");
  if (!text) return null;
  const m = text.match(/price\s*to\s*beat[^\d$]*\$?\s*([0-9][0-9,]*(?:\.[0-9]+)?)/i);
  if (!m) return null;
  const raw = m[1].replace(/,/g, "");
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function extractNumericFromMarket(market) {
  const directKeys = [
    "priceToBeat",
    "price_to_beat",
    "strikePrice",
    "strike_price",
    "strike",
    "threshold",
    "thresholdPrice",
    "threshold_price",
    "targetPrice",
    "target_price",
    "referencePrice",
    "reference_price"
  ];

  for (const k of directKeys) {
    const v = market?.[k];
    const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
    if (Number.isFinite(n)) return n;
  }

  const seen = new Set();
  const stack = [{ obj: market, depth: 0 }];

  while (stack.length) {
    const { obj, depth } = stack.pop();
    if (!obj || typeof obj !== "object") continue;
    if (seen.has(obj) || depth > 6) continue;
    seen.add(obj);

    const entries = Array.isArray(obj) ? obj.entries() : Object.entries(obj);
    for (const [key, value] of entries) {
      const k = String(key).toLowerCase();
      if (value && typeof value === "object") {
        stack.push({ obj: value, depth: depth + 1 });
        continue;
      }

      if (!/(price|strike|threshold|target|beat)/i.test(k)) continue;

      const n = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
      if (!Number.isFinite(n)) continue;

      if (n > 1000 && n < 2_000_000) return n;
    }
  }

  return null;
}

function priceToBeatFromPolymarketMarket(market) {
  const n = extractNumericFromMarket(market);
  if (n !== null) return n;
  return parsePriceToBeat(market);
}

function macdLabelFrom(macd) {
  if (macd === null) return "-";
  if (macd.hist < 0) return macd.histDelta !== null && macd.histDelta < 0 ? "bearish (expanding)" : "bearish";
  return macd.histDelta !== null && macd.histDelta > 0 ? "bullish (expanding)" : "bullish";
}

export async function runDecisionCycle() {
  applyGlobalProxyFromEnv();

  const timing = getCandleWindowTiming(CONFIG.candleWindowMinutes);

  const [klines1m, lastPrice, chainlink, poly] = await Promise.all([
    fetchKlines({ interval: "1m", limit: 240 }),
    fetchLastPrice(),
    fetchChainlinkBtcUsd(),
    fetchPolymarketSnapshot()
  ]);

  const settlementMs = poly.ok && poly.market?.endDate ? new Date(poly.market.endDate).getTime() : null;
  const settlementLeftMin = settlementMs ? (settlementMs - Date.now()) / 60_000 : null;
  const timeLeftMin = settlementLeftMin ?? timing.remainingMinutes;
  const timeLeftSec = Math.max(0, Math.floor(timeLeftMin * 60));

  const candles = klines1m;
  const closes = candles.map((c) => c.close);

  const vwapSeries = computeVwapSeries(candles);
  const vwapNow = vwapSeries[vwapSeries.length - 1] ?? null;

  const lookback = CONFIG.vwapSlopeLookbackMinutes;
  const vwapSlope = vwapSeries.length >= lookback && vwapNow !== null
    ? (vwapNow - vwapSeries[vwapSeries.length - lookback]) / lookback
    : null;

  const rsiNow = computeRsi(closes, CONFIG.rsiPeriod);
  const rsiSeries = [];
  for (let i = 0; i < closes.length; i += 1) {
    const sub = closes.slice(0, i + 1);
    const r = computeRsi(sub, CONFIG.rsiPeriod);
    if (r !== null) rsiSeries.push(r);
  }
  const rsiSlope = slopeLast(rsiSeries, 3);

  const macd = computeMacd(closes, CONFIG.macdFast, CONFIG.macdSlow, CONFIG.macdSignal);

  const ha = computeHeikenAshi(candles);
  const consec = countConsecutive(ha);

  const failedVwapReclaim = vwapNow !== null && vwapSeries.length >= 3
    ? closes[closes.length - 1] < vwapNow && closes[closes.length - 2] > vwapSeries[vwapSeries.length - 2]
    : false;

  const marketUp = poly.ok ? poly.prices.up : null;
  const marketDown = poly.ok ? poly.prices.down : null;

  const decision = computeDecision({
    price: lastPrice,
    vwap: vwapNow,
    vwapSlope,
    rsi: rsiNow,
    rsiSlope,
    macd,
    heikenColor: consec.color,
    heikenCount: consec.count,
    failedVwapReclaim,
    timeLeftMin,
    candleWindowMinutes: CONFIG.candleWindowMinutes,
    marketUp,
    marketDown
  });

  const liquidity = poly.ok
    ? (Number(poly.market?.liquidityNum) || Number(poly.market?.liquidity) || null)
    : null;

  const out = {
    ok: true,
    marketId: poly.ok ? String(poly.market?.id ?? "") : "",
    marketSlug: poly.ok ? String(poly.market?.slug ?? "") : "",
    timeLeftSec,
    currentPrice: chainlink?.price ?? null,
    priceToBeat: poly.ok ? priceToBeatFromPolymarketMarket(poly.market) : null,
    upPrice: marketUp,
    downPrice: marketDown,
    liquidity,
    taLongPct: decision.modelUp === null ? null : Math.round(decision.modelUp * 100),
    taShortPct: decision.modelDown === null ? null : Math.round(decision.modelDown * 100),
    heiken: consec.color ?? null,
    rsi: rsiNow,
    macd: macdLabelFrom(macd),
    action: decision.action,
    side: decision.side,
    phase: decision.phase,
    strength: decision.strength,
    edgeUp: decision.edgeUp,
    edgeDown: decision.edgeDown,
    modelUp: decision.modelUp,
    modelDown: decision.modelDown
  };

  if (!poly.ok) {
    return { ok: false, error: poly.reason ?? "polymarket_error" };
  }

  return out;
}

async function main() {
  try {
    const result = await runDecisionCycle();
    process.stdout.write(JSON.stringify(result));
    process.stdout.write("\n");
  } catch (err) {
    process.stdout.write(JSON.stringify({ ok: false, error: err?.message ?? String(err) }));
    process.stdout.write("\n");
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
