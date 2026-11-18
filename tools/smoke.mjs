#!/usr/bin/env node
/* ============================================================================
 * pet-buddy 离线冒烟自检（不需要宿主、不需要浏览器）
 * ----------------------------------------------------------------------------
 * 把 src/core/*.js（桌宠半边与聊天窗口半边共用的唯一真相源）在最小 DOM /
 * localStorage 桩里跑一遍，断言关键解析、渲染与文案组装仍然正确。
 * 用途：整合/重构后先在这里验一遍，再去宿主里点界面（见 README「验证」一节）。
 * 用法：node tools/smoke.mjs        （退出码 0 = 全通过）
 * ==========================================================================*/

import {readFileSync} from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORDER = ['config.js', 'util.js', 'store.js', 'stickers.js', 'balance.js', 'chat.js'];
const core = ORDER.map((f) => readFileSync(path.join(ROOT, 'src/core', f), 'utf8')).join('\n');

/* ---------- 最小桩：够 core 跑完，不做真实渲染 ---------- */
const mem = new Map();
const stubEl = (tag = 'span') => ({
  tagName: tag, style: {}, className: '', title: '', textContent: '', innerHTML: '', src: '', alt: '', children: [],
  appendChild(c) { this.children.push(c); return c; },
  setAttribute() {}, removeAttribute() {}, addEventListener() {}, remove() {},
  classList: {add() {}, remove() {}, toggle() {}, contains() { return false; }},
});
const sandbox = {
  console,
  Date, Math, JSON, Object, Array, String, Number, Boolean, Set, Map, Promise, isNaN, parseInt, parseFloat,
  setTimeout, clearTimeout, setInterval, clearInterval,
  TextDecoder, URL, Blob,
  localStorage: {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
  },
  document: {
    createElement: (t) => stubEl(t),
    createTextNode: (t) => ({nodeType: 3, text: t}),
    querySelector: () => null,
    addEventListener() {},
    body: stubEl('body'),
  },
  location: {pathname: '/_plugins/pet-buddy/chat.html'},
  fetch: async () => { throw new Error('offline（自检不联网）'); },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;

/* 探针：与 core 拼成同一个脚本，才能访问 core 里的 const/function */
const probe = `
;globalThis.__probe = {
  PB_VERSION, DEFAULTS, DEFAULT_PERSONA, CHAT_MODELS, LS_KEY, ARCHIVE, ARCHIVE_IDS,
  settings, saveSettings, log, logs, ASSET_DIR,
  FISH_STICKERS, BEAN, ARCHIVE_ALIAS, normSticker, archiveResolve, stickerEl, renderRich, $new, clamp, nowStr,
  isValley, fmtCredits, fmtMoney, perYuanCredits, priceTier, localDateStr,
  buildPrompt, periodGreet, hashStr, personaFingerprint, needPersonaFull, markPersonaSent, extractNickname,
  ensureAssistantSession, lastAssistantText, sendViaMock, chatSend, apiOK,
};`;

vm.createContext(sandbox);
vm.runInContext(core + probe, sandbox, {filename: 'core-bundle.js'});
const P = sandbox.__probe;

/* ---------- 断言 ---------- */
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `→ got ${JSON.stringify(got)}，want ${JSON.stringify(want)}`);

console.log('pet-buddy core 冒烟自检');
console.log('\n[配置]');
ok('PB_VERSION 形如 x.y.z', /^\d+\.\d+\.\d+$/.test(P.PB_VERSION), `→ ${P.PB_VERSION}`);
eq('历史 localStorage 键未改', P.LS_KEY, 'pb2.settings.v2');
eq('默认每元积分 = 1000', P.DEFAULTS.perYuan, 1000);
ok('模型清单非空且字段完整', P.CHAT_MODELS.length > 0 && P.CHAT_MODELS.every(m => m.provider && m.model && m.label));
ok('设置对象已按默认值载入', P.settings && P.settings.channel === 'assistant');

