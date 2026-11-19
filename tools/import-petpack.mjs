#!/usr/bin/env node
/* ============================================================================
 * pet-buddy · 模型包导入器（tools/import-petpack.mjs）
 * ----------------------------------------------------------------------------
 * 把一个「桌宠模型包」（dsh-pet 格式的 zip：形象 + 一整套动作 + 交互配置）
 * 整合成 pet-buddy 能用的「动作包（petpack）」——不是挑一张图，而是整套搬进来：
 *
 *   1) 读 zip（复用 src/core/zipread.js，同一份 ZIP 解析真相源，零第三方依赖）
 *   2) 解析包内 assets/config.jsonc（JSONC：去注释）——拿到动画池与语义：
 *      idle / turn / drag / clicks / moves / categories / events(balance·whisper·workStatus)
 *      / sleep(三段) / baifan(玩法)
 *   3) 逐个动作 webm 转码成桌宠尺寸（ffmpeg：VP9-alpha，裁掉画面两侧空白、降到 160px/12fps/crf45）
 *      —— 114 个动作从 55MB 压到约 4.4MB（-92%）
 *   4) 素材平铺到插件根目录（宿主只服务根级文件）：<prefix>-001.webm …
 *   5) 生成 src/core/petpack.js 的数据段（动作清单 + 语义角色映射，标记内自动生成、勿手改）
 *   6) 更新 assets.manifest.json（新增素材组，供 install / pack / smoke 对账）
 *   7) 写导入记录（交付区与仓库各一份）：过程、参数、体积、画质、可复用说明
 *
 * 用法：
 *   node tools/import-petpack.mjs <模型包.zip> [选项]
 * 选项：
 *   --id dshpack          包 id（清单键、素材前缀默认取它）
 *   --name "…"            显示名（默认取包名）
 *   --prefix dp           素材文件前缀（默认 dp）
 *   --width 160           输出宽度 px（默认 160）
 *   --fps 12              输出帧率（默认 12）
 *   --crf 45              VP9 质量（默认 45，越小越清晰越大）
 *   --crop 0.62,0.92      居中裁剪比例（宽,高；默认 0.62,0.92，按 dsh-pet 素材规范「人物头顶 20%、脚底 85%」）
 *   --ffmpeg <path>       ffmpeg 可执行文件（默认自动探测：环境变量 PET_BUDDY_FFMPEG → imageio_ffmpeg → PATH）
 *   --dry-run             只解析包与生成清单，不转码、不写素材
 *   --force               覆盖已存在的素材文件（默认跳过已转好的，便于断点续跑）
 * ==========================================================================*/

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, copyFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const log = (...a) => console.log(...a);

/* core/petpack.js 的手写模板：运行时（DOM 无关的取值/挑选逻辑）+ 自动生成的数据段。
 * 首次导入时按本模板创建；之后每次导入只替换 DATA-START/END 之间的数据段。 */
