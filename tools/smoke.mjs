#!/usr/bin/env node
/* ============================================================================
 * pet-buddy 离线冒烟自检（不需要宿主、不需要浏览器）
 * ----------------------------------------------------------------------------
 * 把 src/core/*.js（桌宠半边与聊天窗口半边共用的唯一真相源）在最小 DOM /
 * localStorage 桩里跑一遍，断言关键解析、渲染与文案组装仍然正确。
 * 用途：整合/重构后先在这里验一遍，再去宿主里点界面（见 README「验证」一节）。
 * 用法：node tools/smoke.mjs        （退出码 0 = 全通过）
 * ==========================================================================*/

import {readFileSync, readdirSync, existsSync, statSync} from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORDER = ['config.js', 'util.js', 'store.js', 'stickers.js', 'zipread.js', 'zipwrite.js', 'deliver.js', 'petpack.js', 'petwalk.js', 'balance.js', 'speech.js', 'sfx.js', 'voiceinput.js', 'chat.js'];
/* 与 build.mjs 同口径：vendor 先内联（去掉行首 export），core 里直接用它的函数 */
const VENDOR = ['vendor/bibibobo.js'];
const vendor = VENDOR.map((f) => readFileSync(path.join(ROOT, f), 'utf8')
  .replace(/^export\s+(?=(?:const|let|var|function|class)\b)/gm, '')).join('\n');
const core = vendor + '\n' + ORDER.map((f) => readFileSync(path.join(ROOT, 'src/core', f), 'utf8')).join('\n');

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
  TextEncoder: globalThis.TextEncoder,
  DecompressionStream,
  btoa: (s) => Buffer.from(String(s), 'latin1').toString('base64'),
  atob: (s) => Buffer.from(String(s), 'base64').toString('latin1'),
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
// 无麦克风环境的桩：viStart 应当给人话原因，而不是抛 ReferenceError
sandbox.navigator = {};

