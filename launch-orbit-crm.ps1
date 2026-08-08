$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSCommandPath
$nodePath = "C:\Users\Admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
$serverScript = Join-Path $projectRoot "node_modules\vinext\dist\cli.js"
$localUrl = "http://localhost:3000"

if (-not (Test-Path -LiteralPath $nodePath)) {
    throw "The local Node runtime could not be found."
}

if (-not (Test-Path -LiteralPath $serverScript)) {
    throw "The dashboard dependencies are missing."
}

$localServer = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
if (-not $localServer) {
    Start-Process -FilePath $nodePath -ArgumentList $serverScript, "dev", "--host", "127.0.0.1" -WorkingDirectory $projectRoot -WindowStyle Hidden

    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        Start-Sleep -Milliseconds 250
        if (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue) {
            break
        }
    }

    if (-not (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue)) {
        throw "The local dashboard server could not start."
    }
}

Start-Process $localUrl