const PETPACK_TEMPLATE = `/* ============================================================================
 * pet-buddy · 共享核心（core）· 宠物动作包（petpack）
 * ----------------------------------------------------------------------------
 * 「动作包」= 一整套动作视频（VP9-alpha webm，平铺在插件根目录，宿主只服务根级文件）
 *            + 语义角色映射（每个动作属于 idle / 点击 / 拖拽 / 余额档位 / 随机表演 / 睡觉…）。
 * 数据从模型包（dsh-pet 格式 zip：assets/webm + assets/config.jsonc）整合而来，
 * 由 tools/import-petpack.mjs 生成（含转码参数、体积、来源记录）——数据段勿手改，重跑脚本即可。
 * 本文件只放「取值与挑选」（DOM 无关，两端可用）；视频播放与调度在 pet.client.js 的 petpack 段。
 * 约束：只写顶层 const / function；不 import / 不 export。
 * ==========================================================================*/

  /* @@DATA@@ */

  /** 按 id 取动作包；没有返回 null */
  function petpackById(id) {
    return PETPACKS[id] || null;
  }

  /** 全部动作包（数组） */
  function petpackList() {
    return Object.keys(PETPACKS).map(function (k) { return PETPACKS[k]; });
  }

  /** 动作名 → 动作记录（含 file / role） */
  function petpackActionOf(pack, name) {
    if (!pack || !name) return null;
    for (let i = 0; i < pack.actions.length; i++) if (pack.actions[i].name === name) return pack.actions[i];
    return null;
  }

  /** 某角色的动作名池（数组）；balance / workStatus 这类分档池返回「数组的数组」 */
  function petpackRolePool(pack, role) {
    if (!pack || !pack.roles) return [];
    return pack.roles[role] || [];
  }

  /** 从角色池随机挑一个动作名（avoid = 刚播过的，尽量不连着重复）；池空返回 '' */
  function petpackPick(pack, role, avoid, rnd) {
    const pool = petpackRolePool(pack, role);
    if (!pool.length) return '';
    const r = (typeof rnd === 'number' && isFinite(rnd)) ? rnd : Math.random();
    if (pool.length === 1) return pool[0];
    let idx = Math.floor(Math.max(0, Math.min(0.999999, r)) * pool.length);
    if (pool[idx] === avoid) idx = (idx + 1) % pool.length;
    return pool[idx];
  }

  /** 分档池（如余额 6 档）按档位挑：pool 是数组的数组，index 越界则夹到最后一档 */
  function petpackPickTier(pack, role, tier, avoid, rnd) {
    const pool = petpackRolePool(pack, role);
    if (!pool.length) return '';
    const i = Math.max(0, Math.min(pool.length - 1, Math.round(Number(tier) || 0)));
    const seg = pool[i];
    if (!seg || !seg.length) return '';
    return petpackPick({ roles: { _t: seg }, pick: null }, '_t', avoid, rnd);
  }

  /** 随机表演池：{name, category} 数组（自带分类，供界面与权重用） */
  function petpackRandomPool(pack) {
    return (pack && pack.roles && pack.roles.random) || [];
  }

  /** 从随机表演池挑一个动作名（可按分类过滤；pool 过滤后为空则退回全量） */
  function petpackPickRandom(pack, category, avoid, rnd) {
    let pool = petpackRandomPool(pack);
    if (category) {
      const f = pool.filter(function (x) { return x.category === category; });
      if (f.length) pool = f;
    }
    if (!pool.length) return '';
    const r = (typeof rnd === 'number' && isFinite(rnd)) ? rnd : Math.random();
    const names = pool.map(function (x) { return x.name; });
    let idx = Math.floor(Math.max(0, Math.min(0.999999, r)) * names.length);
    if (names[idx] === avoid) idx = (idx + 1) % names.length;
    return names[idx];
  }

  /** 动作包素材文件 → 插件内可用 URL（走 assetUrl：宿主只服务根级文件，故平铺） */
  function petpackFileUrl(file) {
    return assetUrl(file);
  }
`;

/* ---------------- 参数 ---------------- */
function parseArgs(argv) {
  const o = { zip: '', id: 'dshpack', name: '', prefix: 'dp', width: 160, fps: 12, crf: 45,
    crop: '0.62,0.92', ffmpeg: '', dryRun: false, force: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => argv[++i];
    if (a === '--id') o.id = val();
    else if (a === '--name') o.name = val();
    else if (a === '--prefix') o.prefix = val();
    else if (a === '--width') o.width = Number(val());
    else if (a === '--fps') o.fps = Number(val());
    else if (a === '--crf') o.crf = Number(val());
    else if (a === '--crop') o.crop = val();
    else if (a === '--ffmpeg') o.ffmpeg = val();
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--force') o.force = true;
    else if (!a.startsWith('--')) rest.push(a);
  }
  o.zip = rest[0] || '';
  return o;
}

/* ---------------- ffmpeg 探测 ---------------- */
function findFfmpeg(explicit) {
  const cands = [];
  if (explicit) cands.push(explicit);
  if (process.env.PET_BUDDY_FFMPEG) cands.push(process.env.PET_BUDDY_FFMPEG);
  // 便携 Python 的 imageio_ffmpeg 自带一份（本项目构建机上就有）
  const la = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const binDir = path.join(la, 'Programs', '坚祥数字助理GO', '技能', '_runtime', 'python', 'Lib', 'site-packages', 'imageio_ffmpeg', 'binaries');
  if (existsSync(binDir)) {
    for (const f of readdirSync(binDir)) if (/^ffmpeg.*\.exe$/i.test(f)) cands.push(path.join(binDir, f));
  }
  for (const c of cands) if (c && existsSync(c)) return c;
  // PATH
  const probe = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  if (probe.status === 0) return 'ffmpeg';
  return '';
}

