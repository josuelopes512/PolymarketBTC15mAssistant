import { ClobClient, OrderType, Side } from "@polymarket/clob-client";
import { ethers } from "ethers";
import fs from "node:fs";
import path from "node:path";
import { CONFIG } from "../config.js";
import { fetchMarketById } from "../data/polymarket.js";

function toBoolEnv(v) {
  return String(v || "").toLowerCase() === "true";
}

function safeNumber(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function ensureTradesFile() {
  const dir = path.join(process.cwd(), "logs");
  const filePath = path.join(dir, "trades.json");
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify([]), "utf8");
  }
  return filePath;
}

function readTrades(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function writeTrades(filePath, trades) {
  fs.writeFileSync(filePath, JSON.stringify(trades, null, 2), "utf8");
}

function resolveOutcomeTokenId({ market, side }) {
  const outcomes = Array.isArray(market?.outcomes) ? market.outcomes : (typeof market?.outcomes === "string" ? JSON.parse(market.outcomes) : []);
  const clobTokenIds = Array.isArray(market?.clobTokenIds)
    ? market.clobTokenIds
    : (typeof market?.clobTokenIds === "string" ? JSON.parse(market.clobTokenIds) : []);

  const wantedLabel = side === "UP" ? CONFIG.polymarket.upOutcomeLabel : CONFIG.polymarket.downOutcomeLabel;
  const idx = outcomes.findIndex((x) => String(x).toLowerCase() === String(wantedLabel).toLowerCase());
  if (idx < 0) return null;

  const tokenId = clobTokenIds[idx] ? String(clobTokenIds[idx]) : null;
  return tokenId || null;
}

function resolveMarketOptions(market) {
  const tickSize = market?.tickSize ?? market?.minTickSize ?? market?.minimumTickSize ?? "0.01";
  const negRisk = Boolean(market?.negRisk ?? market?.isNegRisk ?? market?.useNegRisk ?? false);
  return { tickSize: String(tickSize), negRisk };
}

function resolveLiquidity(market, liquidityOverride) {
  const fromOverride = safeNumber(liquidityOverride);
  if (fromOverride !== null) return fromOverride;
  const fromMarket = safeNumber(market?.liquidityNum ?? market?.liquidity);
  return fromMarket;
}

async function createAuthedClient({ host, chainId, privateKey }) {
  const signatureType = safeNumber(process.env.SIGNATURE_TYPE) ?? 0;
  const funder = String(process.env.FUNDER || "");

  const signer = new ethers.Wallet(privateKey);
  const temp = new ClobClient(host, chainId, signer);

  const maybeCredsFn = temp.createOrDeriveApiKey ?? temp.createOrDeriveApiCreds ?? temp.createOrDeriveApiKeys;
  const creds = typeof maybeCredsFn === "function" ? await maybeCredsFn.call(temp) : null;

  if (creds) {
    return new ClobClient(host, chainId, signer, await creds, signatureType, funder, undefined, undefined, undefined, undefined, undefined, undefined, undefined, true);
  }

  return new ClobClient(host, chainId, signer, undefined, signatureType, funder, undefined, undefined, undefined, undefined, undefined, undefined, undefined, true);
}

export async function placeOrder(params) {
  try {
    const {
      marketId,
      side,
      amountUsd,
      price,
      timeLeftSec,
      maxEntryPrice,
      liquidity
    } = params ?? {};

    if (!marketId) return { ok: false, error: "missing_marketId" };
    if (side !== "UP" && side !== "DOWN") return { ok: false, error: "invalid_side" };

    const amount = safeNumber(amountUsd);
    const limitPrice = safeNumber(price);
    if (amount === null || amount <= 0) return { ok: false, error: "invalid_amountUsd" };
    if (limitPrice === null || limitPrice <= 0) return { ok: false, error: "invalid_price" };

    const ttl = safeNumber(timeLeftSec);
    if (ttl !== null && ttl < 2) return { ok: false, error: "timeLeftSec_too_low" };

    const maxP = safeNumber(maxEntryPrice);
    if (maxP !== null && limitPrice > maxP) return { ok: false, error: "price_above_maxEntryPrice" };

    const filePath = ensureTradesFile();
    const trades = readTrades(filePath);
    const alreadyTraded = trades.some((t) => String(t?.marketId) === String(marketId) && Boolean(t?.ok));
    if (alreadyTraded) return { ok: false, error: "duplicate_trade_marketId" };

    const market = await fetchMarketById(marketId);
    if (!market) return { ok: false, error: "market_not_found" };

    const liq = resolveLiquidity(market, liquidity);
    if (liq === null || liq <= 0) return { ok: false, error: "missing_liquidity" };

    const tokenID = resolveOutcomeTokenId({ market, side });
    if (!tokenID) return { ok: false, error: "tokenId_not_found" };

    const host = process.env.POLYMARKET_HOST || CONFIG.clobBaseUrl;
    const chainId = safeNumber(process.env.CHAIN_ID) ?? 137;
    const dryRun = toBoolEnv(process.env.DRY_RUN);

    const entry = {
      ts: new Date().toISOString(),
      marketId: String(marketId),
      side,
      amountUsd: amount,
      price: limitPrice,
      dryRun,
      ok: false
    };

    if (dryRun) {
      entry.ok = true;
      entry.status = "dry_run";
      trades.push(entry);
      writeTrades(filePath, trades);
      return { ok: true, dryRun: true, marketId: String(marketId), tokenID, side, amountUsd: amount, price: limitPrice };
    }

    const privateKey = String(process.env.PRIVATE_KEY || "");
    if (!privateKey) return { ok: false, error: "missing_PRIVATE_KEY" };

    const client = await createAuthedClient({ host, chainId, privateKey });
    const options = resolveMarketOptions(market);

    let response;
    if (typeof client.createAndPostMarketOrder === "function") {
      response = await client.createAndPostMarketOrder(
        { tokenID, side: Side.BUY, amount, price: limitPrice },
        options,
        OrderType.FOK
      );
    } else if (typeof client.createMarketOrder === "function" && typeof client.postOrder === "function") {
      const order = await client.createMarketOrder(
        { tokenID, side: Side.BUY, amount, price: limitPrice },
        options
      );
      response = await client.postOrder(order, OrderType.FOK);
    } else if (typeof client.createAndPostOrder === "function") {
      const size = amount / limitPrice;
      response = await client.createAndPostOrder(
        { tokenID, side: Side.BUY, size, price: limitPrice },
        options,
        OrderType.FOK
      );
    } else {
      return { ok: false, error: "clob_client_missing_methods" };
    }

    const ok = Boolean(response?.success ?? response?.ok ?? response?.status);
    entry.ok = ok;
    entry.orderID = response?.orderID ?? response?.orderId ?? null;
    entry.status = response?.status ?? null;
    entry.response = response ?? null;

    trades.push(entry);
    writeTrades(filePath, trades);

    if (!ok) {
      return { ok: false, error: response?.errorMsg ?? response?.error ?? "order_failed", response };
    }

    return { ok: true, marketId: String(marketId), tokenID, side, amountUsd: amount, price: limitPrice, response };
  } catch (err) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}
