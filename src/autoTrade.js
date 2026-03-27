import "dotenv/config";
import { runDecisionCycle } from "./decisionRunner.js";
import { validateTrade } from "./execution/validateTrade.js";
import { placeOrder } from "./execution/placeOrder.js";
import { hasTraded, markTraded } from "./execution/tradeState.js";
import { logEvent } from "./execution/tradeLogger.js";

function print(obj, code = 0) {
  process.stdout.write(JSON.stringify(obj));
  process.stdout.write("\n");
  if (!obj.ok) process.exitCode = 1;
  if (code) process.exitCode = code;
}

async function main() {
  try {
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

await main();
