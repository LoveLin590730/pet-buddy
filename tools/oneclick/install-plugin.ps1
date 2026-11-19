# ============================================================================
# pet-buddy 一键安装脚本（发布包 / 单文件安装器内部调用）
# ----------------------------------------------------------------------------
# 做四件事：找宿主 → 校验来源 → 备份旧版本 → 镜像复制到宿主插件目录。
# 特点：不需要管理员权限、不需要 Node、不需要联网；装完提示按 F5 刷新助手。
# 用法（一般由「安装.cmd」双击触发，也可手动）：
#   powershell -ExecutionPolicy Bypass -File install-plugin.ps1 -Source ".\pet-buddy"
#   powershell -ExecutionPolicy Bypass -File install-plugin.ps1 -Source ".\pet-buddy" -Dest "D:\...\插件兼容层"
#   powershell -ExecutionPolicy Bypass -File install-plugin.ps1 -Uninstall
# 退出码：0 成功；1 失败（来源不完整/复制失败）；2 找不到宿主安装目录
# ============================================================================
param(
  [string]$Source = (Join-Path $PSScriptRoot 'pet-buddy'),
  [string]$Dest = '',
  [switch]$Uninstall
)
$ErrorActionPreference = 'Stop'
$PLUGIN_ID = 'pet-buddy'
$HOST_EXE = '坚祥数字助理GO.exe'

function Say($msg, $color = 'Gray') { Write-Host $msg -ForegroundColor $color }
function Fail($msg) { Say ''; Say $msg 'Red'; exit 1 }

# ---------- 1) 找宿主的「插件兼容层」目录 ----------
function Find-HostRoot {
  $cands = @()
  if ($env:LOCALAPPDATA) {
    $cands += (Join-Path $env:LOCALAPPDATA 'Programs\坚祥数字助理GO')
    $prog = Join-Path $env:LOCALAPPDATA 'Programs'
    if (Test-Path $prog) {
      foreach ($d in Get-ChildItem $prog -Directory -ErrorAction SilentlyContinue) {
        $cands += $d.FullName
      }
    }
  }
  foreach ($c in ($cands | Select-Object -Unique)) {
    if (Test-Path (Join-Path $c $HOST_EXE)) { return $c }
  }
  return ''
}

if ($Uninstall) {
  $hostRoot = Find-HostRoot
  $plugins = if ($Dest) { $Dest } elseif ($hostRoot) { Join-Path $hostRoot '插件兼容层' } else { '' }
  if (-not $plugins) { Say "找不到助手安装目录（没找到 $HOST_EXE）。" 'Red'; exit 2 }
  $target = Join-Path $plugins $PLUGIN_ID
  if (-not (Test-Path $target)) { Say "没有装过 $PLUGIN_ID（$target 不存在）。" 'Yellow'; exit 0 }
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $removed = Join-Path $env:TEMP "$PLUGIN_ID-removed-$stamp"
  Move-Item $target $removed -Force
  Say "已卸载：插件目录已移到 $removed（以后想恢复，把它移回 $plugins 即可）" Green
  Say '在助手窗口按 F5 刷新，桌宠就不见了。' Cyan
  exit 0
}

Say '================ pet-buddy 一键安装 ================' 'Cyan'

# ---------- 2) 校验来源 ----------
if (-not (Test-Path $Source)) { Fail "来源目录不存在：$Source" }
foreach ($f in @('manifest.json', 'client.js', 'chat.html', 'client.css')) {
  if (-not (Test-Path (Join-Path $Source $f))) { Fail "来源目录不完整，缺少 $f（是不是把安装包解压丢了？）" }
}
$mf = Get-Content (Join-Path $Source 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
Say ("来源：$Source（" + $mf.name + ' v' + $mf.version + '）')

# ---------- 3) 找目标 ----------
$hostRoot = Find-HostRoot
$plugins = if ($Dest) { $Dest } elseif ($hostRoot) { Join-Path $hostRoot '插件兼容层' } else { '' }
if (-not $plugins) {
  Say ''; Say '没找到「坚祥数字助理GO」的安装目录。' 'Red'
  Say '  ① 请先安装「坚祥数字助理GO」（默认装在 用户目录\AppData\Local\Programs\坚祥数字助理GO）；'
  Say '  ② 或者手动指定宿主插件目录，例如：'
  Say '     powershell -ExecutionPolicy Bypass -File install-plugin.ps1 -Source ".\pet-buddy" -Dest "…\插件兼容层"'
  Say ''
  Say '  手动装法：把安装包里的 pet-buddy 整个文件夹，拷到 助手安装目录\插件兼容层\ 下，'
  Say '            目录名保持 pet-buddy，然后在助手窗口按 F5 刷新。'
  exit 2
}
if (-not $hostRoot -and -not $Dest) { exit 2 }
if (-not (Test-Path $plugins)) { New-Item -ItemType Directory -Path $plugins -Force | Out-Null }
$target = Join-Path $plugins $PLUGIN_ID
Say "目标：$target"

# ---------- 4) 备份旧版本 ----------
if (Test-Path $target) {
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $backup = Join-Path $env:TEMP "$PLUGIN_ID-backup-$stamp"
  Copy-Item $target $backup -Recurse -Force
  Say "已备份旧版本到：$backup" Yellow
}

# ---------- 5) 镜像复制（robocopy：目标与来源完全一致，不会留旧版残余文件） ----------
if (-not (Test-Path $target)) { New-Item -ItemType Directory -Path $target -Force | Out-Null }
$rc = Start-Process -FilePath 'robocopy' -ArgumentList @($Source, $target, '/MIR', '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/R:1', '/W:1') -Wait -PassThru -WindowStyle Hidden
if ($rc.ExitCode -ge 8) { Fail "复制失败（robocopy 退出码 $($rc.ExitCode)）" }

# ---------- 6) 汇报 ----------
$files = Get-ChildItem $target -Recurse -File
$size = [math]::Round(($files | Measure-Object -Property Length -Sum).Sum / 1MB, 1)
Say ''
Say ("[OK] 装好了：" + $mf.name + ' v' + $mf.version + "（$($files.Count) 个文件，$size MB）") Green
Say "   位置：$target"
Say ''
Say '下一步：切到助手窗口按 F5 刷新 → 桌宠出现，右键可开菜单。' Cyan
exit 0
