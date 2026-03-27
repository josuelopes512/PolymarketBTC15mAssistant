import fs from "node:fs";
import path from "node:path";

function toBool(v) {
  return String(v || "").toLowerCase() === "true";
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function readTradedFile() {
  const file = path.join(process.cwd(), "logs", "traded-markets.json");
  try {
    const raw = fs.readFileSync(file, "utf8");
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function validateTrade(signal) {
  if (!signal || signal.ok !== true) return { ok: false, reason: "signal_not_ok" };
  if (signal.action !== "ENTER") return { ok: true, traded: false, reason: "NO_TRADE" };
  if (signal.side !== "UP" && signal.side !== "DOWN") return { ok: false, reason: "invalid_side" };
  if (signal.currentPrice === null) return { ok: false, reason: "missing_currentPrice" };
  if (signal.priceToBeat === null) return { ok: false, reason: "missing_priceToBeat" };
  const liq = toNum(signal.liquidity);
  if (liq === null || liq <= 0) return { ok: false, reason: "missing_liquidity" };
  const minLiq = toNum(process.env.MIN_LIQUIDITY);
  if (minLiq !== null && liq < minLiq) return { ok: false, reason: "liquidity_below_min" };
  const tls = toNum(signal.timeLeftSec);
  if (tls !== null && tls < 2) return { ok: false, reason: "time_left_too_low" };
  const entry = signal.side === "UP" ? toNum(signal.upPrice) : toNum(signal.downPrice);
  if (entry === null || entry <= 0) return { ok: false, reason: "invalid_entry_price" };
  const maxEntry = toNum(process.env.MAX_ENTRY_PRICE);
  if (maxEntry !== null && entry > maxEntry) return { ok: false, reason: "price_above_MAX_ENTRY_PRICE" };
  const traded = readTradedFile();
  const already = traded.some((t) => String(t.marketId) === String(signal.marketId));
  if (already) return { ok: false, reason: "duplicate_trade" };
  const stake = toNum(process.env.STAKE_USD) ?? 0;
  if (!Number.isFinite(stake) || stake <= 0) return { ok: false, reason: "invalid_STAKE_USD" };
  return {
    ok: true,
    normalized: {
      marketId: String(signal.marketId),
      marketSlug: String(signal.marketSlug || ""),
      side: signal.side,
      amountUsd: stake,
      expectedPrice: entry
    }
  };
}
