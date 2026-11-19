# ============================================================================
# pet-buddy 一键封装（给同事的安装形态）
# ----------------------------------------------------------------------------
# 产出两个东西（都在 dist\ 下）：
#   ① pet-buddy-v<版本>-一键安装.zip —— 解压后双击「安装.cmd」即装（含卸载.cmd 与安装说明.txt）
#   ② 一键安装-pet-buddy-v<版本>.cmd —— 单文件自解压安装器，双击即装（发给别人就发这一个文件）
# 两者内容一致：装到 宿主\插件兼容层\pet-buddy（自动找宿主、自动备份旧版、robocopy 镜像复制）。
# 不需要管理员权限，也不需要对方装 Node —— 只有本脚本（打包含）需要本机的 node。
# 用法：
#   powershell -ExecutionPolicy Bypass -File tools\pack-oneclick.ps1
# ============================================================================
param(
  [string]$OutDir = 'dist'
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Push-Location $root
try {
  node build.mjs --check
  if ($LASTEXITCODE -ne 0) { throw '产物与源码不一致：先运行 `node build.mjs`' }
  $mf = Get-Content 'manifest.json' -Raw -Encoding UTF8 | ConvertFrom-Json
  $ver = $mf.version
  $assets = @((Get-Content 'assets.manifest.json' -Raw -Encoding UTF8 | ConvertFrom-Json).groups | ForEach-Object { $_.files })
  foreach ($f in $assets) { if (-not (Test-Path $f)) { throw "素材清单里列的文件不存在：$f" } }

  # ---------- 组装配送目录 ----------
  $stage = Join-Path $env:TEMP ('petbuddy-oneclick-' + [guid]::NewGuid().ToString('N'))
  $plug = Join-Path $stage 'pet-buddy'
  New-Item -ItemType Directory -Path $plug -Force | Out-Null
  Copy-Item client.js, chat.html, client.css, manifest.json, icon.png -Destination $plug
  Copy-Item README.md, CHANGELOG.md, LICENSE, LICENSE-dspet.txt, LICENSE-deepseekpet.txt, LICENSE-bongocat.txt, LICENSE-community-pets.txt, assets.manifest.json -Destination $plug
  foreach ($f in $assets) { Copy-Item $f $plug -Force }
  $oc = Join-Path $root 'tools\oneclick'
  Copy-Item (Join-Path $oc 'install-plugin.ps1') $stage -Force
  Copy-Item (Join-Path $oc '安装.cmd') $stage -Force
  Copy-Item (Join-Path $oc '卸载.cmd') $stage -Force
  Copy-Item (Join-Path $oc '安装说明.txt') $stage -Force

  # 安装脚本硬性检查：安装包里的 pet-buddy 必须自洽
  foreach ($f in @('manifest.json', 'client.js', 'chat.html', 'client.css')) {
    if (-not (Test-Path (Join-Path $plug $f))) { throw "配送目录缺少 $f" }
  }

  if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir | Out-Null }

  # ---------- ① 一键安装包（zip） ----------
  $zip = Join-Path $OutDir "pet-buddy-v$ver-一键安装.zip"
  if (Test-Path $zip) { Remove-Item $zip -Force }
  Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -CompressionLevel Optimal

  # ---------- ② 单文件安装器（cmd 自解压：zip 以 base64 内联在末尾） ----------
  $b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($zip))
  $sb = New-Object System.Text.StringBuilder
  for ($i = 0; $i -lt $b64.Length; $i += 76) { [void]$sb.Append($b64.Substring($i, [Math]::Min(76, $b64.Length - $i))).Append("`r`n") }
  $head = (Get-Content (Join-Path $oc '单文件安装器-头部.cmd') -Raw -Encoding Default) -replace '__VER__', $ver
  $single = Join-Path $OutDir "一键安装-pet-buddy-v$ver.cmd"
  [IO.File]::WriteAllText($single, $head + $sb.ToString(), [Text.Encoding]::GetEncoding(936))

  Remove-Item $stage -Recurse -Force

  $zKB = [math]::Round((Get-Item $zip).Length / 1KB, 1)
  $cMB = [math]::Round((Get-Item $single).Length / 1MB, 2)
  Write-Host "① 一键安装包：$zip（$zKB KB）" -ForegroundColor Green
  Write-Host "② 单文件安装器：$single（$cMB MB，双击即装）" -ForegroundColor Green
  Write-Host '   装到 用户目录\AppData\Local\Programs\坚祥数字助理GO\插件兼容层\pet-buddy，装完按 F5 刷新助手。' -ForegroundColor Cyan
} finally {
  Pop-Location
}