/* ---------------- ZIP（复用 core/zipread.js） ---------------- */
function loadZipReader() {
  const src = readFileSync(path.join(ROOT, 'src/core/zipread.js'), 'utf8');
  return new Function(src + '\n;return { zipEntries, zipExtract };')();
}

/* ---------------- JSONC 解析（去注释 + 去尾逗号；字符串里的 // 不动） ---------------- */
function parseJsonc(text) {
  let out = '', inStr = false, inLine = false, inBlock = false, quote = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (inLine) { if (c === '\n') { inLine = false; out += c; } continue; }
    if (inBlock) { if (c === '*' && n === '/') { inBlock = false; i++; } continue; }
    if (inStr) {
      out += c;
      if (c === '\\') { out += text[++i]; continue; }
      if (c === quote) inStr = false;
      continue;
    }
    if (c === '"' || c === "'") { inStr = true; quote = c; out += c; continue; }
    if (c === '/' && n === '/') { inLine = true; i++; continue; }
    if (c === '/' && n === '*') { inBlock = true; i++; continue; }
    out += c;
  }
  out = out.replace(/,\s*([}\]])/g, '$1');   // 尾逗号
  return JSON.parse(out);
}

/* ---------------- 动画池 → 语义角色映射 ---------------- */
function buildRoles(anim) {
  const roles = {};
  const arr = (v) => Array.isArray(v) ? v.filter(x => typeof x === 'string' && x) : (typeof v === 'string' && v ? [v] : []);
  roles.idle = arr(anim.idle);
  roles.turn = arr(anim.turn);
  roles.drag = arr(anim.drag);
  roles.clicks = arr(anim.clicks);
  if (anim.moves && Array.isArray(anim.moves.actions)) roles.moves = anim.moves.actions.map(a => a && a.name).filter(Boolean);
  roles.balance = arr(anim.events && anim.events.balance);
  roles.whisper = arr(anim.events && anim.events.whisper);
  roles.workStatus = arr(anim.events && anim.events.workStatus);
  if (Array.isArray(anim.sleep) && anim.sleep[0]) {
    roles.sleep = { start: arr(anim.sleep[0].start), loop: arr(anim.sleep[0].loop), end: arr(anim.sleep[0].end) };
  }
  roles.baifan = arr(anim.baifan);
  // 随机表演池：categories 下的全部动作（记分类名，便于界面展示与调权重）
  roles.random = [];
  if (Array.isArray(anim.categories)) {
    for (const c of anim.categories) {
      for (const a of arr(c && c.actions)) roles.random.push({ name: a, category: (c && c.id) || '' });
    }
  }
  return roles;
}

/* ---------------- 主流程 ---------------- */
const opt = parseArgs(process.argv.slice(2));
if (!opt.zip) {
  console.error('用法：node tools/import-petpack.mjs <模型包.zip> [--id dshpack] [--dry-run] …');
  process.exit(2);
}
if (!existsSync(opt.zip)) { console.error('找不到模型包：' + opt.zip); process.exit(2); }

const zipBuf = readFileSync(opt.zip);
const zipAB = zipBuf.buffer.slice(zipBuf.byteOffset, zipBuf.byteOffset + zipBuf.byteLength);   // 只切一次，反复用
const zipSizeMB = zipBuf.length / 1024 / 1024;
log(`\n[1/6] 读包：${path.basename(opt.zip)}（${zipSizeMB.toFixed(1)} MB）`);
const Z = loadZipReader();
let entries;
try { entries = Z.zipEntries(zipAB); }
catch (e) { console.error('  zip 解析失败：' + e.message); process.exit(1); }
log(`  条目 ${entries.length} 个`);

/* 找动作素材与配置 */
const webms = entries.filter(e => /\/webm\/[^/]+\.webm$/i.test(e.name));
const cfgEntry = entries.find(e => /\/assets\/config\.jsonc?$/i.test(e.name)) || entries.find(e => /config\.jsonc?$/i.test(e.name));
if (!webms.length) { console.error('  包里没找到动作素材（assets/webm/*.webm）——这个包不是 dsh-pet 格式？'); process.exit(1); }
log(`  动作素材 ${webms.length} 个（合计 ${(webms.reduce((s, e) => s + e.size, 0) / 1024 / 1024).toFixed(1)} MB）`);
log(`  配置文件：${cfgEntry ? cfgEntry.name : '（未找到，角色映射留空）'}`);

