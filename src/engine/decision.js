import { applyTimeAwareness, scoreDirection } from "./probability.js";
import { computeEdge, decide } from "./edge.js";

export function computeDecision(snapshot) {
  const {
    price,
    vwap,
    vwapSlope,
    rsi,
    rsiSlope,
    macd,
    heikenColor,
    heikenCount,
    failedVwapReclaim,
    timeLeftMin,
    candleWindowMinutes,
    marketUp,
    marketDown
  } = snapshot ?? {};

  const scored = scoreDirection({
    price: price ?? null,
    vwap: vwap ?? null,
    vwapSlope: vwapSlope ?? null,
    rsi: rsi ?? null,
    rsiSlope: rsiSlope ?? null,
    macd: macd ?? null,
    heikenColor: heikenColor ?? null,
    heikenCount: heikenCount ?? null,
    failedVwapReclaim: failedVwapReclaim ?? null
  });

  const timeAware = applyTimeAwareness(
    scored.rawUp,
    timeLeftMin ?? 0,
    candleWindowMinutes ?? 1
  );

  const edge = computeEdge({
    modelUp: timeAware.adjustedUp,
    modelDown: timeAware.adjustedDown,
    marketYes: marketUp ?? null,
    marketNo: marketDown ?? null
  });

  const rec = decide({
    remainingMinutes: timeLeftMin ?? 0,
    edgeUp: edge.edgeUp,
    edgeDown: edge.edgeDown,
    modelUp: timeAware.adjustedUp,
    modelDown: timeAware.adjustedDown
  });

  return {
    action: rec.action,
    side: rec.side ?? null,
    phase: rec.phase,
    strength: rec.strength ?? null,
    edgeUp: edge.edgeUp,
    edgeDown: edge.edgeDown,
    modelUp: timeAware.adjustedUp,
    modelDown: timeAware.adjustedDown
  };
}