console.log('\n[贴纸解析]');
eq('档案表条目数', P.ARCHIVE_IDS.length, P.ARCHIVE.length);
ok('档案表 40 条（16 幅档案馆 + 24 张微信）', P.ARCHIVE_IDS.length === 40, `→ ${P.ARCHIVE_IDS.length}`);
eq('中文语义键 → 文件 id', P.archiveResolve('抱头'), 'deepseek-bao-tou-wei-qu');
eq('完整 id 原样返回', P.archiveResolve('deepseek-bixin'), 'deepseek-bixin');
eq('wx 数字简称 → wx-NN', P.archiveResolve('wx7'), 'wx-07');
eq('短名（去 deepseek- 前缀）', P.archiveResolve('bixin'), 'deepseek-bixin');
eq('未知名字 → null（不显示破碎标记）', P.archiveResolve('不存在的名字'), null);
eq('口型/贴纸名归一化', P.normSticker('鱼', '挥手'), {g: 'fish', n: 'wave'});
ok('fish 元素同时带 桌宠/窗口 两套类名', P.stickerEl('fish', 'wave').className.includes('pb2-st-fish') && P.stickerEl('fish', 'wave').className.includes('fish-st'));
eq('档案贴纸走资产目录前缀（不再相对路径）', P.stickerEl('stick', 'archive:比心').children[0].src, P.ASSET_DIR + 'st-deepseek-bixin.webp');
ok('未知贴纸 → null', P.stickerEl('stick', 'archive:查无此图') === null);
{
  const box = stubEl('div');
  let threw = null;
  try { P.renderRich(box, '你好[bean:smile]呀[stick:archive:不存在的]！'); } catch (e) { threw = e; }
  ok('renderRich 不抛错', !threw, threw ? `→ ${threw.message}` : '');
  ok('renderRich 文本+已知贴纸都渲染', !threw && box.children.length >= 3, `→ children=${box.children.length}`);
}

console.log('\n[余额与积分]');
ok('法定假日全天谷价', P.isValley(new Date('2026-01-01T12:00:00')) === true);
ok('工作日白天非谷价', P.isValley(new Date('2026-11-18T12:00:00')) === false);
ok('凌晨 00:30-08:30 谷价', P.isValley(new Date('2026-11-18T03:00:00')) === true);
eq('积分千分位', P.fmtCredits(1234567.4), '1,234,567');
eq('pro 模型走高价档', P.priceTier('doubao-seedream-pro'), P.priceTier('pro'));
ok('每元积分可配置（默认 1000）', P.perYuanCredits() === 1000);

console.log('\n[聊天组装]');
ok('periodGreet 返回问候语', /好|夜深/.test(P.periodGreet()), `→ ${P.periodGreet()}`);
ok('buildPrompt 带桌宠设定', P.buildPrompt('你好', null, true).includes('桌宠设定'));
ok('buildPrompt 带贴纸教学', P.buildPrompt('你好', null, true).includes('[stick:archive:'));
ok('buildPrompt 首轮带用户资料', P.buildPrompt('你好', null, true).includes('用户资料'));
ok('buildPrompt 非首轮只带用户消息', !P.buildPrompt('你好', null, false).includes('桌宠设定'));
ok('人设指纹首轮需要全量', typeof P.needPersonaFull('smoke-test') === 'string');
ok('chatSend / 三通道函数就绪', ['chatSend', 'sendViaMock', 'ensureAssistantSession', 'lastAssistantText', 'apiOK'].every(k => typeof P[k] === 'function'));
ok('离线时 apiOK 返回 false（不抛错）', (await P.apiOK()) === false);
{
  const r = await P.sendViaMock('你好呀', null, null);
  ok('模拟通道能出回复', r && typeof r.text === 'string' && r.text.length > 0, `→ ${JSON.stringify(r).slice(0, 80)}`);
}

console.log(`\n结果：${pass} 项通过，${fail} 项失败`);
if (fail) process.exitCode = 1;