let roles = {}, packName = opt.name || path.basename(opt.zip, '.zip');
if (cfgEntry) {
  try {
    const cfgText = new TextDecoder('utf-8').decode(await Z.zipExtract(zipAB, cfgEntry));
    const cfg = parseJsonc(cfgText);
    roles = buildRoles(cfg.animations || {});
    if (!opt.name && cfg.pets && cfg.pets[0] && cfg.pets[0].name) packName = cfg.pets[0].name;
    const cnt = Object.keys(roles).reduce((s, k) => s + (Array.isArray(roles[k]) ? roles[k].length : 0), 0);
    log(`  动画池解析：${Object.keys(roles).filter(k => Array.isArray(roles[k]) ? roles[k].length : roles[k]).join(' / ')}（共 ${cnt} 条动作引用）`);
  } catch (e) { log('  配置解析失败（继续，只做素材转换）：' + e.message); }
}

/* 动作名 → 语义（反查表，写进清单便于运行时按名查角色） */
const roleOfName = {};
for (const k of Object.keys(roles)) {
  const v = roles[k];
  if (Array.isArray(v)) for (const it of v) roleOfName[typeof it === 'string' ? it : it.name] = k;
  else if (v && typeof v === 'object') for (const seg of ['start', 'loop', 'end']) for (const it of (v[seg] || [])) roleOfName[it] = 'sleep.' + seg;
}

/* 转码 */
const ff = opt.dryRun ? '' : findFfmpeg(opt.ffmpeg);
if (!opt.dryRun && !ff) { console.error('找不到 ffmpeg：用 --ffmpeg <路径> 指定，或设置 PET_BUDDY_FFMPEG 环境变量'); process.exit(2); }
const [cw, ch] = opt.crop.split(',').map(Number);
const CROP = `crop=iw*${cw}:ih*${ch}:(iw-iw*${cw})/2:(ih-ih*${ch})/2`;
const VF = `fps=${opt.fps},${CROP},scale=${opt.width}:-2:flags=lanczos,format=yuva420p`;
/* 关键两点（缺一个 alpha 就丢，画面变黑底）：
 *   ① 输入侧显式用 libvpx-vp9 解码器——ffmpeg 的 native vp9 解码器会忽略 alpha 轨；
 *   ② 输出侧 -auto-alt-ref 0——VP9 的 alpha 与 alt-ref 帧不兼容。 */
const VENC = ['-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-auto-alt-ref', '0',
  '-crf', String(opt.crf), '-b:v', '0', '-deadline', 'good', '-cpu-used', '4', '-an'];
log(`\n[2/6] 转码参数：${VF}`);
log(`      ffmpeg：${ff || '（dry-run 跳过）'}  编码：libvpx-vp9 / crf${opt.crf}`);

const TMP = path.join(ROOT, '.jxai', 'tmp', 'petpack-src');
if (!opt.dryRun) mkdirSync(TMP, { recursive: true });

const actions = [];
let totalOut = 0, totalSrc = 0, skipped = 0;
for (let i = 0; i < webms.length; i++) {
  const e = webms[i];
  const base = path.basename(e.name).replace(/\.webm$/i, '');
  const file = `${opt.prefix}-${String(i + 1).padStart(3, '0')}.webm`;
  const dst = path.join(ROOT, file);
  const rec = { file, name: base, role: roleOfName[base] || '', srcKB: Math.round(e.size / 1024), outKB: 0 };
  if (opt.dryRun) { actions.push(rec); continue; }
  if (existsSync(dst) && !opt.force) {
    rec.outKB = Math.round(statSync(dst).size / 1024);
    totalOut += rec.outKB; totalSrc += rec.srcKB; skipped++;
    actions.push(rec);
    continue;
  }
  const srcPath = path.join(TMP, `${opt.id}-${String(i + 1).padStart(3, '0')}.webm`);
  if (!existsSync(srcPath)) writeFileSync(srcPath, Buffer.from(await Z.zipExtract(zipAB, e)));
  const r = spawnSync(ff, ['-y', '-hide_banner', '-loglevel', 'error', '-c:v', 'libvpx-vp9', '-i', srcPath, '-vf', VF, ...VENC, dst], { stdio: 'ignore' });
  if (r.status !== 0 || !existsSync(dst)) { console.error(`  [失败] ${base}`); continue; }
  rec.outKB = Math.round(statSync(dst).size / 1024);
  totalOut += rec.outKB; totalSrc += rec.srcKB;
  actions.push(rec);
  if ((i + 1) % 20 === 0) log(`  ${i + 1}/${webms.length} …`);
}
log(`\n[3/6] 素材：${actions.length} 个动作 → ${(totalOut / 1024).toFixed(2)} MB（原 ${(totalSrc / 1024).toFixed(1)} MB` +
  (skipped ? `；跳过已存在 ${skipped} 个` : '') + '）');

