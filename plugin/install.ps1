param(
  [string]$ProfileDir = (Join-Path $env:USERPROFILE ".dsh\profiles\desktop"),
  [string]$InstallDir = (Join-Path $env:LOCALAPPDATA "JSWJ-Draft\plugin"),
  [string]$SourceDir = $PSScriptRoot,
  [string]$AppId = "",
  [string]$AppSecret = "",
  [switch]$SkipProcessCheck
)

$ErrorActionPreference = "Stop"
$DepName = "@govy/dsh-plugin-jswj-draft"

function Info([string]$Message) {
  Write-Host "[JSWJ] $Message" -ForegroundColor Cyan
}

function Fail([string]$Message) {
  Write-Host "[JSWJ] $Message" -ForegroundColor Red
  exit 1
}

Info "技术文件起草插件安装器"
Info "安装目录：$InstallDir"

$running = Get-Process -Name "DeepSeek Harness" -ErrorAction SilentlyContinue
if ($running -and -not $SkipProcessCheck) {
  Fail "请先完全退出 DSH（不是最小化），再运行安装器。"
}

$profilePackage = Join-Path $ProfileDir "package.json"
if (-not (Test-Path $profilePackage)) {
  Fail "未找到 DSH profile：$ProfileDir。请确认 DSH 已安装并至少启动过一次。"
}
if (-not (Test-Path (Join-Path $SourceDir "package.json"))) {
  Fail "安装包不完整：$SourceDir 下没有 package.json。"
}

if (-not $AppId) {
  $AppId = Read-Host "请输入飞书应用「GO秘」的 appId"
}
if (-not $AppSecret) {
  $AppSecret = Read-Host "请输入 appSecret"
}
$AppId = ($AppId -replace '"', "").Trim()
$AppSecret = ($AppSecret -replace '"', "").Trim()
if (-not $AppId -or -not $AppSecret) {
  Fail "appId / appSecret 不能为空。"
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"

Info "1/4 复制插件文件"
New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
$sourceFull = (Resolve-Path $SourceDir).Path
$installFull = (Resolve-Path $InstallDir).Path
if ($sourceFull -ne $installFull) {
  Copy-Item -Path (Join-Path $SourceDir "*") -Destination $InstallDir -Recurse -Force
}

Info "2/4 登记 DSH bundle"
Copy-Item $profilePackage "$profilePackage.bak-$stamp" -Force
$pkg = Get-Content $profilePackage -Raw -Encoding UTF8 | ConvertFrom-Json
if (-not $pkg.PSObject.Properties["dependencies"]) {
  $pkg | Add-Member -NotePropertyName dependencies -NotePropertyValue (New-Object psobject)
}
$fileSpec = "file:" + ($InstallDir -replace "\\", "/")
$pkg.dependencies | Add-Member -Force -NotePropertyName $DepName -NotePropertyValue $fileSpec
if (-not $pkg.PSObject.Properties["dsh"]) {
  $pkg | Add-Member -NotePropertyName dsh -NotePropertyValue (New-Object psobject)
}
if (-not $pkg.dsh.PSObject.Properties["profile"]) {
  $pkg.dsh | Add-Member -NotePropertyName profile -NotePropertyValue (New-Object psobject)
}
$bundles = @($pkg.dsh.profile.bundles)
if ($bundles -notcontains $DepName) {
  $bundles += $DepName
}
$pkg.dsh.profile | Add-Member -Force -NotePropertyName bundles -NotePropertyValue $bundles
$json = $pkg | ConvertTo-Json -Depth 20
[IO.File]::WriteAllText($profilePackage, $json, (New-Object Text.UTF8Encoding($false)))

Info "3/4 建立本地依赖链接"
$scopeDir = Join-Path $ProfileDir "node_modules\@govy"
New-Item -ItemType Directory -Path $scopeDir -Force | Out-Null
$linkPath = Join-Path $scopeDir "dsh-plugin-jswj-draft"
if (Test-Path $linkPath) {
  cmd /c rmdir "$linkPath" > $null 2>&1
  if (Test-Path $linkPath) {
    Fail "无法替换已有目录：$linkPath。请手动删除后重试。"
  }
}
cmd /c mklink /J "$linkPath" "$InstallDir" > $null 2>&1
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $linkPath)) {
  Copy-Item -Path $InstallDir -Destination $linkPath -Recurse -Force
}

Info "4/4 写入 GO秘 配置"
$profilePatch = Join-Path $ProfileDir "cordis.patch.yml"
if (-not (Test-Path $profilePatch)) {
  New-Item -ItemType File -Path $profilePatch -Force | Out-Null
}
Copy-Item $profilePatch "$profilePatch.bak-$stamp" -Force
$lines = @(Get-Content $profilePatch -Encoding UTF8)
$kept = New-Object System.Collections.Generic.List[string]
$skip = $false
foreach ($line in $lines) {
  if ($line -match "^- id:\s*jswj-draft\s*$") {
    $skip = $true
    continue
  }
  if ($skip -and $line -match "^- id:") {
    $skip = $false
  }
  if (-not $skip) {
    $kept.Add($line)
  }
}
$block = @(
  "",
  "# 技术文件起草（JSWJ_DraftbyDSH）",
  "- id: jswj-draft",
  "  config:",
  "    appId: `"$AppId`"",
  "    appSecret: `"$AppSecret`"",
  "    spaceId: `"7698962670346636559`"",
  "    rootToken: `"`"",
  "    draftRootToken: `"K3NpwxFzribxgOkzFxaczeH7nXf`"",
  "    wikiBaseUrl: `"https://govy.feishu.cn`"",
  "    wikiHomeUrl: `"https://govy.feishu.cn/wiki/Arv4wKueCiTuS3kddZrcwGHvnOb`"",
  "    summaryWikiToken: `"P77ZwJyDIiIfoJkmUVccrk7mnfc`"",
  "    pythonPath: `"`"",
  "    outputDir: `"`""
)
$all = @($kept) + $block
[IO.File]::WriteAllLines($profilePatch, $all, (New-Object Text.UTF8Encoding($false)))

Write-Host ""
Info "安装完成。"
Info "插件目录：$InstallDir"
Info "profile：$ProfileDir"
Info "请重新打开 DSH，左侧会出现「技术文件起草」。"
Info "首次进入如提示自检，点「插件自检」；红色项按提示补凭据。"
exit 0
