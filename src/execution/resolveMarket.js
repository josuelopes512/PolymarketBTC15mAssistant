import { fetchMarketById, fetchMarketBySlug } from "../data/polymarket.js";
import { CONFIG } from "../config.js";

function parseJsonMaybe(x) {
  if (x === null || x === undefined) return x;
  if (typeof x === "string") {
    try {
      return JSON.parse(x);
    } catch {
      return x;
    }
  }
  return x;
}

function normalizeOutcomes(market) {
  const outcomes = parseJsonMaybe(market?.outcomes);
  const clobTokenIds = parseJsonMaybe(market?.clobTokenIds);
  const list = [];
  const names = Array.isArray(outcomes) ? outcomes : [];
  const ids = Array.isArray(clobTokenIds) ? clobTokenIds : [];
  for (let i = 0; i < Math.max(names.length, ids.length); i += 1) {
    const name = names[i] !== undefined ? String(names[i]) : null;
    const tokenId = ids[i] !== undefined ? String(ids[i]) : null;
    if (name && tokenId) list.push({ name, tokenId });
  }
  return list;
}

export async function resolveMarket({ marketId, marketSlug }) {
  let market = null;
  if (marketId) market = await fetchMarketById(marketId);
  if (!market && marketSlug) market = await fetchMarketBySlug(marketSlug);
  if (!market) throw new Error("market_not_found");
  const outcomes = normalizeOutcomes(market);
  if (!outcomes.length) throw new Error("outcomes_not_found");
  const id = String(market.id ?? marketId ?? "");
  const slug = String(market.slug ?? marketSlug ?? "");
  return { marketId: id, marketSlug: slug, outcomes };
}

export function pickOutcomeTokenId(resolved, side) {
  const up = String(CONFIG.polymarket.upOutcomeLabel).toLowerCase();
  const down = String(CONFIG.polymarket.downOutcomeLabel).toLowerCase();
  const wanted = side === "UP" ? up : down;
  const match = resolved.outcomes.find((o) => String(o.name).toLowerCase() === wanted);
  return match ? String(match.tokenId) : null;
}
