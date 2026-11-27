# Creates every service's SSM parameter inside YOUR local Floci (owner: Jana)
# Run from the repo root AFTER `docker compose up -d`:
#     .\scripts\floci-ssm.ps1
# It reads DATABASE_URL from each service's own .env (never committed), so no password
# is ever stored in this script or in GitHub. Services without a .env are skipped.

$ErrorActionPreference = "Stop"

# 1. Talk to Floci, not real AWS (only for this script)
$env:AWS_ENDPOINT_URL      = "http://localhost:4566"
$env:AWS_ACCESS_KEY_ID     = "test"
$env:AWS_SECRET_ACCESS_KEY = "test"
$env:AWS_DEFAULT_REGION    = "eu-central-1"

$account = aws sts get-caller-identity --query Account --output text
if ($account -ne "000000000000") {
    Write-Host "Not talking to Floci (account $account). Is Floci running? Stopping." -ForegroundColor Red
    exit 1
}

# 2. One parameter per service, same names as in each template.yaml
foreach ($svc in @("catalogue", "booking", "inspection")) {
    $envFile = Join-Path "services/$svc" ".env"
    if (-not (Test-Path $envFile)) {
        Write-Host "skip  $svc  (no services/$svc/.env on this laptop)" -ForegroundColor Yellow
        continue
    }

    $line = Get-Content $envFile | Where-Object { $_ -match '^\s*DATABASE_URL\s*=' } | Select-Object -First 1
    if (-not $line) {
        Write-Host "skip  $svc  (no DATABASE_URL in its .env)" -ForegroundColor Yellow
        continue
    }
    $value = ($line -split '=', 2)[1].Trim().Trim('"').Trim("'")

    $name = "/car-rental/$svc/database-url"
    aws ssm put-parameter --name $name --type SecureString --value $value --overwrite | Out-Null
    Write-Host "set   $name  (SecureString)" -ForegroundColor Green
}

# 3. Show what exists now (names only, never the values)
aws ssm describe-parameters --query "Parameters[].[Name,Type]" --output table
