#!/usr/bin/env node
/* ============================================================================
 * pet-buddy 构建脚本
 * ----------------------------------------------------------------------------
 * 做两件事：
 *  1. 把 src/core/*.js（唯一真相源）按标记注入两份产物：
 *       src/pet.client.js   → client.js   （桌宠半边，注入到 IIFE 顶部）
 *       src/chat.template.html → chat.html（聊天窗口半边，注入到页面脚本顶部）
 *  2. 统一版本号：以 src/core/config.js 的 PB_VERSION 为准，写回 manifest.json 的 version。
 *
 * 手法参考 hakihakii/bibibobo 的 build.mjs：单一真相源 + 标记注入 + 失配即报错
 * （找不到标记、core 里出现 import/export、注入后校验不过，都直接 throw，不产出半成品）。
 *
 * 用法：
 *   node build.mjs          构建（写产物）
 *   node build.mjs --check  只校验产物是否与源码一致（不写文件；安装脚本/CI 用）
 * ==========================================================================*/

import {readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {Script} from 'node:vm';
import path from 'node:path';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CHECK = process.argv.includes('--check');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const BEGIN = '/* pb:core:begin';
const END = '/* pb:core:end */';
const ORDER = ['config.js', 'util.js', 'store.js', 'stickers.js', 'zipread.js', 'zipwrite.js', 'deliver.js', 'petpack.js', 'layers.js', 'petwalk.js', 'balance.js', 'speech.js', 'sfx.js', 'voiceinput.js', 'chat.js'];
/* 第三方原样内联（只去掉行首 export）：先于 core 注入，core 里的模块直接用它的函数。
 * 升级做法：整文件替换 vendor/ 下的原件，跑一次 build 即可（diff 只可能在去 export 那步）。 */
const VENDOR = [{file: 'vendor/bibibobo.js'}];

/* ---------- 1. 拼 vendor 段（第三方，原样） ---------- */
const vendor = VENDOR.map((v) => {
  const raw = read(v.file).trimEnd();
  if (/^\s*import\b/m.test(raw)) throw new Error(`${v.file} 里有 import —— vendor 必须自包含才能原样内联`);
  if (/<\/script/i.test(raw)) throw new Error(`${v.file} 含 </script>，会截断 HTML 内联`);
  const t = raw.replace(/^export\s+(?=(?:const|let|var|function|class)\b)/gm, '');
  if (/^\s*export\b/m.test(t)) throw new Error(`${v.file} 里还有未能去掉的 export（只支持行首 export const/let/var/function/class）`);
  return `  /* ======== ${v.file}（第三方原样内联，MIT；仅去掉行首 export）======== */\n` + t;
}).join('\n\n');

/* ---------- 2. 拼 core 段 ---------- */
const core = ORDER.map((f) => {
  const t = read('src/core/' + f).trimEnd();
  if (/^\s*(import|export)\b/m.test(t)) throw new Error(`src/core/${f} 里出现了 import/export —— core 必须能原样内联（去掉行首 export 即可运行）`);
  if (/<\/script/i.test(t)) throw new Error(`src/core/${f} 含 </script>，会截断 HTML 内联`);
  return `  /* ======== src/core/${f} ======== */\n` + t;
}).join('\n\n');

const version = (read('src/core/config.js').match(/PB_VERSION\s*=\s*'([^']+)'/) || [])[1];
if (!version) throw new Error('src/core/config.js 里没找到 PB_VERSION');

/* ---------- 2. 注入 ---------- */
function inject(srcFile, outFile) {
  const src = read(srcFile);
  const b = src.indexOf(BEGIN);
  const e = src.indexOf(END, b);
  if (b < 0 || e < 0) throw new Error(`${srcFile} 里没找到 ${BEGIN} … ${END} 标记`);
  const head = src.slice(0, b);
  const tail = src.slice(e + END.length);
  const text = head + `/* pb:core:begin（由 build.mjs 从 vendor/* + src/core/* 注入，勿手改） */\n` + vendor + `\n\n` + core + `\n  ` + END + tail;
  if (!text.includes(vendor)) throw new Error(`${outFile}: 注入校验失败（vendor 未被完整写入）`);
  if (!text.includes(core)) throw new Error(`${outFile}: 注入校验失败（core 未被完整写入）`);
  if ((text.match(/pb:core:begin/g) || []).length !== 1) throw new Error(`${outFile}: 标记数量异常`);
  const prev = (() => { try { return read(outFile); } catch { return null; } })();
  const changed = prev !== text;
  if (!CHECK && changed) writeFileSync(path.join(ROOT, outFile), text, 'utf8');
  return {outFile, bytes: Buffer.byteLength(text), changed};
}

const results = [
  inject('src/pet.client.js', 'client.js'),
  inject('src/chat.template.html', 'chat.html'),
];

/* ---------- 2.5 语法校验（v4.18 补：这是之前的缺口） ----------
 * 教训：注入后的产物若是"函数没闭合/括号错位"这类语法错误，浏览器会整份脚本拒绝执行
 * ——插件表现为"桌宠不显示"，而文本层面的检查（对账、标记数量）全都查不出来。
 * 这里用 vm.Script 真编译一遍：语法错就 throw，绝不产出半成品。
 * 同时校验 core 各文件单独也语法合法（便于定位是哪一块写坏了）。 */
function syntaxCheck(label, text) {
  try {
    new Script(text, {filename: label});          // 只编译、不执行
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    const m = /:(\d+)/.exec(msg);
    let where = '';
    if (m) {
      const ln = Number(m[1]);
      const L = text.split('\n');
      for (let i = Math.max(0, ln - 4); i < Math.min(L.length, ln + 2); i++) {
        where += `\n      ${i + 1 === ln ? '→' : ' '} ${String(i + 1).padStart(5)}| ${L[i]}`;
      }
    }
    throw new Error(`${label} 语法错误：${msg}${where}`);
  }
}
syntaxCheck('client.js（注入后）', read('client.js'));
/* chat.html 是 HTML：把内联 <script> 段逐个抽出来校验（外链 src 的不算） */
{
  const html = read('chat.html');
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  if (!scripts.length) throw new Error('chat.html 里没找到内联 <script>，无法做语法校验');
  scripts.forEach((s, i) => syntaxCheck(`chat.html 内联脚本 #${i + 1}`, s));
}
for (const f of ORDER) syntaxCheck('src/core/' + f, read('src/core/' + f));

/* ---------- 3. 版本号写回 manifest.json ---------- */
const mf = JSON.parse(read('manifest.json'));
/* v4.15：description 里的版本标签（形如「（v4.15.0）」）也一并同步——
 * 之前只写了 version 字段，描述里那句一直停在旧版本，用户看到的"还是 4.x"就是这个。 */
const mfDescNew = String(mf.description || '').replace(/（v[0-9]+\.[0-9]+(\.[0-9]+)?）/, `（v${version}）`);
const mfDescChanged = mfDescNew !== mf.description;
const mfChanged = mf.version !== version || mfDescChanged;
if (mfDescChanged) mf.description = mfDescNew;
if (mfChanged) {
  mf.version = version;
  if (!CHECK) writeFileSync(path.join(ROOT, 'manifest.json'), JSON.stringify(mf, null, 2) + '\n', 'utf8');
}

/* ---------- 4. 汇报 ---------- */
for (const r of results) {
  console.log(`${CHECK ? '[check] ' : ''}${r.outFile}: ${(r.bytes / 1024).toFixed(1)} KB ${CHECK ? (r.changed ? '需要重新构建 ✗' : '与源码一致 ✓') : (r.changed ? '已更新' : '无变化')}`);
}
console.log(`${CHECK ? '[check] ' : ''}manifest.json: version=${version}${mfChanged ? (CHECK ? ' 需要更新 ✗' : ' 已写回') : ' ✓'}`);
if (CHECK && (results.some((r) => r.changed) || mfChanged)) process.exitCode = 1;
