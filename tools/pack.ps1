# ============================================================================
# pet-buddy 打包脚本（社区/市场发布物）
# ----------------------------------------------------------------------------
# 产出 dist\pet-buddy-v<版本>.zip：包根 = 插件目录，装到 插件兼容层\ 下即用。
# 用法：
#   powershell -ExecutionPolicy Bypass -File tools\pack.ps1                打包（运行必需文件 + 说明/许可）
#   powershell -ExecutionPolicy Bypass -File tools\pack.ps1 -WithSource    连源码（src/、build.mjs、tools/）一起打
# ============================================================================
param(
  [string]$OutDir = 'dist',
  [switch]$WithSource
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Push-Location $root
try {
  node build.mjs --check
  if ($LASTEXITCODE -ne 0) { throw '产物与源码不一致：先运行 `node build.mjs`' }
  $mf = Get-Content 'manifest.json' -Raw -Encoding UTF8 | ConvertFrom-Json
  $ver = $mf.version
  $stage = Join-Path $env:TEMP ('petbuddy-pack-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $stage -Force | Out-Null

  # 运行必需 + 说明/许可 + 素材
  Copy-Item client.js, chat.html, client.css, manifest.json, icon.png -Destination $stage
  Copy-Item README.md, CHANGELOG.md, LICENSE, LICENSE-dspet.txt -Destination $stage -ErrorAction SilentlyContinue
  Copy-Item *.webp, *.png -Destination $stage -Force
  if ($WithSource) {
    foreach ($d in 'src', 'tools') { Copy-Item $d -Destination $stage -Recurse -Force }
    Copy-Item build.mjs, .gitignore -Destination $stage -Force -ErrorAction SilentlyContinue
  }

  if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir | Out-Null }
  $zip = Join-Path $OutDir "pet-buddy-v$ver.zip"
  if (Test-Path $zip) { Remove-Item $zip -Force }
  Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -CompressionLevel Optimal
  Remove-Item $stage -Recurse -Force

  $size = [math]::Round((Get-Item $zip).Length / 1KB, 1)
  Write-Host "已打包：$zip（$size KB，版本 $ver）" -ForegroundColor Green
  Write-Host '包根 = 插件目录：解压到 …\坚祥数字助理GO\插件兼容层\ 下（目录名 pet-buddy），刷新助手即用。' -ForegroundColor Cyan
} finally {
  Pop-Location
}
