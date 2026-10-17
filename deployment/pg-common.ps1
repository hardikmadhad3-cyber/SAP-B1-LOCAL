# Shared by the backup and restore scripts: the database from backend/.env and
# the PostgreSQL client tools.

function Get-ErpDatabase([string]$root) {
  $envFile = Join-Path $root 'backend\.env'
  if (-not (Test-Path -LiteralPath $envFile)) { throw "Missing $envFile." }
  $line = Get-Content -LiteralPath $envFile | Where-Object { $_ -match '^\s*DATABASE_URL\s*=' } | Select-Object -First 1
  if (-not $line) { throw 'DATABASE_URL is not set in backend\.env.' }
  $uri = [System.Uri](($line -replace '^\s*DATABASE_URL\s*=\s*', '').Trim().Trim('"'))
  $credentials = $uri.UserInfo.Split(':', 2)
  [pscustomobject]@{
    Host = $uri.Host
    Port = if ($uri.Port -gt 0) { $uri.Port } else { 5432 }
    User = [System.Uri]::UnescapeDataString($credentials[0])
    Password = if ($credentials.Count -gt 1) { [System.Uri]::UnescapeDataString($credentials[1]) } else { '' }
    Name = $uri.AbsolutePath.TrimStart('/')
  }
}

# PG_BIN in the environment, else the newest PostgreSQL under Program Files.
function Get-PgBin {
  if ($env:PG_BIN -and (Test-Path (Join-Path $env:PG_BIN 'pg_dump.exe'))) { return $env:PG_BIN }
  $candidates = Get-ChildItem -Path (Join-Path $env:ProgramFiles 'PostgreSQL') -Directory -ErrorAction SilentlyContinue |
    Sort-Object { [int]($_.Name -replace '\D', '0') } -Descending |
    ForEach-Object { Join-Path $_.FullName 'bin' } |
    Where-Object { Test-Path (Join-Path $_ 'pg_dump.exe') }
  if (-not $candidates) { throw 'PostgreSQL client tools (pg_dump) not found. Set PG_BIN to the PostgreSQL bin folder.' }
  return @($candidates)[0]
}