/* 缩略图：从 idle 动作（或第一个）抽一帧，界面里当模型卡的封面 */
let thumbFile = '';
if (!opt.dryRun && actions.length) {
  const pick2 = actions.find(a => a.role === 'idle') || actions[0];
  thumbFile = `${opt.prefix}-thumb.png`;
  const r = spawnSync(ff, ['-y', '-hide_banner', '-loglevel', 'error', '-c:v', 'libvpx-vp9', '-i', path.join(ROOT, pick2.file),
    '-vf', 'select=eq(n\\,2)', '-frames:v', '1', path.join(ROOT, thumbFile)], { stdio: 'ignore' });
  if (r.status !== 0 || !existsSync(path.join(ROOT, thumbFile))) { thumbFile = ''; log('  （缩略图生成失败，界面用兜底图标）'); }
  else log(`  缩略图：${thumbFile}（取自「${pick2.name}」）`);
}
const allFiles = actions.map(a => a.file).concat(thumbFile ? [thumbFile] : []);

/* 生成 core/petpack.js（数据段自动生成） */
const roleCount = {};
for (const a of actions) if (a.role) roleCount[a.role] = (roleCount[a.role] || 0) + 1;
const dataObj = {
  id: opt.id,
  name: packName,
  source: path.basename(opt.zip),
  importedAt: (() => { const d = new Date(); const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; })(),
  params: { width: opt.width, fps: opt.fps, crf: opt.crf, crop: [cw, ch], codec: 'vp9-alpha' },
  thumb: thumbFile,
  srcTotalKB: totalSrc,
  outTotalKB: totalOut,
  actions,
  roles,
};
const PETPACK_FILE = path.join(ROOT, 'src', 'core', 'petpack.js');
const START = '/* @@PETPACK-DATA-START@@（由 tools/import-petpack.mjs 生成，勿手改） */';
const END = '/* @@PETPACK-DATA-END@@ */';
const dataJson = JSON.stringify({ [opt.id]: dataObj }, null, 1).split('\n').join('\n  ');
const dataJs = START + '\n  const PETPACKS = ' + dataJson + ';\n  ' + END;
let pj = existsSync(PETPACK_FILE) ? readFileSync(PETPACK_FILE, 'utf8') : '';
if (pj.includes(START) && pj.includes(END)) {
  pj = pj.slice(0, pj.indexOf(START)) + dataJs + pj.slice(pj.indexOf(END) + END.length);
} else {
  pj = PETPACK_TEMPLATE.replace('/* @@DATA@@ */', dataJs);
}
if (!opt.dryRun) writeFileSync(PETPACK_FILE, pj, 'utf8');
log(`\n[4/6] 清单 → src/core/petpack.js（${actions.length} 个动作，角色分布：` +
  Object.keys(roleCount).map(k => `${k}=${roleCount[k]}`).join(' ') + '）');

