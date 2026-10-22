$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$base = Split-Path -Parent $root
$plugin = Join-Path $base "plugin\jswj-draft"
$package = Get-Content (Join-Path $plugin "package.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$version = $package.version
$dist = Join-Path $root "dist"
$staging = Join-Path $dist "jswj-draft"
$zip = Join-Path $dist ("jswj-draft-plugin-{0}.zip" -f $version)

if (-not (Test-Path $plugin)) { throw "找不到插件目录：$plugin" }
if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
if (Test-Path $zip) { Remove-Item $zip -Force }
New-Item -ItemType Directory -Path $staging -Force | Out-Null

Copy-Item (Join-Path $plugin "*") $staging -Recurse -Force
Remove-Item (Join-Path $staging "node_modules") -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $staging "dist") -Recurse -Force -ErrorAction SilentlyContinue

Compress-Archive -Path (Join-Path $staging "*") -DestinationPath $zip -CompressionLevel Optimal

Write-Output ("version: {0}" -f $version)
Write-Output ("output: {0}" -f $zip)
Write-Output ("size: {0:N1} MB" -f ((Get-Item $zip).Length / 1MB))
