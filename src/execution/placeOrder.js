import { ClobClient, OrderType, Side } from "@polymarket/clob-client";
import { ethers } from "ethers";
import { CONFIG } from "../config.js";
import { resolveMarket, pickOutcomeTokenId } from "./resolveMarket.js";

function n(x) {
  const v = Number(x);
  return Number.isFinite(v) ? v : null;
}

function b(x) {
  return String(x || "").toLowerCase() === "true";
}

async function authedClient({ host, chainId, privateKey, funder }) {
  const signatureType = n(process.env.SIGNATURE_TYPE) ?? 0;
  const signer = new ethers.Wallet(privateKey);
  const temp = new ClobClient(host, chainId, signer);
  const getCreds = temp.createOrDeriveApiKey ?? temp.createOrDeriveApiCreds ?? temp.createOrDeriveApiKeys;
  const creds = typeof getCreds === "function" ? await getCreds.call(temp) : undefined;
  return new ClobClient(host, chainId, signer, await creds, signatureType, funder, undefined, undefined, undefined, undefined, undefined, undefined, undefined, true);
}

function marketOptions(market) {
  const tickSize = market?.tickSize ?? market?.minTickSize ?? market?.minimumTickSize ?? "0.01";
  const negRisk = Boolean(market?.negRisk ?? market?.isNegRisk ?? market?.useNegRisk ?? false);
  return { tickSize: String(tickSize), negRisk };
}

export async function placeOrder(input) {
  try {
    const host = process.env.POLYMARKET_HOST || CONFIG.clobBaseUrl;
    const chainId = n(process.env.CHAIN_ID) ?? 137;
    const privateKey = String(process.env.PRIVATE_KEY || "");
    const funder = String(process.env.FUNDER || "");
    const dryRun = b(process.env.DRY_RUN);
    if (!input || !input.marketId) return { ok: false, error: "missing_marketId" };
    if (input.side !== "UP" && input.side !== "DOWN") return { ok: false, error: "invalid_side" };
    const amountUsd = n(input.amountUsd ?? process.env.STAKE_USD);
    if (amountUsd === null || amountUsd <= 0) return { ok: false, error: "invalid_amountUsd" };
    const expectedPrice = n(input.expectedPrice ?? process.env.MAX_ENTRY_PRICE);
    const resolved = await resolveMarket({ marketId: input.marketId, marketSlug: input.marketSlug });
    const tokenId = pickOutcomeTokenId(resolved, input.side);
    if (!tokenId) return { ok: false, error: "tokenId_not_found" };
    if (dryRun) {
      return { ok: true, dryRun: true, marketId: resolved.marketId, tokenId, side: input.side, amountUsd, response: { type: "dry_run", expectedPrice } };
    }
    if (!privateKey) return { ok: false, error: "missing_PRIVATE_KEY" };
    const client = await authedClient({ host, chainId, privateKey, funder });
    let response;
    if (typeof client.createAndPostMarketOrder === "function") {
      response = await client.createAndPostMarketOrder(
        { tokenID: tokenId, side: Side.BUY, amount: amountUsd, price: expectedPrice ?? 1 },
        marketOptions({}),
        OrderType.FOK
      );
    } else if (typeof client.createMarketOrder === "function" && typeof client.postOrder === "function") {
      const order = await client.createMarketOrder(
        { tokenID: tokenId, side: Side.BUY, amount: amountUsd, price: expectedPrice ?? 1 },
        marketOptions({})
      );
      response = await client.postOrder(order, OrderType.FOK);
    } else if (typeof client.createAndPostOrder === "function") {
      const price = expectedPrice ?? 1;
      const size = amountUsd / price;
      response = await client.createAndPostOrder(
        { tokenID: tokenId, side: Side.BUY, size, price },
        marketOptions({}),
        OrderType.FOK
      );
    } else {
      return { ok: false, error: "clob_client_missing_methods" };
    }
    const success = Boolean(response?.success ?? response?.ok ?? response?.status);
    if (!success) return { ok: false, error: response?.errorMsg ?? response?.error ?? "order_failed", response };
    return { ok: true, dryRun: false, marketId: resolved.marketId, tokenId, side: input.side, amountUsd, response };
  } catch (err) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}
