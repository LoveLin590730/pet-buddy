# ============================================================================
# pet-buddy 安装/同步脚本
# ----------------------------------------------------------------------------
# 把源码仓构建出的产物同步到宿主的插件目录（宿主只认这个位置，别再手改那边）。
# 素材位置：宿主对 /_plugins/<id>/ 只服务**插件根级文件**（子目录一律 404，v3.1.0 实测），
#           所以素材平铺在插件根目录；同一份清单 assets.manifest.json 也用于打包与自检。
# 用法：
#   powershell -ExecutionPolicy Bypass -File tools\install.ps1              构建 + 校验 + 同步（产物与说明）
#   powershell -ExecutionPolicy Bypass -File tools\install.ps1 -CheckOnly   只校验，不动文件
#   powershell -ExecutionPolicy Bypass -File tools\install.ps1 -WithAssets  连素材一起同步
#   powershell -ExecutionPolicy Bypass -File tools\install.ps1 -Dest "<插件目录>"   指定目标目录
# ============================================================================
param(
  [string]$Dest = "$env:LOCALAPPDATA\Programs\坚祥数字助理GO\插件兼容层\pet-buddy",
  [switch]$CheckOnly,
  [switch]$WithAssets
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$RUNTIME = @('client.js', 'chat.html', 'client.css', 'manifest.json')
$DOCS = @('icon.png', 'LICENSE-dspet.txt', 'README.md', 'CHANGELOG.md', 'LICENSE', 'assets.manifest.json')
function Get-AssetFiles {
  $mf = Get-Content (Join-Path $root 'assets.manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  return @($mf.groups | ForEach-Object { $_.files })
}
function Say($msg, $color = 'Gray') { Write-Host $msg -ForegroundColor $color }

Push-Location $root
try {
  # 1) 产物必须与源码一致；素材清单里的文件必须齐全
  Say "[1/4] 校验产物与 src/ 是否一致…"
  node build.mjs --check
  if ($LASTEXITCODE -ne 0) {
    if ($CheckOnly) { throw '产物与源码不一致：先在本仓库根运行 `node build.mjs`' }
    Say '      产物过期，正在重新构建…' Yellow
    node build.mjs
    if ($LASTEXITCODE -ne 0) { throw 'build.mjs 构建失败' }
  }
  foreach ($f in $RUNTIME) { if (-not (Test-Path $f)) { throw "缺少产物：$f" } }
  $assetFiles = Get-AssetFiles
  foreach ($f in $assetFiles) { if (-not (Test-Path $f)) { throw "素材清单里列的文件不存在：$f" } }
  Say ("      素材清单 assets.manifest.json：" + $assetFiles.Count + ' 个文件齐全') Green

  # 2) 目标目录
  Say "[2/4] 目标插件目录：$Dest"
  if (-not (Test-Path $Dest)) {
    if ($CheckOnly) { throw "目标目录不存在：$Dest" }
    New-Item -ItemType Directory -Path $Dest -Force | Out-Null
    Say '      目录不存在，已新建（首次安装）' Yellow
  }

  # 3) 备份将被覆盖的文件
  $sync = @($RUNTIME + $DOCS) | Select-Object -Unique
  if ($WithAssets) { $sync = @($sync + $assetFiles) | Select-Object -Unique }
  if (-not $CheckOnly) {
    $backup = Join-Path $root "dist\backup-$stamp"
    New-Item -ItemType Directory -Path $backup -Force | Out-Null
    $n = 0
    foreach ($f in $sync) {
      $t = Join-Path $Dest $f
      if (Test-Path $t) { Copy-Item $t (Join-Path $backup $f) -Force; $n++ }
    }
    Say "[3/4] 已备份现有文件 $n 个到 dist\backup-$stamp（回滚：把里面的文件拷回插件目录即可）"
  } else {
    Say '[3/4] 只校验模式：跳过备份与写入'
  }

  # 4) 同步
  if (-not $CheckOnly) {
    foreach ($f in $sync) {
      if (Test-Path $f) { Copy-Item $f (Join-Path $Dest $f) -Force }
    }
    $msg = "[4/4] 已同步：" + ($RUNTIME + $DOCS -join ', ')
    if ($WithAssets) {
      $msg += "；素材 $($assetFiles.Count) 个"
    } else {
      $msg += "（素材未动：需要时加 -WithAssets）"
    }
    Say $msg Green
  } else {
    Say '[4/4] 校验通过，未改动任何文件' Green
  }
  Say ''
  Say '下一步：在助手窗口按 F5 刷新，桌宠即用新版本（右键 → 窗口聊天可开聊天窗口）。' Cyan
} finally {
  Pop-Location
}
