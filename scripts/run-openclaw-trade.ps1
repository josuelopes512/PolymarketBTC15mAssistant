$ErrorActionPreference = "Stop"
$env:EXECUTION_MODE = "openclaw"
node src/autoTrade.js --mode openclaw
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
