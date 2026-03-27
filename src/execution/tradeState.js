import fs from "node:fs";
import path from "node:path";

function filePath() {
  const dir = path.join(process.cwd(), "logs");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "traded-markets.json");
}

function readAll() {
  try {
    const raw = fs.readFileSync(filePath(), "utf8");
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeAll(arr) {
  fs.writeFileSync(filePath(), JSON.stringify(arr, null, 2), "utf8");
}

export function hasTraded(marketId) {
  const arr = readAll();
  return arr.some((x) => String(x.marketId) === String(marketId));
}

export function markTraded(marketId, metadata) {
  const arr = readAll();
  arr.push({
    timestamp: new Date().toISOString(),
    marketId: String(marketId),
    ...metadata
  });
  writeAll(arr);
}