/* 探针：与 core 拼成同一个脚本，才能访问 core 里的 const/function */
const probe = `
;globalThis.__probe = {
  PB_VERSION, DEFAULTS, DEFAULT_PERSONA, CHAT_MODELS, LS_KEY, ARCHIVE, ARCHIVE_IDS,
  settings, saveSettings, log, logs, ASSET_DIR, ASSET_SPRITE, ASSET_SKIN_DEFAULT, ASSET_STICKER,
  FISH_STICKERS, BEAN, ARCHIVE_ALIAS, normSticker, archiveResolve, stickerEl, renderRich, $new, clamp, nowStr, fmtTok,
  isValley, fmtCredits, fmtMoney, perYuanCredits, priceTier, localDateStr,
  parseGatewayToken, tokenHint, fetchCompanyQuota, quotaLine, fetchCredits, todaySpend,
  buildPrompt, periodGreet, hashStr, personaFingerprint, needPersonaFull, markPersonaSent, extractNickname, nicknameLooksWrong, sessionUserText, looksLikeMetaJson,
  ensureAssistantSession, lastAssistantText, sendViaMock, chatSend, apiOK,
  synth, toWav, VOICES, VOWELS, hash, syllables,
  speak, speechClean, speechState, speechStop, speechUnlock, speechApplyVolume, SPEECH_VOICE_NAMES,
  speechSegments, pauseOf, synthPaced, balanceLine,
  analyzeFrame, prosodyTrack, synthFollow, synthGuided, guidedTargets, guidedPickList, pickScaleMidi,
  resampleLinear, mixToMono, ttsPcm, ttsCache, trackCache, speechFollowEnabled,
  SFX_SPEC, sfx, sfxState, sfxApplyVolume,
  SPRITE_SKINS, isSpriteSkin, spriteSkinClass, spriteSkinUrl, ASSET_SPRITE_CODEX, IMAGE_SKINS, isImageSkin,
  imgAnimKind, customSkinAnim, customSkinStoreFits, CUSTOM_STATIC_MAX, CUSTOM_ANIM_MAX, CUSTOM_STORE_BUDGET,
  IMG_IDLE_FUNS, pickIdleFunClass, numToZh, numZhValue,
  zipEntries, zipImageEntries, zipExtract, zipBytesToDataUrl,
  zipCrc32, zipBuild, zipDosStamp,
  stickerStoreFits, stickerStoreUsed, archiveStickerTotal, archiveStickerList,
  extractFilePaths, fileKindOf, pathToFileUrl, renderDeliverables, DELIVER_EXTS,
  petpackById, petpackList, petpackActionOf, petpackRolePool, petpackPick, petpackPickTier, petpackPickRandom, petpackRandomPool,
  WALK_MODES, WALK_SPEEDS, WALK_MARGIN, walkModeOf, walkModeLabel, walkSpeedOf, walkSpeedLabel, walkRnd, walkNextDelay,
  walkEase, walkPosAt, walkPlan, walkSegCount, walkPauseMs,
  cssAssetBase, resolveAssetUrls, applyAssetBase, probeAssetBase, assetBaseCandidates, assetDir, assetUrl, SPRITE_GRID,
  viPhase, viStart, viStop, viCancel, viOn, viOnResult, viTranscribe, viWavB64, viResample, VI_HOTKEY_LABEL, VI_ASR_URL,
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
ok('档案表 67 条（16 档案馆 + 24 微信 + 27 大肥鱼模型包）', P.ARCHIVE_IDS.length === 67, `→ ${P.ARCHIVE_IDS.length}`);
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
ok('交付文件约定只在首轮人设里（不再每轮重发）',
  P.buildPrompt('你好', null, true).includes('【交付文件】') && !P.buildPrompt('你好', null, false).includes('交付文件'));
ok('每轮都带用户消息本体', P.buildPrompt('你好', null, false).includes('【用户说】你好'));
// v4.5：面板拉历史时还原用户原话（兼容新老两种记录格式）
eq('新版记录：【用户说】之后就是原话', P.sessionUserText('【用户说】下午好啊'), '下午好啊');
eq('老版记录（v3.x 无前缀）：原样使用', P.sessionUserText('okok'), 'okok');
eq('首轮人设块不进面板', P.sessionUserText('【桌宠设定·系统级，始终遵守】\n你是…'), '');
eq('余额块不进面板', P.sessionUserText('【余额】还剩…\n\n【用户说】嗯'), '嗯');
eq('JSON 注入不进面板', P.sessionUserText('{"env":"# 运行环境快照…"}'), '');
eq('空串安全', P.sessionUserText(''), '');
// v4.6：会话记录里的调用统计/环境快照等元数据不进面板
ok('识别调用统计 JSON（不进面板）', P.looksLikeMetaJson('{"envHash":"74872a81","est":128674,"usage":{"prompt":92985}}'));
ok('识别 env 快照 JSON', P.looksLikeMetaJson('{"env":"# 运行环境快照（最新，取代更早的快照）","model":"x"}'));
eq('正常助手回复不误判', P.looksLikeMetaJson('哦～阳哥终于信了 [stick:archive:卖萌]'), false);
eq('普通 JSON 短句不误判', P.looksLikeMetaJson('{"a":1}'), false);
eq('非 JSON 不误判', P.looksLikeMetaJson('你好呀'), false);
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
    P.ASSET_SPRITE === P.ASSET_DIR + 'feiyu-spritesheet.webp' && P.ASSET_STICKER === P.ASSET_DIR &&
    P.ASSET_SKIN_DEFAULT === P.ASSET_DIR + 'pet-bongocat.png',
    P.ASSET_SPRITE);
}

console.log('\n[韵律跟读（TTS → 音高/口型 → 重唱）· v3.4]');
{
  const sr = 16000, n = sr * 1;                       // 1 秒 16k
  const tone = new Float32Array(n);
  for (let i = 0; i < n; i++) tone[i] = 0.4 * Math.sin(2 * Math.PI * 200 * i / sr);
  const fr = P.analyzeFrame(tone, 2048, 1024, sr, 0);
  ok('单帧基频检测准确（200Hz 正弦 → 检出 ±8%）', Math.abs(fr.f0 - 200) / 200 < 0.08, 'f0=' + fr.f0.toFixed(1));
  ok('有声帧标记为浊音且能量合理', fr.f0 > 0 && fr.rms > 0.1, 'rms=' + fr.rms.toFixed(3));
  const sil = new Float32Array(1024);
  ok('静音帧不报音高', P.analyzeFrame(sil, 0, 1024, sr, 200).f0 === 0);

  const track = P.prosodyTrack(tone);
  ok('韵律轨按 20ms 一帧切好', track.frames.length === Math.floor((n - 1024) / 320) + 1 && Math.abs(track.hopSec - 0.02) < 1e-6,
    track.frames.length + ' 帧');
  const vowels = new Set(track.frames.map((f) => f.vowel));
  ok('口型档有区分（过零率映射）', vowels.size >= 1);

  const out = P.synthFollow(track, { voice: 'fish' });
  ok('（已弃用的连续重唱仍在库里，仅作对照）', out.length > 0);
  // v3.4.1 默认路径：语调引导（在声线音阶里按相似度选音）
  eq('选音：659Hz 落在声线音阶的 E5(76)', P.pickScaleMidi(659.3, P.VOICES.fish.scale), 76);
  eq('选音：最接近的音高被选中（800Hz → G5=79）', P.pickScaleMidi(800, P.VOICES.fish.scale), 79);
  ok('选音：没有可用音高时回落到音阶首音', P.pickScaleMidi(0, P.VOICES.fish.scale) === P.VOICES.fish.scale[0]);
  ok('选音：允许整体平移一个八度贴合低音色', P.pickScaleMidi(330, P.VOICES.fish.scale) < P.VOICES.fish.scale[0], String(P.pickScaleMidi(330, P.VOICES.fish.scale)));
  {
    // 相对走向映射：高低起伏要留得住（真实语音常跨 15+ 半音，音阶只有 8 个半音）
    const list = P.guidedPickList([310, 320, 210, 130, 110, 175, 115, 145, 175, 138, 100], P.VOICES.fish.scale);
    eq('选音按字数逐个给出', list.length, 11);
    ok('高音字落在音阶高处、低音字落在低处（形状留住了）', list[0] > list[4] && list[1] >= list[4], JSON.stringify(list));
    ok('用到了多档音高（不是全挤在一个音上）', new Set(list).size >= 3, '档数=' + new Set(list).size);
    ok('全部落在声线音阶内', list.every((m) => P.VOICES.fish.scale.indexOf(m) >= 0));
    const flat = P.guidedPickList([200, 200, 200], P.VOICES.fish.scale);
    ok('没有起伏时落在中间档', new Set(flat).size === 1 && flat[0] === P.VOICES.fish.scale[Math.round((P.VOICES.fish.scale.length - 1) / 2)], JSON.stringify(flat));
  }
  const tg = P.guidedTargets(track, 4);
  ok('按字数把 TTS 的浊音段分成目标音高（取中位）', tg.length === 4 && tg.every((v) => v > 100 && v < 400), JSON.stringify(tg.map((v) => Math.round(v))));
  const g = P.synthGuided('今天吃白饭？没饭了！', track, { voice: 'fish' });
  ok('引导合成产出与经典同规格的音频', g.length > 44100 * 0.5 && g.length < 44100 * 6, g.length + ' 采样');
  {
    let pk = 0, bad = 0;
    for (let i = 0; i < g.length; i++) { const a = Math.abs(g[i]); if (a > pk) pk = a; if (!(a <= 1)) bad++; }
    ok('引导合成值域正常（软限幅内）', pk > 0.05 && bad === 0, 'peak=' + pk.toFixed(3));
  }
  {
    // 有起伏的语调应当产出有起伏的音高；平坦的语调则落在同一个音（这正是"选音"的语义）
    const mk = (f0s) => ({ hopSec: 0.02, durSec: 1, frames: f0s.map((f) => ({ f0: f, rms: 0.2, vowel: 0 })) });
    const rising = mk([120, 140, 170, 210, 250, 300, 330, 330]);
    const flatLine = mk([200, 200, 200, 200, 200, 200, 200, 200]);
    const a1 = P.synthGuided('白饭', rising, { voice: 'fish' });
    const a2 = P.synthGuided('白饭', flatLine, { voice: 'fish' });
    ok('有起伏的语调 → 与平坦语调不同的音高走向', a1.some((v, i) => Math.abs(v - (a2[i] || 0)) > 0.01));
    ok('平坦语调 → 两字同音（不硬造起伏）', P.guidedPickList([200, 200], P.VOICES.fish.scale).every((m, _, arr) => m === arr[0]));
  }
  ok('默认路径走的是引导合成（不再是连续重唱）',
    /synthGuided\(text, track/.test(readFileSync(path.join(ROOT, 'src/core/speech.js'), 'utf8')));

  ok('跟读默认开启，且可配置音色/语速', P.DEFAULTS.speechFollow === true && P.DEFAULTS.ttsVoice === '' && P.DEFAULTS.ttsRate === 1);
  const st = P.speechState();
  ok('状态快照带跟读信息', st.follow === true && st.ttsCached === 0);
  ok('常用语库默认是空数组（存在本机）', Array.isArray(P.DEFAULTS.phrases) && P.DEFAULTS.phrases.length === 0);
}

console.log('\n[单击只弹一个气泡 + 菜单不出界 · v3.10.1]');
{
  const t = readFileSync(path.join(ROOT, 'client.js'), 'utf8');
  ok('连戳台词不再自己 bubbleSay（改为排队给单击气泡）', /pendingSpecialLine/.test(t) && /pendingSpecialLine = '戳戳戳/.test(t));
  ok('连戳台词在 onPetSingleClick 里优先使用', /const special = pendingSpecialLine/.test(t) && /special \|\| pickPokeLine\(\)/.test(t));
  ok('双击时清掉排队的特殊台词（不串到下一次）', /pendingSpecialLine = ''; onPetDoubleClick\(\)/.test(t));
  const m = t.match(/function clampMenuToViewport[\s\S]{0,700}/);
  ok('菜单按实测尺寸夹进视口', !!m && /getBoundingClientRect\(\)/.test(m[0]) && /vw - mw - 6/.test(m[0]));
  ok('不再硬编码 200×300 的夹取', !/window\.innerWidth - 200/.test(t));
  ok('展开子菜单后重新夹一次', /clampMenuToViewport\(\);   \/\/ v3\.10\.1：展开\/收起后高度变了/.test(t));
}

{
  const t = readFileSync(path.join(ROOT, 'client.js'), 'utf8');
  ok('内置反应词 ≥ 8 条', /POKE_DEFAULT = \[/.test(t) && (t.match(/POKE_DEFAULT = \[([\s\S]*?)\];/) || ['', ''])[1].split(',').length >= 8);
  ok('单击时随机挑一条反应词', /pickPokeLine/.test(t) && /Math\.random\(\)/.test(t));
  ok('反应词后面跟括号里的余额', /'（' \+ balanceLine\(d\) \+ '）'/.test(t));
  ok('台词可在面板里编辑（台词与开场白…）', /台词与开场白…/.test(t) && /function openLineEditor/.test(t));
  ok('可增/删/改反应词并恢复默认', /\+ 加一条/.test(t) && /恢复内置默认/.test(t));
  ok('AI 生成：读人设+聊天记录（走助手通道，要求 JSON 数组）', /async function aiGenLines/.test(t) && /JSON 字符串数组/.test(t) && /sendViaAssistant\(ask/.test(t));
  ok('开场白也能 AI 生成', /AI 生成开场白/.test(t));
  ok('可关闭/每天/每周自动更新', /每天自动更新一次/.test(t) && /每周自动更新一次/.test(t) && /pokeAutoDays/.test(t));
  ok('启动时按周期检查（延后执行）', /function maybeAutoRefreshLines/.test(t) && /maybeAutoRefreshLines\(\);/.test(t));
  ok('默认值：反应词空（用内置）、周期关闭', P.DEFAULTS.pokeLines.length === 0 && P.DEFAULTS.pokeAutoDays === 0);
}

{
  ok('「们建个营销群嘛」判定为错误称呼', P.nicknameLooksWrong('们建个营销群嘛') === true);
  ok('「我们建个营销群嘛」也算错', P.nicknameLooksWrong('我们建个营销群嘛') === true);
  ok('超长（>6 字）判定为错', P.nicknameLooksWrong('今天天气真不错啊') === true);
  ok('正常名字保留：阳哥', P.nicknameLooksWrong('阳哥') === false);
  ok('正常名字保留：李群（含"群"但不算句子）', P.nicknameLooksWrong('李群') === false);
  ok('正常名字保留：杨镇城', P.nicknameLooksWrong('杨镇城') === false);
  ok('英文/数字名保留：Yzc_01', P.nicknameLooksWrong('Yzc_01') === false);
  ok('空值不算错', P.nicknameLooksWrong('') === false && P.nicknameLooksWrong(null) === false);
  const t2 = readFileSync(path.join(ROOT, 'client.js'), 'utf8');
  ok('启动时会自动清理历史脏称呼并提示', /cleanStaleNickname/.test(t2) && /记岔了/.test(t2));
}

{
  const t = readFileSync(path.join(ROOT, 'client.js'), 'utf8');
  const css5 = readFileSync(path.join(ROOT, 'client.css'), 'utf8');
  ok('气泡面板标题栏可拖动（v4.6 起不再记忆位置，下次打开回到贴桌宠头顶）', /dragDx/.test(t) && !/settings\.chatpPos = \{/.test(t) && /pb2-chatp-head \{ cursor: move/.test(css5));
  ok('贴纸/图片在气泡里限尺寸（不再撑爆）', /\.pb2-chatp-msg img \{[^}]*max-width: 118px/.test(css5));
  ok('桌宠大小可调（菜单档位 + 设置滑块）', /function cyclePetSize/.test(t) && /sizeRange/.test(t) && /settings\.size = clamp/.test(t));
  ok('大小档位含 小/中/大/特大', /label: '小', size: 72/.test(t) && /label: '特大', size: 168/.test(t));
  ok('彻底删除（deletedSkins，永久）', /deletedSkins/.test(t) && /彻底删除/.test(t));
  ok('已彻底删除的不再出现在列表', /deleted\.indexOf\(m\.id\) < 0/.test(t));
  ok('互动形变（果冻）与开关', /function jellyPulse/.test(t) && /@keyframes pb2-jelly/.test(css5) && /function toggleJelly/.test(t));
  ok('果冻形变幅度较小（0.93~1.06 区间）', /scale\(1\.06, \.93\)/.test(css5) && !/scale\(1\.[2-9]/.test(css5));
  // 称呼
  ok('称呼提取收紧到 2~6 字且排除虚词', /\[\\u4e00-\\u9fa5A-Za-z0-9_·\]\{2,6\}/.test(readFileSync(path.join(ROOT, 'src/core/chat.js'), 'utf8')));
  ok('手动设过称呼后锁定，不再被聊天改掉', /nicknameLock/.test(t));
  const before = P.settings.nickname;
  P.settings.nicknameLock = false;
  eq('“我是阳哥”能认出来', P.extractNickname('我是阳哥'), '阳哥');
  eq('“我们建个营销群嘛”不会被当成名字', P.extractNickname('我是我们建个营销群嘛'), null);
  eq('“我是谁”不会被当成名字', P.extractNickname('我是谁'), null);
  P.settings.nickname = '阳哥'; P.settings.nicknameLock = true;
  eq('锁定后聊天里改不动', P.extractNickname('我是小明'), null);
  eq('锁定期间称呼保持不变', P.settings.nickname, '阳哥');
  P.settings.nickname = before; P.settings.nicknameLock = false;
}

{
  const t = readFileSync(path.join(ROOT, 'client.js'), 'utf8');
  ok('余额格式三种（简洁/详细/傲娇）', /id: 'short'/.test(t) && /id: 'detail'/.test(t) && /id: 'playful'/.test(t));
  ok('默认用简洁格式（不再一长串）', P.DEFAULTS.balanceStyle === 'short');
  ok('可循环切换余额格式并立即展示', /function cycleBalanceStyle/.test(t) && /onPetSingleClick\(\);/.test(t));
  ok('菜单里有「余额格式」和「开场白…」', /余额格式：/.test(t) && /开场白…/.test(t));
  ok('开场白可在设置里编辑（带变量说明）', /function openGreetingEditor/.test(t) && /\{greet\}/.test(t) && /\{nickname\}/.test(t));
  ok('开场白默认空（空=用默认那句）', P.DEFAULTS.greeting === '');
  ok('启动时走 openLine（自定义优先）', /function openLine/.test(t) && /bubbleSay\(openLine\(\)/.test(t));

  // 三种格式的文案差异（用一份假数据）
  const d = { valey: false, valley: false, prompt: 1000000, cacheHit: 800000, output: 20000, calls: 5,
              costCredits: 240, cost: 0.24, sessions: 2, staleSessions: 0, apiOk: true, date: '2026-11-19',
              realOk: true, realToday: 120,
              companyQuota: { ok: true, points: 100000, remainPoints: 88000, usedPoints: 12000, periodText: '每月 1 号' },
              credits: { ok: false } };
  P.settings.balanceStyle = 'short';
  const s = P.balanceLine(d);
  P.settings.balanceStyle = 'playful';
  const pl = P.balanceLine(d);
  P.settings.balanceStyle = 'detail';
  const de = P.balanceLine(d);
  ok('简洁格式：短（≤ 40 字）且含剩余与今日', s.length <= 40 && /88,000/.test(s) && /今日/.test(s), s);
  ok('傲娇格式：带口吻词', /哼/.test(pl) && /88,000/.test(pl), pl);
  ok('详细格式：含总额与已用', /100,000/.test(de) && /12,000/.test(de), de);
  ok('详细格式比简洁长', de.length > s.length, de.length + ' vs ' + s.length);
  P.settings.balanceStyle = 'short';
}

{
  const t = readFileSync(path.join(ROOT, 'client.js'), 'utf8');
  const sp = readFileSync(path.join(ROOT, 'src/core/speech.js'), 'utf8');
  // 断句
  ok('表情/贴纸标记转成停顿标记（不念但有气口）', /replace\(\/\\\[\(\?:stick\|fish\|bean\)[^;]*'｜'/.test(sp) || /'｜'\)/.test(sp));
  eq('剥标记后保留停顿点', P.speechClean('好看吗 [stick:archive:比心] 真的'), '好看吗｜真的');
  const segs = P.speechSegments('今天吃白饭？没饭了！还有，别催。');
  ok('按标点切段', segs.length >= 3, JSON.stringify(segs.map(s => s.text)));
  ok('句末停顿 > 逗号停顿', P.pauseOf('。') > P.pauseOf('，'), P.pauseOf('。') + ' vs ' + P.pauseOf('，'));
  ok('表情标记停顿最明显', P.pauseOf('｜') > P.pauseOf('。'), P.pauseOf('｜') + ' vs ' + P.pauseOf('。'));
  {
    const a = P.synthPaced('白饭。没饭了！', { voice: 'fish' });
    const b = P.synthPaced('白饭没饭了', { voice: 'fish' });
    ok('经典合成带断句后更长（插入了静音）', a.length > b.length, a.length + ' vs ' + b.length);
    const g = P.synthGuided('白饭。没饭了！', { hopSec: 0.02, durSec: 1, frames: Array.from({ length: 60 }, () => ({ f0: 220, rms: 0.2, vowel: 0 })) }, { voice: 'fish' });
    ok('语调引导同样带断句（产出正常）', g.length > 44100 * 0.3, g.length + ' 采样');
  }
  // 两重音色
  ok('bibo音色与朗读音色分成两项（菜单里）', /bibo音色：/.test(t) && /朗读音色：/.test(t));
  ok('朗读音色从宿主接口取（GET /api/voice/voices）', /\/api\/voice\/voices/.test(t) && /function fetchTtsVoices/.test(t));
  ok('朗读音色有兜底清单', /zh-CN-XiaoxiaoNeural/.test(t) && /TTS_FALLBACK_VOICES/.test(t));
  ok('可以循环切换朗读音色', /function cycleTtsVoice/.test(t));
  // 模型移除
  ok('内置模型可移除（hiddenSkins）', /hiddenSkins/.test(t) && /'移除'/.test(t));
  ok('移除后可一键恢复', /恢复已移除的模型/.test(t));
  ok('移除当前皮肤会自动换回官方形象', /settings\.skin === m\.id\) \{ settings\.skin = 'fish'/.test(t));
}

{
  const t = readFileSync(path.join(ROOT, 'client.js'), 'utf8');
  const css4 = readFileSync(path.join(ROOT, 'client.css'), 'utf8');
  ok('静态图皮肤已绝对定位（不再被 viewport 挤到 wrap 下方）',
    /\.pb2-skin-img \.pb2-img-skin\s*\{[^}]*position:\s*absolute/.test(css4));
  ok('静态图贴底对齐（object-position: bottom center）', /\.pb2-skin-img \.pb2-img-skin\s*\{[^}]*object-position:\s*bottom center/.test(css4));
  ok('wrap 尺寸按图片比例自适应（petAspect）', /function petAspect/.test(t) && /petWrap\.style\.height = s\.h/.test(t));
  ok('图片加载完成后重算布局（切换皮肤不再用旧图比例）', /imgSkin\.onload = \(\) => \{[^}]*refreshLayout/.test(t));

  ok('气泡聊天面板已实现（无地址栏/无边框/圆角气泡）',
    /function openChatPanel/.test(t) && /pb2-chatp/.test(t) && /\.pb2-chatp\s*\{[^}]*position:\s*fixed/.test(css4));
  ok('气泡面板支持发送/渲染/朗读联动', /chatpSend/.test(t) && /renderRich\(row, text\)/.test(t) && /speak\(r\.text\)/.test(t));
  ok('菜单第一项是「气泡聊天」', /label: '气泡聊天', act: openChatPanel/.test(t));

  ok('朗读三档（语调引导 / 经典合成 / 普通朗读）',
    /id: 'guided'/.test(t) && /id: 'classic'/.test(t) && /id: 'tts'/.test(t));
  ok('普通朗读走 TTS 原始人声（via=tts，不改采样率）',
    /via = 'tts'/.test(readFileSync(path.join(ROOT, 'src/core/speech.js'), 'utf8')));
  ok('菜单按栏整理：bibo语音 / bibo音效 / 桌宠 / 设置',
    /label: 'bibo语音'/.test(t) && /label: 'bibo音效'/.test(t) && /label: '桌宠'/.test(t) && /label: '设置'/.test(t));
  ok('音效音量可在菜单里循环调节', /function cycleSfxVolume/.test(t) && /音效音量：/.test(t));
}

{
  const t = readFileSync(path.join(ROOT, 'client.js'), 'utf8');
  const css3 = readFileSync(path.join(ROOT, 'client.css'), 'utf8');
  const mf3 = JSON.parse(readFileSync(path.join(ROOT, 'assets.manifest.json'), 'utf8'));
  const iconGroup = mf3.groups.find((g) => g.id === 'icons');
  ok('图标组已登记（14 个）', !!iconGroup && iconGroup.files.length === 14);
  ok('14 个图标文件都在仓库里', iconGroup.files.every((f) => existsSync(path.join(ROOT, f))));
  ok('菜单项改用自绘图标名（不再用 emoji）',
    /icon: 'chat'/.test(t) && /icon: 'speaker'/.test(t) && /icon: 'mic'/.test(t) && !/icon: '💬'/.test(t));
  ok('图标渲染走 menuIcon（带加载失败兜底）', /function menuIcon/.test(t) && /im\.onerror/.test(t));
  ok('CSS 有图标尺寸规则（17px，object-fit: contain）',
    /\.pb2-mico\s*\{[^}]*width:\s*17px/.test(css3) && /\.pb2-mico\s*\{[^}]*object-fit:\s*contain/.test(css3));
  ok('菜单风格优化：毛玻璃 + 渐变分隔 + 悬停微动',
    /\.pb2-menu\s*\{[^}]*backdrop-filter/.test(css3) && /\.pb2-mico\s*\{[^}]*transition/.test(css3) &&
    /\.pb2-menu \.pb2-mi:hover \.pb2-mico/.test(css3));
  ok('弹窗风格优化：遮罩柔化 + 标题栏渐变 + 控件聚焦环',
    /\.pb2-mask\s*\{[^}]*backdrop-filter/.test(css3) &&
    /\.pb2-dtitle\s*\{[^}]*linear-gradient/.test(css3) &&
    /\.pb2-dbody input:focus/.test(css3));
  ok('按钮/卡片有悬停动效', /\.pb2-dbody button:hover/.test(css3) && /\.pb2-model-card:hover/.test(css3));
}

{
  ok('和大人皮肤已登记（动画 WebP，120 帧）', !!P.IMAGE_SKINS.hedaren && P.IMAGE_SKINS.hedaren.file === 'pet-hedaren.webp' && P.IMAGE_SKINS.hedaren.anim === true);
  ok('RYANFFY 大肥鱼立绘已登记（静态）', !!P.IMAGE_SKINS.ryan && P.IMAGE_SKINS.ryan.file === 'pet-dafeiyu-ryan.png' && !P.IMAGE_SKINS.ryan.anim);
  ok('两个新皮肤都不叠浮空爪（素材自带身体）', P.IMAGE_SKINS.hedaren.paw === false && P.IMAGE_SKINS.ryan.paw === false);
  ok('署名齐全（许可要求）', /Yukilol13/.test(P.IMAGE_SKINS.hedaren.credit) && /RYANFFY/.test(P.IMAGE_SKINS.ryan.credit));
  ok('素材文件都在仓库里', existsSync(path.join(ROOT, 'pet-hedaren.webp')) && existsSync(path.join(ROOT, 'pet-dafeiyu-ryan.png')));
  const mf = JSON.parse(readFileSync(path.join(ROOT, 'assets.manifest.json'), 'utf8'));
  const listed = mf.groups.flatMap((g) => g.files);
  ok('两张新素材已登记进清单', listed.indexOf('pet-hedaren.webp') >= 0 && listed.indexOf('pet-dafeiyu-ryan.png') >= 0);
  ok('许可说明文件随包分发', existsSync(path.join(ROOT, 'LICENSE-community-pets.txt')));
  const css2 = readFileSync(path.join(ROOT, 'client.css'), 'utf8');
  ok('动画皮肤不叠加呼吸动画（避免两层变形）', /\.pb2-skin-anim \.pb2-img-skin\s*\{[^}]*animation:\s*none/.test(css2));
  ok('模型选择器会列出全部内置皮肤', Object.keys(P.IMAGE_SKINS).length >= 3);
}

{
  const t = readFileSync(path.join(ROOT, 'client.js'), 'utf8');
  const css = readFileSync(path.join(ROOT, 'client.css'), 'utf8');
  ok('菜单里有朗读模式 / 音色 / 速度三项（当前值写在文字上）',
    /朗读模式：/.test(t) && /朗读音色：/.test(t) && /朗读速度：/.test(t));
  ok('三项都是"点一下循环切换"且不关菜单（keepOpen）',
    (t.match(/keepOpen: true/g) || []).length >= 4);
  ok('音色在 fish / lumo 之间切换', /function cycleSpeechVoice/.test(t) && /SPEECH_VOICE_NAMES/.test(t));
  ok('速度有档位表（慢/正常/快/很快）',
    /慢', step: 0\.18/.test(t) && /很快', step: 0\.08/.test(t));
  ok('模式切换会清掉 TTS/韵律缓存（换了马上生效）',
    /cycleSpeechStyle/.test(t) && /ttsCache\.clear\(\)/.test(t));
  ok('切换时给气泡反馈并试听一句', /朗读模式：' \+ speechStyleLabel/.test(t) && /speechProbe\(/.test(t));
  ok('菜单限高可滚（贴屏幕边缘不顶出可视区）',
    /\.pb2-menu\s*\{[^}]*max-height/.test(css) && /\.pb2-menu\s*\{[^}]*overflow-y:\s*auto/.test(css));
  ok('长菜单项省略号，不换行撑破', /\.pb2-menu \.pb2-mlabel\s*\{[^}]*text-overflow:\s*ellipsis/.test(css));
  ok('子菜单也限高可滚', /\.pb2-submenu\s*\{[^}]*max-height/.test(css));
}

{
  const t = readFileSync(path.join(ROOT, 'client.js'), 'utf8');
  ok('模型：改名（小输入弹窗，不依赖 window.prompt）', /function askText/.test(t) && /给这张模型起个名字/.test(t));
  ok('模型：导出模型包（.json 下载）', /function exportSkinPack/.test(t) && /petbuddy-skins-/.test(t));
  ok('模型：导入模型包（校验 dataUrl / 上限 24 个）', /function importSkinPackFile/.test(t) && /slice\(-24\)/.test(t));
  ok('模型：删除保留（自定义可删，内置只能移除）', /pb2-mini-danger/.test(t) && /settings\.customSkins\.filter/.test(t));
  ok('常用语：增 / 删 / 改 / 查（列表 + 点一条就念）',
    /function openPhraseBook/.test(t) && /'添加'/.test(t) && /'说'/.test(t) && /'改'/.test(t) && /'删'/.test(t));
  ok('常用语上限 30 条且去重', /最多 30 条/.test(t) && /arr\.some\(x => x\.text === t\)/.test(t));
  ok('菜单里有「常用语…」入口', /常用语…/.test(t));
  ok('设置面板有「风格」下拉（语调引导 / 经典）', /语调引导（还是哔哔啵啵的音色/.test(t) && /经典合成（完全按字/.test(t));
}
console.log('\n[皮肤：BongoCat 与浮空爪图层 · v3.3.3]');
{
  const im = P.IMAGE_SKINS.bongo;
  ok('内置静态皮肤换成 BongoCat 键盘猫', !!im && im.file === 'pet-bongocat.png' && /BongoCat/.test(im.name));
  ok('BongoCat 皮肤：默认帧 + 按下帧 + 声明不叠浮空爪',
    im.fileDown === 'pet-bongocat-down.png' && im.paw === false);
  ok('皮肤分类判断（精灵图 / 静态图 / 自定义）',
    P.isSpriteSkin('codex') && P.isImageSkin('bongo') && !P.isImageSkin('codex') && !P.isImageSkin('custom:1'));
  ok('女仆素材已下线（文件与清单都不再有它）',
    !existsSync(path.join(ROOT, 'pet-deepseek.webp')) &&
    JSON.stringify(JSON.parse(readFileSync(path.join(ROOT, 'assets.manifest.json'), 'utf8'))).indexOf('pet-deepseek') < 0);
  const clientTxt = readFileSync(path.join(ROOT, 'client.js'), 'utf8');
  ok('老设置 maid 自动迁移到 bongo', /settings\.skin === 'maid'/.test(clientTxt) && /settings\.skin = 'bongo'/.test(clientTxt));
  ok('浮空爪图层对自带爪子的皮肤关闭（不再出现飘着的肉垫）',
    /currentPawEnabled/.test(clientTxt) && /im\.paw !== false/.test(clientTxt));
  ok('键鼠互动改走按下帧（pawFramePulse + 节流）',
    /pawFramePulse/.test(clientTxt) && /pawPulseAt/.test(clientTxt));
  ok('BongoCat 素材已登记进素材清单',
    JSON.parse(readFileSync(path.join(ROOT, 'assets.manifest.json'), 'utf8')).groups
      .flatMap((g) => g.files).indexOf('pet-bongocat.png') >= 0);
}

console.log('\n[素材清单 · v3.1.0]');
{
  const mf = JSON.parse(readFileSync(path.join(ROOT, 'assets.manifest.json'), 'utf8'));
  const listed = mf.groups.flatMap((g) => g.files);
  const onDisk = readdirSync(ROOT).filter((f) => /\.(webp|png|webm)$/i.test(f));
  ok('清单声明平铺布局（宿主不支持子目录）', mf.layout === 'flat', mf.layout);
  eq('清单条数 = 磁盘素材条数', listed.length, onDisk.length);
  ok('清单里的文件都在，磁盘上的素材也都登记了',
    listed.every((f) => existsSync(path.join(ROOT, f))) && onDisk.every((f) => listed.indexOf(f) >= 0),
    `listed=${listed.length} disk=${onDisk.length}`);
  eq('贴纸清单与代码 ARCHIVE 表逐条一致',
    listed.filter((f) => f.indexOf('st-') === 0).sort(),
    P.ARCHIVE.map((a) => 'st-' + a.id + '.webp').sort());
  ok('社区桌宠包图集已登记（署名素材，随包分发）',
    listed.indexOf('pet-whale-codex.webp') >= 0 && P.ASSET_SPRITE_CODEX.endsWith('pet-whale-codex.webp'));
}

console.log('\n[音效与社区皮肤 · v3.3]');
{
  eq('音效谱齐（五个动作一声）', Object.keys(P.SFX_SPEC).join(','), 'tap,pop,drop,ok,err');
  ok('音效都是单字（啵/叮/唰/嗯/哔）', Object.keys(P.SFX_SPEC).every((k) => P.SFX_SPEC[k].text.length === 1),
    Object.keys(P.SFX_SPEC).map((k) => P.SFX_SPEC[k].text).join(''));
  const st = P.sfxState();
  ok('音效状态可读（离线环境无音频上下文）', st.enabled === true && st.hasGain === false && st.names.length === 5, JSON.stringify(st));
  ok('无音频环境时 sfx 返回 false、不抛错', P.sfx('tap') === false && P.sfx('没有这个音效') === false);
  P.settings.sfxOn = false;
  ok('音效开关关闭时直接不响', P.sfx('tap') === false);
  P.settings.sfxOn = true;

  ok('精灵图皮肤：官方 + 社区包（同一套网格规格，可直接换图）',
    P.isSpriteSkin('fish') && P.isSpriteSkin('codex') && !P.isSpriteSkin('maid') && !P.isSpriteSkin('custom:1'));
  eq('默认皮肤仍是官方图集', P.isSpriteSkin(P.settings.skin === undefined ? 'fish' : P.settings.skin), true);
  ok('社区皮肤带署名（许可要求）', /YunYueSama/.test(P.SPRITE_SKINS.codex.credit) && /codex-deepseek-pet/.test(P.SPRITE_SKINS.codex.credit), P.SPRITE_SKINS.codex.credit);
  ok('社区皮肤名称可直接显示', /大肥鱼/.test(P.SPRITE_SKINS.codex.name));
  ok('两套精灵图都指向插件根目录（含回退前缀）',
    P.SPRITE_SKINS.fish.url.endsWith('feiyu-spritesheet.webp') && P.SPRITE_SKINS.codex.url.endsWith('pet-whale-codex.webp'),
    P.SPRITE_SKINS.codex.url);
}

console.log('\n[桌面版兼容修复 · v3.3.1]');
{
  // 资源基准：宿主可能用 file 协议加载页面，JS 拼的根相对路径会失效 —— 改由 CSS 解析出绝对 URL
  ok('无 getComputedStyle 环境下 resolveAssetUrls 安全回退（不抛错）',
    P.resolveAssetUrls(null).ok === false);

  // 用最小 DOM 桩验证"探针元素 + computed style"这条解析链（真实走的就是它）
  const fakeEl = { style: {}, setAttribute() {}, remove() {}, appendChild() {} };
  const fakeHost = { appendChild() {} };
  sandbox.document = { createElement: () => fakeEl, body: fakeHost, documentElement: fakeHost };
  sandbox.getComputedStyle = () => ({ backgroundImage: 'url("file:///C:/x/%E6%8F%92%E4%BB%B6%E5%85%BC%E5%AE%B9%E5%B1%82/pet-buddy/icon.png")' });
  const r = P.resolveAssetUrls(fakeHost);
  ok('能从 CSS 探针解析出素材绝对目录（file:// 场景）',
    r.ok === true && r.base === 'file:///C:/x/%E6%8F%92%E4%BB%B6%E5%85%BC%E5%AE%B9%E5%B1%82/pet-buddy/', JSON.stringify(r));
  eq('解析后贴纸前缀跟着走（桌面版里贴纸也修好了）', P.assetDir(), 'file:///C:/x/%E6%8F%92%E4%BB%B6%E5%85%BC%E5%AE%B9%E5%B1%82/pet-buddy/');
  eq('解析后皮肤图 URL 跟着走', P.spriteSkinUrl('codex'),
    'file:///C:/x/%E6%8F%92%E4%BB%B6%E5%85%BC%E5%AE%B9%E5%B1%82/pet-buddy/pet-whale-codex.webp');
  sandbox.getComputedStyle = () => ({ backgroundImage: 'none' });
  ok('探针取不到时不误改（保留回退前缀）', P.cssAssetBase(fakeHost) === '');

  // 候选前缀：根相对（走宿主静态服务）必须排第一，CSS/推导/页面目录作为后备
  const cands = P.assetBaseCandidates();
  eq('候选前缀首选根相对（新素材也能取到）', cands[0], '/_plugins/pet-buddy/');
  ok('候选去重且不含无效项', cands.every((c) => c.indexOf('undefined') < 0) && new Set(cands).size === cands.length, JSON.stringify(cands));
  // 补上 origin 与 CSS 基准后，应能收集出多个候选（真实页面就是这么拿的）
  sandbox.location = { origin: 'http://127.0.0.1:8788', href: 'http://127.0.0.1:8788/' };
  sandbox.getComputedStyle = () => ({ backgroundImage: 'url("http://127.0.0.1:8788/_plugins/pet-buddy/icon.png")' });
  const cands2 = P.assetBaseCandidates();
  ok('多个候选都能收集（根相对 / http 绝对 / CSS 解析）',
    cands2.indexOf('/_plugins/pet-buddy/') === 0 &&
    cands2.indexOf('http://127.0.0.1:8788/_plugins/pet-buddy/') >= 0 &&
    cands2.indexOf('http://127.0.0.1:8788/') >= 0, JSON.stringify(cands2));
  ok('没有 Image 构造器时探测安全返回（不抛错）',
    await new Promise((res) => P.probeAssetBase((base, how) => res(base === '' && how === 'no-image'))));

  const clientTxt = readFileSync(path.join(ROOT, 'client.js'), 'utf8');
  const cssTxt = readFileSync(path.join(ROOT, 'client.css'), 'utf8');
  ok('折叠子菜单用点击就地展开（pb2-sub-open）', /pb2-sub-open/.test(clientTxt));
  ok('CSS 里子菜单是缩进列表（不再 absolute 弹到菜单外）',
    /\.pb2-submenu\s*\{[^}]*border-left/.test(cssTxt) && !/\.pb2-submenu\s*\{[^}]*position:\s*absolute/.test(cssTxt));
  ok('皮肤图加载失败时只提示一次、不改用户设置（下次再试）',
    /SKIN_WARNED/.test(clientTxt) && /设置不动，下次再试/.test(clientTxt));
  ok('探测完成后会按最终前缀重画皮肤（不再依赖 CSS 相对路径）',
    /probeAssetBase\(\(base, how, tried\)/.test(clientTxt) && /applyAssetBase/.test(clientTxt));

  // 皮肤切图改走 CSS 类：产物里必须有对应的类规则（否则社区皮肤切过去就是空白）
  const css = readFileSync(path.join(ROOT, 'client.css'), 'utf8');
  ok('CSS 里有社区皮肤的切图规则（相对路径，http/file 都能加载）',
    /\.pb2-pet-wrap\.pb2-skin-codex\s+\.pb2-sprite\s*\{[^}]*url\(["']?pet-whale-codex\.webp/.test(css));
  ok('CSS 里有素材基准探针（--pb2-asset-base）', /--pb2-asset-base:\s*url\(["']?icon\.png/.test(css));
  ok('精灵图尺寸走 CSS 变量（支持不同网格的图集）', /--pb2-sheet-w/.test(css));

  const clientSrc = readFileSync(path.join(ROOT, 'client.js'), 'utf8');
  ok('皮肤图加载失败会回退官方图集并提示（不再静默消失）',
    /verifySkinImage/.test(clientTxt) && /临时穿回原来的/.test(clientTxt));
  ok('右键菜单有「bibo语音」折叠子菜单 + 音效开关项',
    /bibo语音/.test(clientSrc) && /pb2-submenu/.test(clientSrc) && /音效：/.test(clientSrc));
  ok('托盘菜单里保留语音与音效入口（试听/闲聊/开关/设置）',
    /试听语音/.test(clientSrc) && /语音闲聊/.test(clientSrc) && /toggleSfx/.test(clientSrc));
}

console.log('\n[语音合成与播报 · v3.2]');
{
  const s = P.synth('没饭了？没饭了！', {voice: 'fish'});
  ok('合成产出非空采样', !!s && s.length > 44100 * 0.3, s ? String(s.length) : 'null');
  let peak = 0, bad = 0;
  for (let i = 0; i < s.length; i++) { const a = Math.abs(s[i]); if (a > peak) peak = a; if (!(a <= 1)) bad++; }
  ok('采样值域落在 [-1,1] 且不静音', peak > 0.05 && bad === 0, 'peak=' + peak.toFixed(3) + ' bad=' + bad);
  const wav = P.toWav(s);
  ok('WAV 容器头与长度正确', Buffer.from(wav.slice(0, 4)).toString('latin1') === 'RIFF' && wav.length === 44 + s.length * 2, 'len=' + wav.length);
  ok('同一个字永远同一声（哈希稳定）', P.hash('鱼') === P.hash('鱼') && P.hash('鱼') !== P.hash('饭'));
  ok('两个声线（大肥鱼高 / 路墨低）', P.VOICES.fish.scale[0] > P.VOICES.lumo.scale[0] && P.SPEECH_VOICE_NAMES.fish.indexOf('大肥鱼') >= 0);
  eq('分句按标点（问号句尾音处理的前提）', P.syllables('今天吃白饭？没饭了！').join(''), '今天吃白饭没饭了');

  eq('朗读前把贴纸标记换成停顿点（v3.7：表情也算断句）', P.speechClean('好看吗 [stick:archive:比心] 真的'), '好看吗｜真的');
  eq('只有贴纸标记时视为没内容', P.speechClean('[stick:archive:比心]').replace(/[｜\s]+/g, ''), '');
  eq('朗读前剥掉链接与 markdown', P.speechClean('看 **这里** https://a.b/c 吧'), '看 这里 吧');
  eq('代码块不念出来', P.speechClean('看代码 ```js\nconst a=1;\n``` 好了'), '看代码 好了');
  ok('超长按上限截断并加省略号', /……$/.test(P.speechClean('一'.repeat(200))), P.speechClean('一'.repeat(200)).slice(-6));

  ok('状态快照可读（离线环境没有音频上下文）', P.speechState().hasCtx === false && P.speechState().enabled === true);
  const sp = await P.speak('测试一句');
  ok('没有音频上下文时不抛错，只回答原因（静默降级）', sp.ok === false && sp.reason === 'no-ctx', JSON.stringify(sp));
  P.settings.speechOn = false;
  const off = await P.speak('测试');
  ok('开关关闭时直接跳过（skipped=off）', off.ok === false && off.skipped === 'off', JSON.stringify(off));
  P.settings.speechOn = true;
  const empty = await P.speak('[stick:archive:比心]');
  ok('清洗后为空就不说（skipped=empty）', empty.ok === false && empty.skipped === 'empty', JSON.stringify(empty));
}

console.log('\n[v4.1 自定义动图皮肤]');
{
  // ---- 动画判定：手工构造字节头，不依赖真实图片文件 ----
  const b64 = (bytes) => Buffer.from(bytes).toString('base64');
  const du = (mime, bytes) => 'data:image/' + mime + ';base64,' + b64(bytes);
  const GCE = [0x21, 0xF9, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00];   // Graphic Control Extension
  const gifAnim = du('gif', [0x47,0x49,0x46,0x38,0x39,0x61].concat([7,0,7,0], GCE, [0x2C,0,0,0,0,1,0,1,0,0], GCE, [0x3B]));
  const gifStill = du('gif', [0x47,0x49,0x46,0x38,0x39,0x61].concat([7,0,7,0], GCE, [0x2C,0,0,0,0,1,0,1,0,0], [0x3B]));
  const chunk = (tag, payload) => [...Buffer.from(tag, 'latin1')].concat(
    [payload.length & 255, (payload.length >> 8) & 255, (payload.length >> 16) & 255, (payload.length >> 24) & 255], payload);
  const riffBody = [...Buffer.from('WEBP', 'latin1')].concat(chunk('VP8X', [0x0A,0,0,0, 0,0,0,0,0,0]), chunk('ANIM', [0,0,0,0, 0,0]));
  const webpAnim = du('webp', [...Buffer.from('RIFF', 'latin1')].concat([riffBody.length & 255,0,0,0], riffBody));
  const webpStill = du('webp', [...Buffer.from('RIFF', 'latin1')].concat(
    [(4 + 8 + 4) & 255, 0, 0, 0], [...Buffer.from('WEBP', 'latin1')], chunk('VP8 ', [0x0A,0,0,0])));
  const pngStill = 'data:image/png;base64,' + Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A,0,0,0,13,0x49,0x48,0x44,0x52]).toString('base64');

  eq('GIF89a 含 ≥2 个 GCE → 动画', P.imgAnimKind(gifAnim), 'gif');
  eq('GIF89a 只有 1 个 GCE → 静态', P.imgAnimKind(gifStill), '');
  eq('WebP 含 ANIM chunk → 动画', P.imgAnimKind(webpAnim), 'webp');
  eq('WebP 只有 VP8 → 静态', P.imgAnimKind(webpStill), '');
  eq('PNG → 静态', P.imgAnimKind(pngStill), '');
  eq('非 data: 前缀 → 静态（不抛错）', P.imgAnimKind('http://x/a.gif'), '');

  // ---- 上限常量与存储预检 ----
  eq('静态图上限沿用 2MB', P.CUSTOM_STATIC_MAX, 2 * 1024 * 1024);
  eq('动图上限放宽到 4MB', P.CUSTOM_ANIM_MAX, 4 * 1024 * 1024);
  ok('动图上限 > 静态上限（分档生效）', P.CUSTOM_ANIM_MAX > P.CUSTOM_STATIC_MAX);
  ok('空列表 + 小图放得下', P.customSkinStoreFits([], 'data:image/gif;base64,AAAA') === true);
  ok('总量超预算（约 10MB localStorage）时明说放不下',
    P.customSkinStoreFits([{dataUrl: 'x'.repeat(9.0e6)}], 'data:image/gif;base64,' + 'A'.repeat(1024)) === false);

  // ---- anim 缓存标记（旧数据现场判定并记回内存） ----
  eq('anim:true 直接认', P.customSkinAnim({anim: true, dataUrl: 'x'}), true);
  eq('anim:false 直接认', P.customSkinAnim({anim: false, dataUrl: 'x'}), false);
  const legacy = {id: 'custom:1', name: '旧数据', dataUrl: gifAnim};
  eq('旧数据（无 anim）现场判定为动图', P.customSkinAnim(legacy), true);
  eq('判定结果写回缓存（下次不再算）', legacy.anim, true);
  const legacyStill = {id: 'custom:2', name: '旧静态', dataUrl: pngStill};
  eq('旧静态数据判定为静态并缓存', P.customSkinAnim(legacyStill) === false && legacyStill.anim === false, true);

  // ---- 空闲小动作 ----
  eq('图片皮肤空闲动作三档', P.IMG_IDLE_FUNS.length, 3);
  ok('动作类名都带 pb2-fun- 前缀', P.IMG_IDLE_FUNS.every((c) => c.indexOf('pb2-fun-') === 0));
  eq('pickIdleFunClass(0) 取第一档', P.pickIdleFunClass(0), P.IMG_IDLE_FUNS[0]);
  eq('pickIdleFunClass(0.999) 取最后一档', P.pickIdleFunClass(0.999), P.IMG_IDLE_FUNS[2]);
  ok('pickIdleFunClass() 随机也落在表内', P.IMG_IDLE_FUNS.indexOf(P.pickIdleFunClass()) >= 0);

  // ---- 产物同步（CSS/产物里不能再有旧 png 引用；关键新逻辑要在产物里） ----
  const cssV41 = readFileSync(path.join(ROOT, 'client.css'), 'utf8');
  const jsV41 = readFileSync(path.join(ROOT, 'client.js'), 'utf8');
  const htmlV41 = readFileSync(path.join(ROOT, 'chat.html'), 'utf8');
  ok('client.css 精灵图引用已换 WebP（无 png 残留）', cssV41.indexOf('feiyu-spritesheet.png') < 0 && cssV41.indexOf('feiyu-spritesheet.webp') >= 0);
  ok('chat.html 精灵图引用已换 WebP（无 png 残留）', htmlV41.indexOf('feiyu-spritesheet.png') < 0 && htmlV41.indexOf('feiyu-spritesheet.webp') >= 0);
  ok('空闲小动作三段 keyframes 都在 CSS 里', ['pb2-fun-wobble', 'pb2-fun-jump', 'pb2-fun-tilt'].every((k) => cssV41.indexOf('@keyframes ' + k) >= 0));
  ok('拖动时不播空闲动作', /\.pb2-pet-wrap\.pb2-dragging\s*\{\s*animation:\s*none/.test(cssV41));
  ok('上传处理带容量预检（存不下明说，不静默丢）', /customSkinStoreFits/.test(jsV41) && /本机存储放不下/.test(jsV41));
  ok('上传后 anim 标记落进 customSkins', /anim:\s*anim/.test(jsV41));
  ok('单击台词走 renderRich（[bean:sleep] 渲染成图，不再显示方括号文字）', /renderRich\(main,\s*head\)/.test(jsV41));
  ok('气泡面板位置跟随桌宠（v4.6：chatpFollowPet 每次打开重算，贴头顶 8px）',
   /function chatpFollowPet/.test(jsV41) && /window\.innerHeight - pr\.top\) \+ 8/.test(jsV41));
}

console.log('\n[v4.1 语音数字本地化]');
{
  eq('67834 → 六点八万（v4.4 口语简读，念得更快）', P.numToZh('67834'), '六点八万');
  eq('67.83 → 六十七点八三', P.numToZh('67.83'), '六十七点八三');
  eq('0.5 → 零点五', P.numToZh('0.5'), '零点五');
  eq('10 → 十（一十省略）', P.numToZh('10'), '十');
  eq('14 → 十四', P.numToZh('14'), '十四');
  eq('10000 → 一万', P.numToZh('10000'), '一万');
  eq('10001 → 一万（简读丢掉零头，语音够用）', P.numToZh('10001'), '一万');
  eq('60000 → 六万（整万不拖小数）', P.numToZh('60000'), '六万');
  eq('12345 → 一点二万', P.numToZh('12345'), '一点二万');
  eq('四位数仍精确读（6783 → 六千七百八十三）', P.numToZh('6783'), '六千七百八十三');
  eq('1234567（7 位）保持精确读法', P.numToZh('1234567'), '一百二十三万四千五百六十七');
  eq('9 → 九', P.numToZh('9'), '九');
  eq('0 → 零', P.numToZh('0'), '零');
  ok('≥9 位长号码逐位读（不按位值）', P.numToZh('13800001111') === '一三八零零零零一一一一');
  ok('speechClean 把余额数字念成中文（短读法）',
    P.speechClean('还剩 67834 分 ≈¥67.83').indexOf('六点八万') >= 0 && P.speechClean('还剩 67834 分').indexOf('67834') < 0);
  ok('数字简读后比精确读法短一半（语音提速）', P.numToZh('67834').length <= 5, P.numToZh('67834') + ' / ' + P.numToZh('67834').length + ' 字');
  eq('无数字的句子原样通过', P.speechClean('你好，我是坚祥数字助理'), '你好，我是坚祥数字助理');
}

console.log('\n[v4.2 zip 模型包上传]');
{
  /* 现场构造一个最小 zip（stored + deflate 各一条 + 目录条目），验证解析与解压都是真的 */
  const { deflateRawSync } = await import('node:zlib');
  const crc32 = (u8) => {                              // 标准 CRC32（目录里带着；解析器不校验，但格式要像样）
    const table = [];
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
    let crc = 0xFFFFFFFF;
    for (const b of u8) crc = table[(crc ^ b) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  };
  const pad = (n) => Buffer.alloc(n, 0xAB);   // 填充字节（让条目尺寸过 64 字节门槛，考察规则本身而非尺寸）
  const specs = [
    { name: 'pack/main-character.png', method: 0, data: Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3, 4, 5]), pad(300)]) },
    { name: 'pack/preview/dance.gif',  method: 8, data: Buffer.concat([Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 7, 0, 7, 0]), pad(400)]) },
    { name: 'tiny.txt',                method: 0, data: Buffer.from('x'.repeat(200)) },
    { name: '__MACOSX/junk.png',       method: 0, data: Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47]), pad(200)]) },
  ];
  const dosTime = 0, dosDate = (0x21 << 9) | (1 << 5) | 1;
  const locals = [], cds = [];
  let offset = 0;
  for (const s of specs) {
    const nameB = Buffer.from(s.name, 'utf8');
    const payload = s.method === 8 ? deflateRawSync(s.data) : s.data;
    const crc = crc32(s.data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(s.method, 8);
    lh.writeUInt16LE(dosTime, 12); lh.writeUInt16LE(dosDate, 14); lh.writeUInt32LE(crc, 16);
    lh.writeUInt32LE(payload.length, 20); lh.writeUInt32LE(s.data.length, 24); lh.writeUInt16LE(nameB.length, 28);
    locals.push(lh, nameB, payload);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(s.method, 10);
    cd.writeUInt16LE(dosTime, 12); cd.writeUInt16LE(dosDate, 14); cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(payload.length, 20); cd.writeUInt32LE(s.data.length, 24); cd.writeUInt16LE(nameB.length, 28);
    cd.writeUInt32LE(offset, 42);
    cds.push(cd, nameB);
    offset += lh.length + nameB.length + payload.length;
  }
  const localBuf = Buffer.concat(locals);
  const cdBuf = Buffer.concat(cds);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(specs.length, 8);
  eocd.writeUInt16LE(specs.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(localBuf.length, 16);
  const all = Buffer.concat([localBuf, cdBuf, eocd]);
  const zipBuf = all.buffer.slice(all.byteOffset, all.byteOffset + all.length);

  const entries = P.zipEntries(zipBuf);
  eq('目录条目数解析正确', entries.length, 4);
  eq('条目名按 UTF-8 解出', entries[0].name, 'pack/main-character.png');
  eq('deflate 条目标记 method=8', entries.filter((e) => e.name === 'pack/preview/dance.gif')[0].method, 8);

  const imgs = P.zipImageEntries(entries);
  eq('图片过滤：png/gif 留下、txt 与 __MACOSX 剔除', imgs.map((e) => e.name.split('/').pop()).sort().join(','), 'dance.gif,main-character.png');

  const pngBytes = await P.zipExtract(zipBuf, entries[0]);
  eq('stored 条目原样解出', Array.from(pngBytes).slice(0, 8).join(','), '137,80,78,71,13,10,26,10');
  const gifBytes = await P.zipExtract(zipBuf, entries[1]);
  eq('deflate 条目真解压（DecompressionStream）', Buffer.from(gifBytes.subarray(0, 6)).toString('latin1'), 'GIF89a');
  eq('解压尺寸与目录一致', gifBytes.length, entries[1].size);

  const du = P.zipBytesToDataUrl(pngBytes, 'a.PNG');
  eq('dataUrl MIME 按扩展名给出', du.slice(0, 14), 'data:image/png');
  ok('zipBytesToDataUrl 与 atob 往返一致', atob(du.split(',')[1]).charCodeAt(0) === 0x89);
  eq('zip 里的 gif 判动图衔接 v4.1 链路（返回类型）', typeof P.imgAnimKind('data:image/gif;base64,' + Buffer.from(specs[1].data).toString('base64')), 'string');

  // 产物侧：上传入口接受 zip、挑图面板在
  const jsV42 = readFileSync(path.join(ROOT, 'client.js'), 'utf8');
  const cssV42 = readFileSync(path.join(ROOT, 'client.css'), 'utf8');
  ok('上传入口接受 zip（accept 与分支）', /image\/\*,\.zip/.test(jsV42) && /uploadFromZipPack/.test(jsV42));
  ok('挑图列表样式就位', /\.pb2-zip-item/.test(cssV42));
  ok('zip 上限 200MB 写死在产物里', /200 \* 1024 \* 1024/.test(jsV42));
  ok('zip 条目解压上限 8MB（core 里）', /8 \* 1024 \* 1024/.test(readFileSync(path.join(ROOT, 'src/core/zipread.js'), 'utf8')));
}

console.log('\n[v4.3 交付成果卡片]');
{
  const P1 = 'C:\\Users\\JXKJ1\\Documents\\坚祥数字助理\\我的花费折线图_20261106-1119.png';
  const r1 = P.extractFilePaths('给你做好了：' + P1 + ' 拿去用');
  eq('认出中文路径（回复里一行）', r1.length, 1);
  eq('文件名解析正确', r1[0].name, '我的花费折线图_20261106-1119.png');
  eq('路径原样保留（给复制用）', r1[0].path, P1);
  eq('按扩展名归到图片大类', r1[0].kind, 'image');

  eq('表格归 sheet', P.extractFilePaths('📎 C:\\Users\\JXKJ1\\Documents\\坚祥数字助理\\生产订单透视表.xlsx')[0].kind, 'sheet');
  eq('文档归 doc', P.extractFilePaths('D:/x/y/z.pdf')[0].kind, 'doc');
  eq('网页归 web', P.extractFilePaths('file:///D:/a/b/report.html')[0].path, 'D:/a/b/report.html');
  eq('网页 kind 也对', P.extractFilePaths('file:///D:/a/b/report.html')[0].kind, 'web');
  eq('多个路径都认出去重', P.extractFilePaths('C:\\a\\b.png 和 D:\\c\\d.png 还有 C:\\a\\b.png').length, 2);
  eq('中文标点不粘进路径', P.extractFilePaths('做好了：C:\\a\\b.png，你看看')[0].path, 'C:\\a\\b.png');
  eq('含空格的文件名能吃下', P.extractFilePaths('C:\\Users\\a b\\我的 图.png')[0].name, '我的 图.png');
  eq('正文里的版本号/模块名不误判', P.extractFilePaths('v4.2 与 node.js 都不是文件').length, 0);
  eq('相对路径不认（只认绝对路径）', P.extractFilePaths('相对路径 docs/a.png 不算').length, 0);
  eq('未知扩展名回落 other', P.fileKindOf('xyz'), 'other');
  eq('八大类都在（图标表覆盖）', Object.keys(P.DELIVER_EXTS).length, 8);
  eq('路径→file URL（反斜杠转正）', P.pathToFileUrl('C:\\Users\\a b\\图.png'), 'file:///C:/Users/a b/图.png');

  // 渲染：用最小 DOM 桩验证卡片 DOM 结构（图标/文件名/路径/两个按钮）
  const mkEl = (tag) => ({
    tag: tag, className: '', textContent: '', title: '', type: '', innerHTML: '', children: [], hidden: false,
    style: { cssText: '' }, appendChild(c) { this.children.push(c); return c; },
    addEventListener() {}, remove() {}, select() {},
  });
  const docStub = { createElement: mkEl, body: { appendChild() {} }, execCommand() { return true; } };
  const saveDoc = sandbox.document;
  sandbox.document = docStub;
  const host = mkEl('div');
  const n = P.renderDeliverables(host, '成果：' + P1, () => {});
  eq('识别到 1 个成果并挂了卡片盒', n, 1);
  const box = host.children[0];
  eq('卡片盒 class', box.className, 'pb2-deliv-box');
  const card = box.children[0];
  eq('卡片 class', card.className, 'pb2-deliv');
  const names = card.children.map(c => c.className);
  ok('卡片有 缩略图/中段（按钮组在中间列）', names.join(',').indexOf('pb2-deliv-thumb') === 0 && names.indexOf('pb2-deliv-mid') >= 0, names.join(','));
  const midEl = card.children[1];
  eq('文件名在卡片上', midEl.children[0].textContent, '我的花费折线图_20261106-1119.png');
  eq('路径在卡片上（title 也是全路径）', midEl.children[1].textContent, P1);
  eq('无成果时不碰 DOM', P.renderDeliverables(mkEl('div'), '这条回复没有文件', () => {}), 0);
  sandbox.document = saveDoc;

  // 产物侧
  const jsD = readFileSync(path.join(ROOT, 'client.js'), 'utf8');
  const cssD = readFileSync(path.join(ROOT, 'client.css'), 'utf8');
  const htmlD = readFileSync(path.join(ROOT, 'chat.html'), 'utf8');
  ok('气泡聊天回复挂成果卡片（桌宠侧）', /renderDeliverables\(row, text, DELIV_ACT\)/.test(jsD));
  ok('单击/双击气泡也挂卡片', /renderDeliverables\(b, text, DELIV_ACT\)/.test(jsD));
  ok('独立聊天窗口同款（chat.html）', /renderDeliverables\(b, text,/.test(htmlD));
  ok('卡片样式在 client.css 与 chat.html 都在', /\.pb2-deliv-btn/.test(cssD) && /\.pb2-deliv-btn/.test(htmlD));
  ok('人设里带上「交付文件」写法约定（助手会输出路径）', /交付文件/.test(jsD) && /📎/.test(jsD));
  // v4.4：卡片动作走宿主交付接口（打开文件 / 打开文件夹位置）
  const delivSrc = readFileSync(path.join(ROOT, 'src/core/deliver.js'), 'utf8');
  ok('卡片两个按钮：打开 / 定位（v4.6 短文案省空间）',
    delivSrc.indexOf("'打开'") >= 0 && delivSrc.indexOf("'定位'") >= 0 && delivSrc.indexOf("'复制'") >= 0);
  ok('按钮组挂在中间列（窄面板三行布局）', /mid\.appendChild\(acts\)/.test(delivSrc));
  ok('卡片带真缩略图（图片/视频走 preview）',
    /pb2-deliv-haspv/.test(delivSrc) && /a\.preview\(f\.path\)/.test(delivSrc) && /pb2-deliv-pv/.test(delivSrc));
  ok('单条消息最多 3 张卡片（同路径去重）', /picked\.length >= 3/.test(delivSrc) && /seen\[k\]/.test(delivSrc));
  ok('桌宠侧接上预览接口（/api/md/）', /\/api\/md\//.test(jsD) && /delivPreview/.test(jsD));
  ok('独立窗口也接上预览', /\/api\/md\//.test(htmlD) && /preview: preview/.test(htmlD));
  ok('元数据 JSON 不进面板（v4.6 修）', /looksLikeMetaJson/.test(jsD) && /m\.role !== 'user' && m\.role !== 'assistant'/.test(jsD));
  ok('面板每次打开都贴桌宠头顶（位置不再记忆）', /chatpFollowPet\(\)/.test(jsD) && /位置不再记忆/.test(jsD));
  ok('桌宠移动/改尺寸时面板跟随', /try \{ chatpFollowPet\(\); \}/.test(jsD));
  ok('点击卡片本体 = 打开文件', /card\.addEventListener\('click'/.test(delivSrc) && /a\.open\(f\.path\)/.test(delivSrc));
  ok('宿主接口不可用时回落复制路径（不静默失败）',
    /copyPlainText\(f\.path/.test(delivSrc) && /fallback\(/.test(delivSrc));
  ok('桌宠侧接上宿主交付接口', /delivery\/' \+ action/.test(jsD) && /DELIV_ACT/.test(jsD));
  ok('独立聊天窗口也接上（chat.html）', /delivery\/' \+ action/.test(htmlD) && /__delivAct/.test(htmlD));
  // v4.5：双击闲聊 ↔ 气泡聊天联动（同一份会话记录）
  ok('面板从会话记录拉增量（messages 接口 + seq 游标）',
    /\/messages\?limit=/.test(jsD) && /chatpLastSeq/.test(jsD) && /m\.seq \|\| 0\) > chatpLastSeq/.test(jsD));
  ok('只取用户原话（跳过首轮人设/余额块）', /sessionUserText/.test(jsD) &&
    /【用户说】\(\[\\s\\S\]\*\)\$/.test(readFileSync(path.join(ROOT, 'src/core/chat.js'), 'utf8')));
  ok('双击闲聊把这一问一答同步进面板', /chatpEcho\('me', text\)/.test(jsD) && /chatpSync\(\);\s*\/\/ 把这一问一答补进面板/.test(jsD));
  ok('打开面板时先补历史', /chatpSync\(\);\s*\/\/ v4\.5：每次打开/.test(jsD) && /\/\/ v4\.5：把会话记录里的历史/.test(jsD));
  ok('乐观条目：拉不到就把临时的转正（消息不会丢）', /chatpPromoteTemps\(\)/.test(jsD) && /pb2-temp/.test(jsD));
  ok('临时候态有样式', /\.pb2-chatp-msg\.pb2-temp/.test(readFileSync(path.join(ROOT, 'client.css'), 'utf8')));
}

console.log('\n[v4.3 动作包（petpack）]');
{
  const packs = P.petpackList();
  ok('至少一个动作包已导入（dsh-pet 整包）', packs.length >= 1, '包数 ' + packs.length);
  const pk = P.petpackById('dshpack');
  ok('按 id 取包', !!pk && pk.id === 'dshpack');
  if (pk) {
    ok('动作数 ≥ 100（整套搬入，不是挑一张）', pk.actions.length >= 100, pk.actions.length);
    eq('语义角色齐全（idle/click/drag/balance/random）',
      ['idle', 'clicks', 'drag', 'balance', 'random'].every(r => (pk.roles[r] || []).length > 0), true);
    ok('随机表演池 ≥ 50（分类动作）', P.petpackRandomPool(pk).length >= 50, P.petpackRandomPool(pk).length);
    ok('每个动作都有素材文件字段', pk.actions.every(a => /^[a-z]+-\d+\.webm$/.test(a.file)), pk.actions[0] && pk.actions[0].file);
    ok('动作都能查到角色（除少数未登记）', pk.actions.filter(a => a.role).length >= pk.actions.length * 0.9,
      pk.actions.filter(a => a.role).length + '/' + pk.actions.length);
    eq('按名取动作记录', P.petpackActionOf(pk, pk.actions[0].name).file, pk.actions[0].file);
    ok('未知动作名返回 null', P.petpackActionOf(pk, '不存在的动作') === null);
    // 挑动作：rnd=0 取第一个、rnd≈1 取最后一个、avoid 不连抽
    const idlePool = P.petpackRolePool(pk, 'idle');
    eq('角色池取值', P.petpackPick(pk, 'idle', '', 0), idlePool[0]);
    const clicks = P.petpackRolePool(pk, 'clicks');
    ok('avoid 生效（不连着播同一个）', clicks.length > 1 ? P.petpackPick(pk, 'clicks', clicks[0], 0) !== clicks[0] : true);
    const balPool = P.petpackRolePool(pk, 'balance');
    eq('余额分档取档位', P.petpackPickTier(pk, 'balance', 0, '', 0), balPool[0][0] ? balPool[0][0] : balPool[0]);
    eq('余额档位越界夹到最后一档', P.petpackPickTier(pk, 'balance', 99, '', 0), balPool[balPool.length - 1][0] || balPool[balPool.length - 1]);
    eq('空角色池返回空串', P.petpackPick(pk, '不存在的角色', '', 0), '');
    const rnd = P.petpackPickRandom(pk, '', '', 0);
    ok('随机表演可挑出动作名', typeof rnd === 'string' && rnd.length > 0, rnd);
    ok('按分类过滤（时节）', P.petpackPickRandom(pk, '时节', '', 0) !== '');
  }
  // 素材对账：清单里登记的每个文件都要真的在仓库根目录（宿主只服务根级文件）
  const manP = JSON.parse(readFileSync(path.join(ROOT, 'assets.manifest.json'), 'utf8'));
  const g = (manP.groups || []).find(x => x.id === 'petpack-dshpack');
  ok('素材清单里有动作包组', !!g, g ? 'count=' + g.count : '缺');
  if (g) {
    const missing = g.files.filter(f => !existsSync(path.join(ROOT, f)));
    eq('登记的动作素材一个不少', missing.length, 0);
    ok('素材全部平铺在插件根目录（无子目录）', g.files.every(f => f.indexOf('/') < 0), true);
    const total = g.files.filter(f => f.endsWith('.webm')).reduce((s, f) => s + statSync(path.join(ROOT, f)).size, 0);
    ok('素材总体积 ≤ 7MB（整合后 -88% 以上）', total <= 7 * 1024 * 1024, (total / 1024 / 1024).toFixed(2) + 'MB');
    // alpha 通道是关键：VP9-alpha 带不动就会出现黑底（转码必须 libvpx-vp9 解码 + auto-alt-ref 0）
    const firstAct = readFileSync(path.join(ROOT, g.files.find(f => f.endsWith('.webm'))));
    ok('动作素材保留透明通道（ALPHA_MODE 标记在）', firstAct.indexOf('ALPHA_MODE') >= 0);
  }
  // 产物侧：运行时接线
  const jsP = readFileSync(path.join(ROOT, 'client.js'), 'utf8');
  ok('运行时：双缓冲视频皮肤', /pb2-skin-pack/.test(jsP) && /pb2-vid-front/.test(jsP));
  ok('运行时：点击/拖动/余额/随机 四类触发都在', /packRole\('clicks'\)/.test(jsP) && /packDrag\(true\)/.test(jsP) &&
    /packBalanceTier\(/.test(jsP) && /packRandomShow\(\)/.test(jsP));
  ok('样式：动作包视频层就位', /pb2-skin-pack \.pb2-vid/.test(readFileSync(path.join(ROOT, 'client.css'), 'utf8')));
  ok('模型面板列出动作包', /pack:' \+ pk\.id/.test(jsP) || /动作包 · /.test(jsP));
  ok('可复用的导入器在仓库里（记录安装过程）', existsSync(path.join(ROOT, 'tools/import-petpack.mjs')));
  ok('导入记录已写出', existsSync(path.join(ROOT, 'docs/petpack-dshpack-导入记录.md')));
}

console.log('\n[v4.7 自行移动（散步）]');
{
  const V = { w: 1280, h: 900 }, SZ = { w: 96, h: 134 };
  // 时间：间隔抖动
  eq('间隔抖动在 0.65~1.45 倍之间（下界）', P.walkNextDelay(180, 0), Math.round(180 * 0.65));
  eq('间隔抖动在 0.65~1.45 倍之间（上界）', P.walkNextDelay(180, 1), Math.round(180 * 1.45));
  ok('间隔基准被夹住（太小/太大都不离谱）', P.walkNextDelay(1, 0) >= 8 && P.walkNextDelay(99999, 1) <= 3600 * 1.45);
  // 模式与速度
  eq('模式兜底为走走停停', P.walkModeOf('不存在'), 'stroll');
  eq('off 模式认得出', P.walkModeOf('off'), 'off');
  eq('模式标签', P.walkModeLabel('roam'), '逛桌面');
  eq('速度兜底 74px/秒', P.walkSpeedOf('xx'), 74);
  eq('速度档：小跑 124', P.walkSpeedOf('fast'), 124);
  eq('速度标签', P.walkSpeedLabel('slow'), '慢悠悠');
  // 规划：off 不动
  eq('off 模式不产生位移', P.walkPlan(V, SZ, { left: 600, bottom: 60 }, 'off', 'normal', 0.5), null);
  // 规划：走走停停只改 left、且在屏幕内
  let inBounds = true, onlyH = true, dirOK = true;
  const speeds = { slow: 42, normal: 74, fast: 124 };
  for (let i = 0; i < 200; i++) {
    const r = i / 200;
    const plan = P.walkPlan(V, SZ, { left: 600, bottom: 60 }, 'stroll', 'normal', r);
    if (!plan) continue;
    if (plan.to.left < P.WALK_MARGIN || plan.to.left > V.w - SZ.w - P.WALK_MARGIN) inBounds = false;
    if (plan.to.bottom !== plan.from.bottom) onlyH = false;
    const expect = plan.to.left >= plan.from.left ? 'right' : 'left';
    if (plan.dir !== expect) dirOK = false;
  }
  ok('200 次规划目标点都在屏幕内（留边距）', inBounds);
  ok('走走停停只水平移动（bottom 不变）', onlyH);
  ok('方向与实际位移一致', dirOK);
  // 规划：逛桌面会换位置（含垂直）且不越界
  let roamV = 0, roamIn = true;
  for (let i = 0; i < 200; i++) {
    const plan = P.walkPlan(V, SZ, { left: 600, bottom: 400 }, 'roam', 'normal', i / 200);
    if (!plan) continue;
    if (plan.vertical) roamV++;
    if (plan.to.bottom < P.WALK_MARGIN || plan.to.bottom > V.h - SZ.h - P.WALK_MARGIN) roamIn = false;
  }
  ok('逛桌面多数会带上垂直位移', roamV > 120, roamV + '/200');
  ok('逛桌面目标点不越界', roamIn);
  // 贴墙时不会硬撞：从最左出发只能向右
  const wall = P.walkPlan(V, SZ, { left: P.WALK_MARGIN, bottom: 60 }, 'stroll', 'normal', 0.9);
  eq('贴左墙出发只能向右', wall && wall.dir, 'right');
  const wall2 = P.walkPlan(V, SZ, { left: V.w - SZ.w - P.WALK_MARGIN, bottom: 60 }, 'stroll', 'normal', 0.1);
  eq('贴右墙出发只能向左', wall2 && wall2.dir, 'left');
  // 时长与距离/速度一致
  const p74 = P.walkPlan(V, SZ, { left: 600, bottom: 60 }, 'stroll', 'normal', 0.3);
  const expectMs = Math.min(14000, Math.max(420, Math.round(p74.dist / 74 * 1000)));
  ok('时长 = 距离 ÷ 速度（并夹在 0.42~14 秒）', Math.abs(p74.durMs - expectMs) <= 1, p74.durMs + ' vs ' + expectMs);
  const pSlow = P.walkPlan(V, SZ, { left: 600, bottom: 60 }, 'stroll', 'slow', 0.3);
  ok('同样的路走慢档更久', pSlow.durMs >= p74.durMs);
  // 缓动：端点、单调、中点
  eq('缓动 0 → 0', P.walkEase(0), 0);
  ok('缓动 1 → 1', Math.abs(P.walkEase(1) - 1) < 1e-9);
  ok('缓动中点 ≈ 0.5', Math.abs(P.walkEase(0.5) - 0.5) < 1e-9);
  let mono = true;
  for (let i = 1; i <= 20; i++) if (P.walkEase(i / 20) < P.walkEase((i - 1) / 20)) mono = false;
  ok('缓动单调不回头', mono);
  const at = P.walkPosAt({ left: 100, bottom: 100 }, { left: 300, bottom: 200 }, 0.5);
  ok('插值中点在中途', Math.abs(at.left - 200) < 1e-9 && Math.abs(at.bottom - 150) < 1e-9);
  ok('缓动端点即目标点', Math.abs(P.walkPosAt({ left: 0, bottom: 0 }, { left: 300, bottom: 0 }, 1).left - 300) < 1e-9);
  // 段数与间歇
  const segs = [0, 0.2, 0.5, 0.9].map(r => P.walkSegCount('stroll', r));
  ok('走走停停段数 1~3', segs.every(s => s >= 1 && s <= 3), segs.join(','));
  eq('逛桌面一段到位', P.walkSegCount('roam', 0.7), 1);
  eq('关掉时不走', P.walkSegCount('off', 0.5), 0);
  ok('间歇 0.2~1.4 秒之间', P.walkPauseMs('stroll', 0.5) >= 200 && P.walkPauseMs('stroll', 0.5) <= 1500);
  ok('逛桌面歇得短一些', P.walkPauseMs('roam', 0.5) < P.walkPauseMs('stroll', 0.5));
  // 派生随机：同一 (种子, 路数) 稳定、不同路数不同
  eq('派生随机可复现', P.walkRnd(0.42, 3), P.walkRnd(0.42, 3));
  ok('不同路数取值不同', P.walkRnd(0.42, 3) !== P.walkRnd(0.42, 4));
  ok('派生随机都在 0..1', [0, 1, 7].every(k => { const v = P.walkRnd(0.31, k); return v >= 0 && v < 1; }));
  // 接线（产物侧）
  const jsW = readFileSync(path.join(ROOT, 'client.js'), 'utf8');
  const cssW = readFileSync(path.join(ROOT, 'client.css'), 'utf8');
  ok('运行时：定时出发 + rAF 平移 + 到点续排', /function walkSchedule/.test(jsW) && /requestAnimationFrame\(tick\)/.test(jsW) && /function walkGo/.test(jsW));
  ok('散步时叫对应动作（pack moves / sprite 跑步帧 / 图片起伏）',
    /packRole\('moves', \{ loop: true \}\)/.test(jsW) && /transient = 'running-right'/.test(jsW) && /pb2-walking/.test(jsW));
  ok('拖动/点击/隐藏会打断散步', /walkHalt\(\);   \/\/ v4.7：用户上手了/.test(jsW) && /walkHalt\(\);   \/\/ v4.7：被戳了就停下/.test(jsW));
  ok('菜单有「自行移动」与设置入口', /自行移动：/.test(jsW) && /openWalkSettings/.test(jsW));
  ok('设置面板有 模式/间隔/速度/试跑', /出发间隔/.test(jsW) && /走多快/.test(jsW) && /现在就走两步/.test(jsW));
  ok('设置默认值齐全（开关/模式/间隔/速度）',
    /walkOn: true/.test(readFileSync(path.join(ROOT, 'src/core/config.js'), 'utf8')));
  ok('朝向镜像与走动起伏的样式在', /\.pb2-pet-wrap\.pb2-face-right \.pb2-vid/.test(cssW) && /pb2-walking-bob/.test(cssW));
  ok('选项 chip 样式在', /button\.pb2-chip/.test(cssW));
}

console.log('\n[v4.8 表情包扩展与管理 + 弹窗规范]');
{
  const js8 = readFileSync(path.join(ROOT, 'client.js'), 'utf8');
  const css8 = readFileSync(path.join(ROOT, 'client.css'), 'utf8');
  // —— 内置表情包扩展（大肥鱼模型包 memes）
  ok('内置贴纸总数 = 67（16 档案 + 24 微信 + 27 模型包）', P.archiveStickerTotal() === 67, P.archiveStickerTotal());
  const list = P.archiveStickerList();
  ok('清单含 dsh-01 … dsh-27', list.filter(a => /^dsh-\d\d$/.test(a.id)).length === 27);
  ok('清单文件名规范 st-<id>.webp', list.every(a => a.file === 'st-' + a.id + '.webp'));
  const man = JSON.parse(readFileSync(path.join(ROOT, 'assets.manifest.json'), 'utf8'));
  const g = man.groups.find(x => x.id === 'sticker-dsh');
  ok('素材清单里有 sticker-dsh 组且 27 个文件', !!g && g.count === 27 && g.files.length === 27, g && g.count);
  ok('清单里列的文件都在磁盘上（install 会校验）', g.files.every(f => existsSync(path.join(ROOT, f))));
  const totalSt = g.files.reduce((s, f) => s + statSync(path.join(ROOT, f)).size, 0);
  ok('27 张表情总大小 ≤ 600KB（4.6MB 原图压到 0.42MB）', totalSt <= 600 * 1024, (totalSt / 1024).toFixed(0) + 'KB');
  // 中文名可解析（说人话就能发贴纸）
  ok('中文名别名可解析到贴纸（如 [stick:可爱]）', /'可爱': 'dsh-07'/.test(js8) && /'深度睡眠': 'dsh-21'/.test(js8));
  // —— 自定义表情包存储与容量预检
  eq('空数组时预算够用', P.stickerStoreFits([], 1024 * 1024), true);
  eq('塞满 9MB 后放不下', P.stickerStoreFits([('x'.repeat(9 * 1024 * 1024))], 1024), false);
  eq('占用统计正确', P.stickerStoreUsed(['abc', null, 'de']), 5);
  eq('null 位不占空间（删除后下标不乱）', P.stickerStoreUsed([null, null]), 0);
  // —— zip 打包（导出用）
  const z1 = P.zipBuild([{ name: '自定义/custom-00.png', data: new Uint8Array([1, 2, 3, 4, 5]) }]);
  ok('zip 头部正确（PK\\x03\\x04）', z1[0] === 0x50 && z1[1] === 0x4b && z1[2] === 3 && z1[3] === 4);
  ok('zip 尾部是 EOCD（PK\\x05\\x06）', z1[z1.length - 22] === 0x50 && z1[z1.length - 21] === 0x4b && z1[z1.length - 20] === 5 && z1[z1.length - 19] === 6);
  // 用自家 zipread 回读（自洽：写出来的能读回去）
  const back = P.zipEntries(z1.buffer.slice(z1.byteOffset, z1.byteOffset + z1.byteLength));
  eq('写完能被自家 zipread 读回', back.length, 1);
  eq('回读的文件名带 UTF-8 中文', back[0].name, '自定义/custom-00.png');
  eq('回读的大小一致', back[0].size, 5);
  ok('CRC32 标准值校验（"123456789" → 0xCBF43926）',
    P.zipCrc32(new TextEncoder().encode('123456789')) === 0xCBF43926);
  // —— 表情包管理 UI 接线
  ok('设置里有「表情包管理」入口', /label: '表情包管理…'/.test(js8) && /function openStickerManager/.test(js8));
  ok('批量导入支持 图片 与 zip', /multiple = true/.test(js8) && /importStickers/.test(js8) && /zipImageEntries/.test(js8));
  ok('导入会把大图缩到 256px（canvas）', /shrinkImageDataUrl/.test(js8) && /toDataURL\('image\/webp', 0\.86\)/.test(js8));
  ok('导出走 zipwrite（无第三方库）', /zipBuild\(files\)/.test(js8) && /application\/zip/.test(js8));
  ok('导出含 README（说明怎么再导入）', /README\.json/.test(js8) && /重新导入/.test(js8));
  ok('点表情复制标记（archive/custom）', /copyMark\(stickerMarkOf\('archive'/.test(js8) && /copyMark\(stickerMarkOf\('custom'/.test(js8));
  ok('删除自定义表情保留下标（置 null）', /arr\[idx\] = null/.test(js8));
  ok('管理面板样式在（网格 + 删除角标）', /\.pb2-stk-grid \{/.test(css8) && /\.pb2-stk-del/.test(css8));
  // —— 试听文本自定义
  ok('试听文本可编辑（设置项 + 编辑入口）', /speechProbeText/.test(js8) && /function openProbeTextEditor/.test(js8));
  ok('试听用自定义文本（带默认兜底）', /function probeText\(\)/.test(js8) && /PROBE_DEFAULT/.test(js8));
  ok('编辑面板有「试听这句」「恢复默认」', /试听这句/.test(js8) && /恢复默认/.test(js8));
  // —— 弹窗布局统一
  ok('弹窗统一宽度与最大高度', /\.pb2-dialog \{ width: min\(560px/.test(css8) && /max-height: min\(84vh, 640px\)/.test(css8));
  ok('内容区 flex + gap 统一次序（不再靠零散 margin）', /\.pb2-dbody \{ padding: 14px 16px; display: flex; flex-direction: column; gap: 9px; \}/.test(css8));
  ok('分组标题带色条且首个不空行', /\.pb2-dbody > h4::before/.test(css8) && /\.pb2-dbody > h4:first-child/.test(css8));
  ok('底部按钮右对齐 + 最小宽度', /\.pb2-dfoot \{ padding: 10px 16px 12px/.test(css8) && /\.pb2-dfoot button \{ min-width: 76px/.test(css8));
  ok('窄屏适配（铺满 + 卡片转竖向）', /@media \(max-width: 560px\)/.test(css8) && /\.pb2-model-card \{ flex-direction: column/.test(css8));
  ok('日志面板等宽折行样式在', /\.pb2-logrow \{/.test(css8) && /white-space: pre-wrap/.test(css8));
  ok('逐个弹窗都有分组标题（聊天设置 3 组 / 角色设定 / 常用语 / 试听 / 日志）',
    ['通道与模型', '额度显示', '网关 / 身份牌', '性格设定', '加一条', '已保存的常用语', '试听时说这一句', '最近 100 条']
      .every(t => js8.indexOf(t) >= 0));
  ok('零散 marginTop 的"手工间距"已清掉', !/style\.marginTop/.test(js8));
}

console.log('\n[v4.9 表情包重命名 + 按语境挑表情]');
{
  const js9 = readFileSync(path.join(ROOT, 'client.js'), 'utf8');
  // —— 微信 24 张：占位名已全部换成语义名
  const wx = P.archiveStickerList().filter(a => /^wx-\d\d$/.test(a.id));
  eq('微信表情仍是 24 张', wx.length, 24);
  eq('不再有「微信表情包 NN」占位名', wx.filter(a => /^微信表情包\s*\d+$/.test(a.name)).length, 0);
  ok('每张都是 2~6 字的语义名', wx.every(a => a.name.length >= 2 && a.name.length <= 6), wx.map(a => a.name).join('、'));
  // 逐张可解析（说人话就能发）
  const wxExpect = {
    'wx-01': '搓手期待', 'wx-05': '害羞捂脸', 'wx-07': '打工搬砖', 'wx-10': '点赞没问题',
    'wx-13': '生气皱眉', 'wx-16': '委屈抱膝', 'wx-18': '无语斜眼', 'wx-19': '放声大哭',
    'wx-22': '震惊裂开', 'wx-23': '挥手打招呼', 'wx-24': '慌张吓到',
  };
  ok('语义名 → id 解析正确（抽查 11 张）',
    Object.keys(wxExpect).every(id => P.archiveResolve(wxExpect[id]) === id),
    Object.keys(wxExpect).map(id => wxExpect[id] + '→' + P.archiveResolve(wxExpect[id])).join(' '));
  eq('旧写法 wx7 仍兼容（向后不破坏）', P.archiveResolve('wx7'), 'wx-07');
  // —— 教学与别名表必须自洽：prompt 教学里点名的每个表情都能解析
  const prompt9 = P.buildPrompt('你好', null, true);
  const teachLines = prompt9.split('\n').filter(l => /^\s*·/.test(l));   // 只取分场景的「· 场景：表情、表情」行
  const seen = [];
  for (const line of teachLines) {
    const seg = line.indexOf('：') >= 0 ? line.slice(line.indexOf('：') + 1) : '';   // 只取「：」后面的表情列表
    for (const w of seg.split(/[、,，]/)) {
      const t = w.replace(/[\s。；;【】]+/g, '').trim();
      if (!t || /^\[/.test(t) || t.length > 12) continue;                            // 跳过标记/长句
      seen.push(t);
    }
  }
  const bad = seen.filter(t => !P.archiveResolve(t));
  ok('prompt 教学里点名的表情全部可解析（' + seen.length + ' 个）', bad.length === 0, bad.join('、'));
  ok('教学里含微信新名（抽查）', seen.includes('害羞捂脸') && seen.includes('无语斜眼') && seen.includes('震惊裂开'));
  ok('教学里含梗图系列名', seen.includes('深度睡眠') && seen.includes('黎曼猜想没证明喵'));
  ok('教学按情绪/场景分组（含使用时机规则）',
    /按当下语境挑一张/.test(prompt9) && /情绪对得上才插/.test(prompt9) && /最多 1-2 个/.test(prompt9));
  ok('平淡场景明确说别插（报数字/清单）', /报数字/.test(prompt9) && /别插/.test(prompt9));
  // —— 渲染侧：新名能真的渲染成贴纸元素
  ok('新名渲染成贴纸元素（走 archive 白名单）',
    /archiveStickerList/.test(js9) || /ARCHIVE\b/.test(js9));
}

console.log('\n[v5.0 气泡聊天里的表情面板]');
{
  const js0 = readFileSync(path.join(ROOT, 'client.js'), 'utf8');
  const html0 = readFileSync(path.join(ROOT, 'chat.html'), 'utf8');
  const css0 = readFileSync(path.join(ROOT, 'client.css'), 'utf8');
  ok('气泡聊天输入行有表情按钮', /pb2-chatp-face/.test(js0) && /发表情（点一下直接发/.test(js0));
  ok('面板有 6 个分类（与独立窗口一致）',
    /CHATP_STK_TABS = \[\[/.test(js0) &&
    ['recent', 'fish', 'bean', 'maid', 'archive', 'custom'].every(k => js0.indexOf("'" + k + "'") >= 0));
  ok('点表情：输入框空就直发、有字就追加',
    /function chatpUseSticker/.test(js0) && /chatpSend\(mark\)/.test(js0) && /cur \+ ' ' \+ mark/.test(js0));
  ok('最近使用与独立窗口共用同一份（LS_RECENT）', /LS_RECENT/.test(js0) && /chatpPushRecent/.test(js0) && /LS_RECENT/.test(html0));
  ok('标记格式两端一致（[stick:archive:xx] / [fish:xx]）',
    /return g === 'stick' \? '\[stick:' \+ n \+ '\]' : '\[' \+ g \+ ':' \+ n \+ '\]'/.test(js0));
  ok('「我的」tab 能添加（图片/zip，复用 importStickers）', /➕ 添加/.test(js0) && /importStickers\(Array\.from\(fu\.files/.test(js0));
  ok('「我的」tab 能删除且保下标', /arr\[idx\] = null; stickerSave\(\)/.test(js0));
  ok('面板可直接跳「表情包管理…」', /openStickerManager\(\)/.test(js0) && /管理…/.test(js0));
  ok('发送函数支持直接发一段文本（textOverride）', /async function chatpSend\(textOverride\)/.test(js0));
  ok('独立窗口删除也改成保下标（两端一致）', /S\.customStickers\[idx\] = null/.test(html0) && !/customStickers\.splice\(idx, 1\)/.test(html0));
  ok('气泡表情面板样式在（tab/网格/小格缩放/管理态/加号格）',
    /\.pb2-stkp-tabs/.test(css0) && /\.pb2-stkp-cell \.sticker\.pb2-st-fish/.test(css0) &&
    /\.pb2-stkp-cell\.pb2-del-mode/.test(css0) && /\.pb2-stkp-cell\.pb2-stkp-add/.test(css0));
  ok('面板限高可滚动（不撑破气泡框）', /\.pb2-stkp \{ border-top/.test(css0) && /max-height: 236px/.test(css0));
  ok('表情网格能真正渲染各类贴纸（用 core 的 stickerEl）', /const el = stickerEl\(it\.g, it\.n\)/.test(js0));
}

console.log('\n[v5.1 控件统一（按钮/文件选择/滑块/拖动）]');
{
  const js1 = readFileSync(path.join(ROOT, 'client.js'), 'utf8');
  const css1 = readFileSync(path.join(ROOT, 'client.css'), 'utf8');
  // —— 模型卡：按钮行进信息列底部，一行右对齐
  ok('模型卡改为「缩略图 + 信息列(名称/描述/按钮行)」', /pb2-model-info/.test(js1) && !/card\.appendChild\(th\); card\.appendChild\(info\); card\.appendChild\(acts\)/.test(js1));
  ok('按钮行挂在信息列里（两个面板都改了）',
    /info\.appendChild\(acts\);          \/\/ v5\.1/.test(js1) && /info\.appendChild\(acts\);        \/\/ v5\.1/.test(js1));
  ok('按钮一行右对齐且可换行（不再竖排错位）', /\.pb2-model-acts \{ display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end/.test(css1));
  ok('描述最多两行省略（不再把按钮挤走）', /\.pb2-model-desc \{ overflow: hidden;[\s\S]{0,80}-webkit-line-clamp: 2/.test(css1));
  // —— 三级按钮统一
  ok('统一小按钮 .pb2-mini（默认/危险）', /\.pb2-mini \{/.test(css1) && /\.pb2-mini\.pb2-mini-danger \{/.test(css1));
  ok('移除用默认、彻底删除/删除用危险色',
    /pb2-mini', '移除'/.test(js1) && /pb2-mini pb2-mini-danger', '彻底删除'/.test(js1) && /pb2-mini pb2-mini-danger', '删除'/.test(js1));
  ok('旧的 pb2-model-act / pb2-model-del 已不再使用', !/pb2-model-act'/.test(js1) && !/pb2-model-del/.test(js1));
  // —— 文件选择统一
  ok('新增 fileField（隐藏原生控件 + 按钮 + 文件名）', /function fileField\(host, opts\)/.test(js1) && /\.pb2-filerow \{/.test(css1));
  ok('文件名超出省略、带 title 全名', /\.pb2-filename \{[\s\S]{0,120}text-overflow: ellipsis/.test(css1) && /nameEl\.title = fs\.map/.test(js1));
  ok('导入模型包与上传图片/zip 都走 fileField',
    /fileField\(body, \{\s*label: '导入模型包（\.json）'/.test(js1) && /label: '上传图片或 zip 包'/.test(js1));
  ok('页面里不再直接往弹窗塞原生 file 控件（只剩 fileField 内部那一个）',
    (js1.match(/type = 'file'/g) || []).length <= 4, String((js1.match(/type = 'file'/g) || []).length));
  // —— 滑块统一
  ok('滑块有统一轨道与拇指样式', /\.pb2-dbody input\[type=range\] \{/.test(css1) &&
    /::-webkit-slider-runnable-track/.test(css1) && /::-webkit-slider-thumb/.test(css1));
  ok('三处滑块都吃到统一样式（大小/音量/语速）', (js1.match(/type = 'range'/g) || []).length >= 4);
  // —— 拖动反馈
  ok('气泡面板拖动时加反馈类（半透明 + 抬起阴影 + grabbing）',
    /chatp\.classList\.add\('pb2-dragging'\)/.test(js1) && /chatp\.classList\.remove\('pb2-dragging'\)/.test(js1) &&
    /\.pb2-chatp\.pb2-dragging \{/.test(css1));
  ok('桌宠拖动也有 grabbing 光标', /\.pb2-pet-wrap\.pb2-dragging \{ cursor: grabbing/.test(css1));
}

console.log('\n[语音听写 · v3.2]');
{
  eq('热键文案统一在一处', P.VI_HOTKEY_LABEL, '右 Alt + M');
  eq('听写初始状态', P.viPhase(), 'idle');
  const vr = await P.viStart();
  ok('没有麦克风接口时给人话原因（不静默失败）', vr.ok === false && /麦克风/.test(vr.reason), JSON.stringify(vr));
  eq('失败后状态回到 error/idle（可再次触发）', P.viPhase() === 'error' || P.viPhase() === 'idle', true);

  const raw = Buffer.from(P.viWavB64(new Float32Array(1600)), 'base64');
  ok('上传用 WAV 头与长度正确（16k 单声道 16 位）',
    raw.toString('latin1', 0, 4) === 'RIFF' && raw.toString('latin1', 8, 12) === 'WAVE' && raw.length === 44 + 3200,
    'len=' + raw.length);
  ok('重采样 48k→16k 长度三等分', P.viResample(new Float32Array(4800), 48000, 16000).length === 1600);

  let asrReq = null;
  sandbox.fetch = async (url, opt) => { asrReq = {url: String(url), opt}; return {ok: true, status: 200, json: async () => ({text: '你好呀'})}; };
  const txt = await P.viTranscribe('AAAA');
  eq('识别文本解析', txt, '你好呀');
  eq('走宿主语音组件的本地识别端点', asrReq.url, P.VI_ASR_URL);
  const body = JSON.parse(asrReq.opt.body);
  ok('请求体字段齐（cmd/model/device/wav_b64）',
    body.cmd === 'transcribe' && body.model === 'xasr' && body.device === 'cpu' && body.wav_b64 === 'AAAA',
    asrReq.opt.body.slice(0, 90));
  sandbox.fetch = async (url) => { // 组件没开 → 端点 404 时必须给人话提示
    if (String(url).indexOf('/api/c/voice/asr/transcribe') === 0) return {ok: false, status: 404, text: async () => ''};
    throw new Error('offline（自检不联网）');
  };
  let hint = '';
  try { await P.viTranscribe('AAAA'); } catch (e) { hint = e.message; }
  ok('识别端点 404 时提示去开语音组件', /语音/.test(hint) && /组件/.test(hint), hint);
}

console.log(`\n结果：${pass} 项通过，${fail} 项失败`);
if (fail) process.exitCode = 1;
