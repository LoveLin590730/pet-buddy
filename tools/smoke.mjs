#!/usr/bin/env node
/* ============================================================================
 * pet-buddy 离线冒烟自检（不需要宿主、不需要浏览器）
 * ----------------------------------------------------------------------------
 * 把 src/core/*.js（桌宠半边与聊天窗口半边共用的唯一真相源）在最小 DOM /
 * localStorage 桩里跑一遍，断言关键解析、渲染与文案组装仍然正确。
 * 用途：整合/重构后先在这里验一遍，再去宿主里点界面（见 README「验证」一节）。
 * 用法：node tools/smoke.mjs        （退出码 0 = 全通过）
 * ==========================================================================*/

import {readFileSync, readdirSync, existsSync} from 'node:fs';
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
  settings, saveSettings, log, logs, ASSET_DIR, ASSET_SPRITE, ASSET_SKIN_DEFAULT, ASSET_STICKER,
  FISH_STICKERS, BEAN, ARCHIVE_ALIAS, normSticker, archiveResolve, stickerEl, renderRich, $new, clamp, nowStr, fmtTok,
  isValley, fmtCredits, fmtMoney, perYuanCredits, priceTier, localDateStr,
  parseGatewayToken, tokenHint, fetchCompanyQuota, quotaLine, fetchCredits, todaySpend,
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
eq('档案贴纸走插件根素材目录（宿主只服务根级文件）', P.stickerEl('stick', 'archive:比心').children[0].src, P.ASSET_STICKER + 'st-deepseek-bixin.webp');
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

console.log('\n[令牌识别 · v3.1.0]');
eq('内部通道身份牌 jxai-姓名-设备号', P.parseGatewayToken('jxai-杨镇城-jx-yzc'), {kind: 'inner', valid: true, name: '杨镇城', device: 'jx-yzc', label: '公司内部通道身份牌'});
eq('网关 API Key（sk- 开头）', P.parseGatewayToken('sk-abc123').kind, 'apikey');
eq('留空', P.parseGatewayToken('').kind, 'empty');
eq('其他格式 → 无法识别', P.parseGatewayToken('随便写点什么').kind, 'other');
ok('身份牌提示含姓名 + 设备号 + 指路助手额度', /杨镇城/.test(P.tokenHint('jxai-杨镇城-jx-yzc')) && /jx-yzc/.test(P.tokenHint('jxai-杨镇城-jx-yzc')) && /助手/.test(P.tokenHint('jxai-杨镇城-jx-yzc')));

console.log('\n[余额来源：内部通道额度 + 缓存命中计价 · v3.1.0]');
{
  const today = P.localDateStr(new Date());
  let quotaUsed = 17067;
  sandbox.fetch = async (url) => {
    const u = String(url);
    if (u.indexOf('/api/models') === 0) {
      return {ok: true, json: async () => ({companyQuota: {points: 100000, remainPoints: 100000 - quotaUsed, usedPoints: quotaUsed, period: 'monthly', periodText: '每月 1 号', nextAt: '2026-12-01T00:00:00+08:00', asOf: today + ' 17:52:27', status: 1}})};
    }
    if (u.indexOf('/api/sessions') === 0) {
      return {ok: true, json: async () => ({sessions: [
        {id: 's1', model: 'deepseek-flash', usagePrompt: 1000000, usageCacheHit: 800000, usageOutput: 20000, usageCalls: 5, createdAt: today + ' 09:00:00', updatedAt: today + ' 10:00:00'},
        {id: 's2', model: 'deepseek-flash', usagePrompt: 99000000, usageCacheHit: 0, usageOutput: 1000000, usageCalls: 500, createdAt: '2026-10-01 09:00:00', updatedAt: today + ' 11:00:00'},
      ]})};
    }
    throw new Error('自检未预料的请求：' + u);
  };
  const q = await P.fetchCompanyQuota(true);
  ok('内部通道额度读得到（不需要任何令牌）', q.ok === true && q.usedPoints === 17067 && q.remainPoints + q.usedPoints === q.points, JSON.stringify(q));
  ok('额度文案含剩余/月度/刷新日', P.quotaLine(q).indexOf(P.fmtCredits(q.remainPoints)) >= 0 && /100,000/.test(P.quotaLine(q)) && /每月 1 号/.test(P.quotaLine(q)), P.quotaLine(q));
  const d = await P.todaySpend(true);
  ok('默认余额来源＝助手额度（不再因缺网关令牌而空手）', d.companyQuota.ok === true && d.credits.ok === false, JSON.stringify(d.credits));
  eq('令牌留空时的原因文案', d.credits.reason, '未配置网关 API Key');
  const flash = P.priceTier('deepseek-flash'), k = d.valley ? 0 : 1;
  const wantCost = Math.round(((200000 / 1e6) * flash.miss[k] + (800000 / 1e6) * flash.hit[k] + (20000 / 1e6) * flash.out[k]) * 10000) / 10000;
  eq('今日消耗按缓存命中价拆分', d.cost, wantCost);
  eq('今日消耗折积分', d.costCredits, Math.round(wantCost * P.perYuanCredits()));
  eq('会话统计带缓存命中 token', d.cacheHit, 800000);
  eq('今日口径：只算今天新建的会话', d.sessions, 1);
  eq('跨天会话单独计数（不把历史累计算成今日）', d.staleSessions, 1);
  ok('今日真实消耗口径可用（额度接口，首次采样从 0 起算）', d.realOk === true && d.realToday === 0, JSON.stringify({realOk: d.realOk, realToday: d.realToday}));
  eq('token 数简写', P.fmtTok(156347907), '156.35M');
  quotaUsed = 17400;
  const d2 = await P.todaySpend(true);
  eq('今日真实消耗 = 额度接口的当天增量', d2.realToday, 333);
  P.settings.gatewayKey = 'jxai-杨镇城-jx-yzc';
  const cr = await P.fetchCredits(true);
  ok('身份牌不再去打网关账单，且原因说人话', cr.ok === false && /内部通道身份牌/.test(cr.reason), cr.reason);
  P.settings.gatewayKey = '';
  ok('素材常量指向插件根（宿主只服务根级文件，素材必须平铺）',
    P.ASSET_SPRITE === P.ASSET_DIR + 'feiyu-spritesheet.png' && P.ASSET_STICKER === P.ASSET_DIR && P.ASSET_SKIN_DEFAULT === P.ASSET_DIR + 'pet-deepseek.webp',
    P.ASSET_SPRITE);
}

console.log('\n[素材清单 · v3.1.0]');
{
  const mf = JSON.parse(readFileSync(path.join(ROOT, 'assets.manifest.json'), 'utf8'));
  const listed = mf.groups.flatMap((g) => g.files);
  const onDisk = readdirSync(ROOT).filter((f) => /\.(webp|png)$/i.test(f));
  ok('清单声明平铺布局（宿主不支持子目录）', mf.layout === 'flat', mf.layout);
  eq('清单条数 = 磁盘素材条数', listed.length, onDisk.length);
  ok('清单里的文件都在，磁盘上的素材也都登记了',
    listed.every((f) => existsSync(path.join(ROOT, f))) && onDisk.every((f) => listed.indexOf(f) >= 0),
    `listed=${listed.length} disk=${onDisk.length}`);
  eq('贴纸清单与代码 ARCHIVE 表逐条一致',
    listed.filter((f) => f.indexOf('st-') === 0).sort(),
    P.ARCHIVE.map((a) => 'st-' + a.id + '.webp').sort());
}

console.log(`\n结果：${pass} 项通过，${fail} 项失败`);
if (fail) process.exitCode = 1;
