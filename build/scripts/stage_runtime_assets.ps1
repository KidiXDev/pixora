Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$binDir = Join-Path $root 'bin'

$sourceBackend = Join-Path $root 'backend'
$targetBackend = Join-Path $binDir 'backend'

New-Item -ItemType Directory -Path $targetBackend -Force | Out-Null

function Copy-DirectoryWithoutVenv {
  param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Target
  )

  New-Item -ItemType Directory -Path $Target -Force | Out-Null

  $excludeDirs = @(Get-ChildItem -LiteralPath $Source -Recurse -Directory -Force |
      Where-Object { $_.Name -ieq 'venv' -or $_.Name -ieq '.venv' } |
      Select-Object -ExpandProperty FullName)

  $robocopyArgs = @(
    $Source
    $Target
    '/E'
    '/NFL'
    '/NDL'
    '/NJH'
    '/NJS'
    '/NP'
  )

  if ($excludeDirs.Count -gt 0) {
    $robocopyArgs += '/XD'
    $robocopyArgs += $excludeDirs
  }

  & robocopy @robocopyArgs | Out-Null
  if ($LASTEXITCODE -gt 7) {
    throw "robocopy failed with exit code $LASTEXITCODE while copying $Source"
  }
}

$backendFolders = @('workflow', 'ext', 'node')
foreach ($folder in $backendFolders) {
  $sourcePath = Join-Path $sourceBackend $folder
  $targetPath = Join-Path $targetBackend $folder

  if (Test-Path $targetPath) {
    Remove-Item -Recurse -Force $targetPath
  }

  if (Test-Path $sourcePath) {
    if ($folder -eq 'node') {
      Copy-DirectoryWithoutVenv -Source $sourcePath -Target $targetPath
    } else {
      Copy-Item -Recurse -Force $sourcePath $targetPath
    }
  } else {
    Write-Warning "Skipping missing source folder: $sourcePath"
  }
}

$sourceData = Join-Path $root 'data'
$targetData = Join-Path $binDir 'data'

if (Test-Path $targetData) {
  Remove-Item -Recurse -Force $targetData
}
New-Item -ItemType Directory -Path $targetData -Force | Out-Null

if (Test-Path $sourceData) {
  $directories = Get-ChildItem -Path $sourceData -Directory -Recurse
  foreach ($directory in $directories) {
    $relative = $directory.FullName.Substring($sourceData.Length).TrimStart('\', '/')
    if ([string]::IsNullOrWhiteSpace($relative)) {
      continue
    }
    $targetPath = Join-Path $targetData $relative
    New-Item -ItemType Directory -Path $targetPath -Force | Out-Null
  }
} else {
  Write-Warning "Skipping missing source folder: $sourceData"
}

Write-Host "Staged runtime assets into $binDir"