/* 更新素材清单 assets.manifest.json */
const manPath = path.join(ROOT, 'assets.manifest.json');
const man = JSON.parse(readFileSync(manPath, 'utf8'));
const gid = 'petpack-' + opt.id;
man.groups = (man.groups || []).filter(g => g.id !== gid);
man.groups.push({
  id: gid,
  prefix: opt.prefix + '-',
  count: allFiles.length,
  files: allFiles,
  use: `桌宠动作包「${packName}」：${actions.length} 个动作视频（VP9-alpha webm），按语义角色播放` +
    `（idle ${roleCount.idle || 0} / 点击 ${roleCount.clicks || 0} / 拖拽 ${roleCount.drag || 0} / 余额 ${roleCount.balance || 0} / 随机表演 ${(roles.random || []).length} …）`,
  source: `模型包 ${dataObj.source}（${zipSizeMB.toFixed(1)}MB，含形象/动作/交互配置）经 tools/import-petpack.mjs 整合：` +
    `ffmpeg 裁 ${cw}×${ch} 居中 → ${opt.width}px / ${opt.fps}fps / crf${opt.crf} / VP9-alpha，` +
    `素材 ${(totalSrc / 1024).toFixed(1)}MB → ${(totalOut / 1024).toFixed(2)}MB（-${totalSrc ? (100 - totalOut / totalSrc * 100).toFixed(0) : 0}%）`,
  license: '上游 dsh-pet（PC2005-cloud/dsh-pet，MIT，见仓库 LICENSE 与 LICENSE-dspet.txt）',
});
if (!opt.dryRun) writeFileSync(manPath, JSON.stringify(man, null, 2) + '\n', 'utf8');
log(`\n[5/6] 素材清单 → assets.manifest.json（新增组 ${gid}，count=${actions.length}）`);

/* 导入记录 */
const recPath = path.join(ROOT, 'docs', `petpack-${opt.id}-导入记录.md`);
if (!opt.dryRun) mkdirSync(path.dirname(recPath), { recursive: true });
const lines = [];
lines.push(`# 模型包整合记录 · ${packName}（${opt.id}）`, '');
lines.push(`- 源包：\`${path.basename(opt.zip)}\`（${zipSizeMB.toFixed(1)} MB）`);
lines.push(`- 导入时间：${dataObj.importedAt}`);
lines.push(`- 转码参数：ffmpeg ${VF}，libvpx-vp9 crf${opt.crf}，VP9-alpha`);
lines.push(`- 体积：动作素材 ${(totalSrc / 1024).toFixed(1)} MB → ${(totalOut / 1024).toFixed(2)} MB（-${(100 - totalOut / totalSrc * 100).toFixed(0)}%）；共 ${actions.length} 个动作`);
lines.push(`- 素材文件：插件根目录 \`${opt.prefix}-001.webm\` … \`${opt.prefix}-${String(actions.length).padStart(3, '0')}.webm\`（宿主只服务根级文件，必须平铺）`);
lines.push('');
lines.push('## 语义角色映射（来自包内 assets/config.jsonc 的 animations）', '');
for (const k of ['idle', 'turn', 'drag', 'clicks', 'balance', 'whisper', 'workStatus', 'moves', 'baifan']) {
  const v = roles[k]; if (!v || !v.length) continue;
  lines.push(`- **${k}**（${v.length}）：${v.slice(0, 8).map(x => (x && x.name) || x).join('、')}${v.length > 8 ? ' …' : ''}`);
}
if (roles.sleep) lines.push(`- **sleep**：入睡 ${roles.sleep.start.join('、')} / 循环 ${roles.sleep.loop.join('、')} / 醒来 ${roles.sleep.end.join('、')}`);
if (roles.random && roles.random.length) {
  lines.push(`- **随机表演**（${roles.random.length}，分 ${new Set(roles.random.map(r => r.category)).size} 类）：` +
    roles.random.slice(0, 10).map(r => r.name).join('、') + ' …');
}
lines.push('', '## 动作清单', '', '| 文件 | 动作名 | 角色 | 原 KB | 转后 KB |', '|---|---|---|---|---|');
for (const a of actions) lines.push(`| ${a.file} | ${a.name} | ${a.role || '—'} | ${a.srcKB} | ${a.outKB} |`);
lines.push('', '## 复用说明', '',
  '```powershell', 'node tools/import-petpack.mjs <另一个模型包.zip> --id mypack --prefix mp', '```', '',
  '任何「dsh-pet 格式」的模型包（assets/webm/*.webm + assets/config.jsonc）都能这样整合；',
  '脚本会复用 core/zipread.js 读包、按 config.jsonc 建立语义映射、用 ffmpeg 统一转码，',
  '并自动更新 src/core/petpack.js 与 assets.manifest.json，最后写出本记录。');
if (!opt.dryRun) writeFileSync(recPath, lines.join('\n') + '\n', 'utf8');
log(`\n[6/6] 导入记录 → docs/petpack-${opt.id}-导入记录.md`);
if (opt.dryRun) log('\n（dry-run：未转码、未写任何文件）');
log(`\n完成。下一步：node build.mjs && node tools/smoke.mjs`);