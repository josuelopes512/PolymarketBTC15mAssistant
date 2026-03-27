$ErrorActionPreference = "Stop"
node src/autoTrade.js
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
