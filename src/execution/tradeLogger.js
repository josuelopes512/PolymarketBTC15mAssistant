import fs from "node:fs";
import path from "node:path";

function filePath() {
  const dir = path.join(process.cwd(), "logs");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "trades.jsonl");
}

export function logEvent({ signal = null, validation = null, orderRequest = null, orderResult = null, error = null }) {
  const rec = {
    timestamp: new Date().toISOString(),
    signal,
    validation,
    orderRequest,
    orderResult,
    error: error ? String(error) : null
  };
  fs.appendFileSync(filePath(), JSON.stringify(rec) + "\n", "utf8");
}
