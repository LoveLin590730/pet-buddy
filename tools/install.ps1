# ============================================================================
# pet-buddy 安装/同步脚本
# ----------------------------------------------------------------------------
# 把源码仓构建出的产物同步到宿主的插件目录（宿主只认这个位置，别再手改那边）。
# 用法：
#   powershell -ExecutionPolicy Bypass -File tools\install.ps1              构建 + 校验 + 同步
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
$ASSETS = @('icon.png', 'LICENSE-dspet.txt', 'README.md', 'CHANGELOG.md', 'LICENSE')

function Say($msg, $color = 'Gray') { Write-Host $msg -ForegroundColor $color }

Push-Location $root
try {
  # 1) 产物必须与源码一致
  Say "[1/4] 校验产物与 src/ 是否一致…"
  node build.mjs --check
  if ($LASTEXITCODE -ne 0) {
    if ($CheckOnly) { throw '产物与源码不一致：先在本仓库根运行 `node build.mjs`' }
    Say '      产物过期，正在重新构建…' Yellow
    node build.mjs
    if ($LASTEXITCODE -ne 0) { throw 'build.mjs 构建失败' }
  }
  foreach ($f in $RUNTIME) { if (-not (Test-Path $f)) { throw "缺少产物：$f" } }

  # 2) 目标目录
  Say "[2/4] 目标插件目录：$Dest"
  if (-not (Test-Path $Dest)) {
    if ($CheckOnly) { throw "目标目录不存在：$Dest" }
    New-Item -ItemType Directory -Path $Dest -Force | Out-Null
    Say '      目录不存在，已新建（首次安装）' Yellow
  }

  # 3) 备份将被覆盖的文件
  $backup = Join-Path $root "dist\backup-$stamp"
  $overwrite = $RUNTIME + ($(if ($WithAssets) { $ASSETS + (Get-ChildItem $Dest -Filter '*.webp' -Name) } else { @() }))
  if (-not $CheckOnly) {
    New-Item -ItemType Directory -Path $backup -Force | Out-Null
    foreach ($f in $overwrite) {
      $t = Join-Path $Dest $f
      if (Test-Path $t) { Copy-Item $t (Join-Path $backup $f) -Force }
    }
    Say "[3/4] 已备份现有文件到 dist\backup-$stamp（回滚：把它们拷回插件目录即可）"
  } else {
    Say '[3/4] 只校验模式：跳过备份与写入'
  }

  # 4) 同步
  if (-not $CheckOnly) {
    foreach ($f in $overwrite) {
      $t = Join-Path $Dest $f
      if (Test-Path $f) { Copy-Item $f $t -Force }
    }
    # 素材默认保留目标目录现有文件；-WithAssets 时全量同步
    if ($WithAssets) {
      Copy-Item (Join-Path $root '*.webp') $Dest -Force
      Copy-Item (Join-Path $root '*.png')  $Dest -Force
    }
    Say "[4/4] 已同步：$($overwrite -join ', ')" Green
  } else {
    Say '[4/4] 校验通过，未改动任何文件' Green
  }
  Say ''
  Say '下一步：在助手窗口按 F5 刷新，桌宠即用新版本（右键 → 窗口聊天可开聊天窗口）。' Cyan
} finally {
  Pop-Location
}
