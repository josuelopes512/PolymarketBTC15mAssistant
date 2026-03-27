import "dotenv/config";
import { runDecisionCycle } from "./decisionRunner.js";
import { validateTrade } from "./execution/validateTrade.js";
import { placeOrder } from "./execution/placeOrder.js";
import { hasTraded, markTraded } from "./execution/tradeState.js";
import { logEvent } from "./execution/tradeLogger.js";
import { pathToFileURL } from "node:url";

function print(obj, code = 0) {
  process.stdout.write(JSON.stringify(obj));
  process.stdout.write("\n");
  if (!obj.ok) process.exitCode = 1;
  if (code) process.exitCode = code;
}

function parseArgs(argv) {
  const out = { mode: null, markTraded: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--mode" || a === "--execution") {
      out.mode = String(argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (a === "--mode=openclaw" || a === "--execution=openclaw") {
      out.mode = "openclaw";
      continue;
    }
    if (a === "--mark-traded") {
      const marketId = String(argv[i + 1] ?? "");
      const side = String(argv[i + 2] ?? "");
      const amountUsd = Number(argv[i + 3]);
      out.markTraded = { marketId, side, amountUsd: Number.isFinite(amountUsd) ? amountUsd : null };
      i += 3;
      continue;
    }
  }
  return out;
}

function toBool(v) {
  return String(v || "").toLowerCase() === "true";
}

function computeMarketUrl(marketSlug) {
  const slug = String(marketSlug || "").trim();
  if (!slug) return null;
  return `https://polymarket.com/market/${encodeURIComponent(slug)}`;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const modeEnv = String(process.env.EXECUTION_MODE || process.env.EXEC_MODE || "").trim().toLowerCase();
  const modeArg = String(args.mode || "").trim().toLowerCase();
  const mode = modeArg || modeEnv || "api";

  try {
    if (args.markTraded?.marketId) {
      const marketId = String(args.markTraded.marketId);
      const side = args.markTraded.side === "UP" || args.markTraded.side === "DOWN" ? args.markTraded.side : null;
      const amountUsd = Number.isFinite(args.markTraded.amountUsd) ? args.markTraded.amountUsd : null;
      markTraded(marketId, { side, amountUsd, status: "ok", source: "manual" });
      print({ ok: true, marked: true, marketId, side, amountUsd });
      return;
    }

    const signal = await runDecisionCycle();
    if (!signal || signal.ok !== true) {
      const out = { ok: false, error: signal?.error ?? "signal_error" };
      logEvent({ signal, error: out.error });
      print(out, 1);
      return;
    }
    const validation = validateTrade(signal);
    if (!validation.ok || !validation.normalized) {
      const out = { ok: true, traded: false, reason: validation.reason ?? "invalid" };
      logEvent({ signal, validation: out });
      print(out);
      return;
    }
    const norm = validation.normalized;
    if (hasTraded(norm.marketId)) {
      const out = { ok: true, traded: false, reason: "duplicate_trade" };
      logEvent({ signal, validation, orderRequest: norm, error: out.reason });
      print(out);
      return;
    }

    if (mode === "openclaw" || toBool(process.env.OPENCLAW)) {
      const marketUrl = computeMarketUrl(norm.marketSlug);
      const out = {
        ok: true,
        traded: false,
        executionMode: "openclaw",
        action: signal.action,
        side: norm.side,
        marketId: norm.marketId,
        marketSlug: norm.marketSlug,
        marketUrl,
        amountUsd: norm.amountUsd,
        expectedPrice: norm.expectedPrice,
        signal,
        validation,
        postSuccess: {
          markTradedArgs: ["--mark-traded", norm.marketId, norm.side, String(norm.amountUsd)]
        }
      };
      logEvent({ signal, validation, orderRequest: norm, orderResult: { ok: true, executionMode: "openclaw", marketUrl }, error: null });
      print(out);
      return;
    }

    const order = await placeOrder({
      marketId: norm.marketId,
      marketSlug: norm.marketSlug,
      side: norm.side,
      amountUsd: norm.amountUsd,
      expectedPrice: norm.expectedPrice
    });
    logEvent({ signal, validation, orderRequest: norm, orderResult: order, error: order.ok ? null : order.error });
    if (order.ok) {
      markTraded(norm.marketId, { side: norm.side, amountUsd: norm.amountUsd, status: "ok" });
      const out = { ok: true, traded: true, marketId: norm.marketId, side: norm.side, amountUsd: norm.amountUsd, validation, order };
      print(out);
    } else {
      const out = { ok: false, error: order.error ?? "order_failed", validation, order };
      print(out, 1);
    }
  } catch (err) {
    const out = { ok: false, error: err?.message ?? String(err) };
    logEvent({ signal: null, error: out.error });
    print(out, 1);
  }
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  await main();
}
