/* ============================================================
 * pet-buddy — 余额宠物·大肥鱼（桌宠半边源码）· 版本号见 src/core/config.js 的 PB_VERSION
 * 本文件是【源码】：产物 client.js 由 build.mjs 生成（注入 src/core/*），不要手改产物。
 * 形象与动作基准：zhouwu97/ds-pet「大肥鱼·鲸鲸娘」（MIT）
 *   官方 v2 精灵图 1536×2288 = 8 列 × 11 行，cell 192×208；
 *   57 动作帧 + 16 方向帧；帧时长取官方 shared/motion.js 权威值；
 *   v2.2.0：不再对「哦鲸鲸」头顶气泡做 clip——气泡是官方形象的一部分
 *   （约占格子 60%×30%），旧 clip 只裁气泡上部、剩余部分在小窗口撑满画面
 *   （表情包全屏哦鲸鲸的根因）。
 *   渲染纪律：凡按 cell 网格取图的元素，位移用原始像素（-192*col/-208*row），
 *   background-size 一律锁定 1536px 2288px——百分比位移/百分比背景与缩放元素
 *   混用会把帧裁出界（happy 空白、贴纸半截的旧根因）。
 * 三合一：桌宠常驻 / 傲娇聊天 / 余额显示。
 * 聊天通道：默认「助手子对话（统一）」POST /api/sessions（provider+model
 *   分字段传）→ POST /api/sessions/{id}/chat → GET /api/sessions/{id}/messages；
 *   备选：网关令牌（OpenAI 兼容）/ 模拟模式；助手不可用回落模拟并明确提示。
 * 纪律：昵称记忆、14 轮短期记忆（网关/模拟通道）、按时段问候、短句≤60 字、
 *   思考过程绝不显示——reasoning 只写后台日志。动态文本一律 textContent 防 XSS。
 * ============================================================ */
(() => {
  'use strict';
  if (window.__PET_BUDDY_2__) return; // 防重复注入
  window.__PET_BUDDY_2__ = true;

  /* ================= 常量：素材与官方 motion 权威值 ================= */

  /* pb:core:begin（由 build.mjs 从 vendor/* + src/core/* 注入，勿手改） */
  /* ======== vendor/bibibobo.js（第三方原样内联，MIT；仅去掉行首 export）======== */
// 第三方（原样引入，勿手改）：bibibobo —— 把一句话变成「哔哔啵啵」的小人说话声
// 来源：https://github.com/hakihakii/bibibobo （B 站「路墨小剧场」哈基科技 / Lumoswitch）
// 许可：MIT。本仓库只做两件事：原样内联进 client.js / chat.html（build.mjs 去掉行首 export）、
// 由 src/core/speech.js 调用 synth() / toWav() 把大肥鱼的回复读出来。升级请整文件替换后 diff。
// ---------------------------------------------------------------------------
// bibibobo —— 把一句话变成「哔哔啵啵」的小人说话声。零依赖，浏览器和 Node 都能用。
// 做法只有五步：一条锯齿波 → 两个带通滤波器捏出口型 → 一个字一声（按字算出音高和口型）→ 每个角色一组音阶 → 标点管语气。
// 出自《路墨小剧场》（哈基科技 / Lumoswitch）每期配乐脚本里的同一段代码。MIT 协议。

const TAU = Math.PI * 2;
const mtof = (m) => 440 * 2 ** ((m - 69) / 12); // MIDI 音高 → 频率

/** 五种口型：每种只是两个共振峰频率（Hz）。 */
const VOWELS = [[800, 1200], [400, 2200], [350, 800], [600, 1700], [300, 2600]];

/** 声线：音阶（MIDI 音高）、共振峰倍率、每个字的时长上限、字头小滑音、默认语速。 */
const VOICES = {
  fish: {scale: [76, 79, 81, 83, 84], formant: 1.25, maxDur: 0.13, hold: 0.8, chirp: 1.5, fall: 0, gain: 0.16, step: 0.13}, // 大肥鱼：E5 G5 A5 B5 C6
  lumo: {scale: [62, 64, 67, 69], formant: 0.9, maxDur: 0.2, hold: 0.7, chirp: 0, fall: -2, gain: 0.17, step: 0.16}, // 路墨：D4 E4 G4 A4
};

/** 同一个字永远得到同一个数，所以同一个字永远是同一声。 */
const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.codePointAt(0)) % 9973, 7);

/** 一个汉字算一声，一串英文或数字算一声。 */
const syllables = (s) => s.match(/[A-Za-z_\/.0-9]+|[\u4e00-\u9fff]/g) ?? [];

// 抗混叠锯齿波（polyBLEP）
function saw(sampleRate) {
  let ph = 0;
  return (f) => {
    const dt = f / sampleRate;
    ph += dt; if (ph >= 1) ph -= 1;
    let v = 2 * ph - 1;
    if (ph < dt) { const t = ph / dt; v -= t + t - t * t - 1; }
    else if (ph > 1 - dt) { const t = (ph - 1) / dt; v -= t * t + t + t + 1; }
    return v;
  };
}
// 状态变量滤波器，取带通输出
function bandpass(sampleRate) {
  let lp = 0, bp = 0;
  return (x, fc, q) => {
    const f = 2 * Math.sin((Math.PI * Math.min(fc, sampleRate / 6)) / sampleRate);
    const hp = x - lp - bp / q;
    bp += f * hp; lp += f * bp;
    return bp;
  };
}

/** 把一声写进 out：音高 m，时长 dur 秒，glide 是结尾滑多少个半音，vowel 选口型。 */
function voice(out, sampleRate, t, m, dur, v, glide = 0, vowel = 0) {
  const osc = saw(sampleRate), f1 = bandpass(sampleRate), f2 = bandpass(sampleRate);
  const [a, b] = VOWELS[vowel % VOWELS.length];
  const start = Math.floor(t * sampleRate), n = Math.floor(dur * sampleRate);
  for (let i = 0; i < n && start + i < out.length; i++) {
    const x = i / sampleRate;
    const pitch = mtof(m + glide * (x / dur) + v.chirp * Math.exp(-x * 30)) * (1 + 0.012 * Math.sin(TAU * 6 * x)); // 滑音 + 字头小滑音 + 一点颤音
    const s = osc(pitch);
    const env = Math.min(1, x * 200) * Math.min(1, (dur - x) * 40); // 5 毫秒起音，25 毫秒收尾
    out[start + i] += (f1(s, a * v.formant, 4) + 0.7 * f2(s, b * v.formant, 5)) * env * v.gain;
  }
}

/**
 * 把一句话合成为单声道采样（Float32Array，范围 -1..1）。
 * @param {string} text 要说的话。问号结尾尾音上扬；带感叹号整句升高；省略号结尾整句压低、尾音下滑。
 * @param {{voice?: 'fish'|'lumo'|object, step?: number, sampleRate?: number, gap?: number}} [opts]
 *   voice 声线；step 每个字间隔多少秒；gap 句子之间停多少秒。
 */
function synth(text, opts = {}) {
  const v = typeof opts.voice === 'object' ? {...VOICES.fish, ...opts.voice} : VOICES[opts.voice ?? 'fish'];
  const sampleRate = opts.sampleRate ?? 44100, step = opts.step ?? v.step, gap = opts.gap ?? 0.22;
  // 按标点切成句子，每句各自套一条语气规则
  const sentences = (text.match(/[^？?！!。.，,、；;…\n]+[？?！!。.，,、；;…]*/g) ?? []).map((s) => ({text: s, tk: syllables(s)})).filter((s) => s.tk.length);
  const total = sentences.reduce((n, s) => n + s.tk.length * step + gap, 0) + 0.4;
  const out = new Float32Array(Math.ceil(total * sampleRate));
  let t = 0.02;
  for (const {text: s, tk} of sentences) {
    const ask = /[？?]$/.test(s), shout = /[！!]/.test(s), sad = /(……|\.\.\.|…)$/.test(s);
    tk.forEach((w, i) => {
      const last = i === tk.length - 1;
      const m = v.scale[hash(w) % v.scale.length] + (shout ? 3 : 0) - (sad ? 3 : 0);
      const dur = Math.min(step * v.hold, v.maxDur) + (last && (ask || shout || sad) ? 0.1 : 0);
      voice(out, sampleRate, t + i * step, m, dur, v, last && ask ? 5 : last && sad ? -4 : last ? v.fall : 0, hash(w));
    });
    t += tk.length * step + gap;
  }
  for (let i = 0; i < out.length; i++) out[i] = Math.tanh(out[i] * 2.4); // 软限幅，响一点也不破音
  return out;
}

/** 把采样打包成 16 位单声道 WAV 文件内容（Uint8Array）。 */
function toWav(samples, sampleRate = 44100) {
  const buf = new ArrayBuffer(44 + samples.length * 2), d = new DataView(buf);
  const str = (o, s) => [...s].forEach((c, i) => d.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); d.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVEfmt ');
  d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, 1, true);
  d.setUint32(24, sampleRate, true); d.setUint32(28, sampleRate * 2, true); d.setUint16(32, 2, true); d.setUint16(34, 16, true);
  str(36, 'data'); d.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) d.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), true);
  return new Uint8Array(buf);
}

  /* ======== src/core/config.js ======== */
/* ============================================================================
 * pet-buddy · 共享核心（core）· 配置（版本与默认值）
 * ----------------------------------------------------------------------------
 * src/core/*.js 是桌宠半边（client.js）与聊天窗口半边（chat.html）的唯一真相源：
 * 两份产物中都含同一段代码，由 build.mjs 按标记注入——改这里，两端同时生效。
 * 约束：只写顶层 const / function；不 import、不 export、不依赖宿主环境；
 *       去掉行首 export 即可作为普通脚本内联（手法参考 hakihakii/bibibobo）。
 * 切勿手改产物（client.js / chat.html），它们会被 build.mjs 覆盖。
 * ==========================================================================*/

/** 版本号：唯一来源。build.mjs 会写回 manifest.json 与 window.PB2.version。 */
const PB_VERSION = '3.7.0';

/* ---- localStorage 键名：沿用 v2.2.x 的历史键，升级不丢用户设置 ---- */
const LS_KEY = 'pb2.settings.v2';        // 设置
const LS_LOG = 'pb2.logs.v2';            // 后台日志（思考过程只进这里）
const LS_PSTATE = 'pb2.personaState.v1'; // 人设全量发送状态（按子对话 sid 分别记录）
const CHAT_LS_SID = 'pb2.chat.sid.v2';   // 统一子对话 id
const LS_RECENT = 'pb2.stickerRecent.v1';// 最近使用的贴纸（窗口页表情面板）
const LS_QUOTA_DAILY = 'pb2.quotaDaily.v1'; // 当日额度采样（月度已用积分的当天首见/末见，用来算今日真实消耗）

/** 可选模型列表（provider + model + 显示名） */
const CHAT_MODELS = [
  { provider: 'company-internal', model: 'deepseek-flash',  label: 'DeepSeek（内部通道）' },
  { provider: 'company-internal', model: 'glm-5.3',         label: 'GLM-5.3（内部通道）' },
  { provider: 'company-internal', model: 'glm-5.3-flash',   label: 'GLM-5.3-Flash（内部通道）' },
  { provider: 'zhipu',            model: 'glm-4.5-air',     label: 'GLM-4.5-Air（智谱官方）· 需自备余额' },
  { provider: 'zhipu',            model: 'glm-5.3',         label: 'GLM-5.3（智谱官方）· 需自备余额' },
  { provider: 'zhipu',            model: 'glm-5.3-flash',   label: 'GLM-5.3-Flash（智谱官方）· 需自备余额' },
];

/** 设置默认值 */
  const DEFAULTS = {
    skin: 'fish',            // fish | maid | custom:<id>
    customSkins: [],         // [{id,name,dataUrl}]
    hidden: false,
    pos: null,               // {left,bottom} 视口坐标；null=默认右下角
    persona: '',             // 空=用默认人设
    nickname: '',
    quota: 0,                // 剩余额度（元，自填）；0=未设置
 perYuan: 1000,           // v2.2.3 积分制：每元积分（后端 1000 分 = 1 元）
    channel: 'assistant',    // assistant | gateway | mock
    chatProvider: 'company-internal',
    chatModel: 'deepseek-flash',
    gatewayBase: '', gatewayKey: '', gatewayModel: '',
    size: 96,                // 桌宠显示宽度 px
    monitor: true,           // BongoCat 式鼠标/键盘监控（女仆/自定义皮肤）
    /* v3.2 声音：播报走本地合成（bibibobo 声线），听写走宿主语音组件的本地离线模型 */
    speechOn: true,          // 语音播报开关（聊天回复念出来）
    speechVolume: 0.5,       // 音量 0..1
    speechStep: 0.13,        // 语速（每个字的间隔秒数，0.13 = 默认）
    speechVoice: 'fish',     // 声线：fish（大肥鱼·高）| lumo（路墨·低）
    speechMaxChars: 60,      // 单次朗读上限字数（超出截断加省略号）
    /* v3.4 语调引导：宿主后端 TTS（/api/voice/tts）先把句子真读一遍，
       量出**每一句/每个字的真人音高**，再到声线音阶里挑最接近的那个音——结构与音色仍是经典合成。
       比"完全按字哈希定音高"更贴语调；TTS 不可用时自动回退经典合成 */
    speechFollow: true,      // true=语调引导；false=经典合成（老字段，保留兼容）
    speechMode: 'guided',    // v3.6 朗读模式：guided 语调引导 / classic 经典合成 / tts 普通朗读（真人声）
    ttsVoice: '',            // TTS 音色（空=宿主默认，例如 zh-CN-XiaoxiaoNeural）
    ttsRate: 1,              // TTS 语速 0.5..2
    /* v3.3 音效：点桌宠/弹面板/拖拽吸附/识别成功失败各一声（同一套合成器造的短音） */
    sfxOn: true,             // 交互音效开关
    sfxVolume: 0.6,          // 音效音量 0..1（与语音音量独立）
    hiddenSkins: [],         // v3.7 被移除的内置皮肤 id（可从模型面板恢复）
    /* v3.4 常用语库（右键 → bibo语音 → 常用语…，增删改查；只存本机） */
    phrases: [],
  };

/** 默认人设（用户可在右键菜单 → 角色设定里覆盖） */
  const DEFAULT_PERSONA =
    '你是「大肥鱼·鲸鲸娘」，住在用户屏幕右下角的一只圆滚滚大肥鱼桌宠。\n' +
    '性格：傲娇、搞笑、毒舌但绝对忠诚，是用户最可靠的挚友——嘴上不饶人，心里全是用户。\n' +
    '铁律：\n' +
    '1. 每次回复不超过 60 字，短句，可以带一个颜文字或 emoji。\n' +
    '2. 傲娇不伤人：毒舌只限调侃；用户真难过时立刻变温柔。\n' +
    '3. 记住用户告诉你的信息（尤其昵称），之后主动使用。\n' +
    '4. 思考/推理过程绝对不能写进回复，回复里不许出现任何分析、推演痕迹。\n' +
    '5. 涉及花费/余额时直接报结论数字，不解释算法。';

  /* ======== src/core/util.js ======== */
/* ============================================================================
 * pet-buddy · 共享核心（core）· 工具
 * ----------------------------------------------------------------------------
 * src/core/*.js 是桌宠半边（client.js）与聊天窗口半边（chat.html）的唯一真相源：
 * 两份产物中都含同一段代码，由 build.mjs 按标记注入——改这里，两端同时生效。
 * 约束：只写顶层 const / function；不 import、不 export、不依赖宿主环境；
 *       去掉行首 export 即可作为普通脚本内联（手法参考 hakihakii/bibibobo）。
 * 切勿手改产物（client.js / chat.html），它们会被 build.mjs 覆盖。
 * ==========================================================================*/

  /* ================= 小工具 ================= */
  const $new = (tag, cls, text) => {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text; // 防 XSS：动态文本一律 textContent
    return el;
  };
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  /** token 数简写：156347907 → 156.3M（气泡宽度有限，长数字挤成一行读不动） */
  const fmtTok = (n) => {
    const v = Number(n) || 0;
    if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
    if (v >= 1e4) return Math.round(v / 1e3) + 'k';
    return String(v);
  };
  const nowStr = () => { const d = new Date(); const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()); };

  /* ======== src/core/store.js ======== */
/* ============================================================================
 * pet-buddy · 共享核心（core）· 设置与日志
 * ----------------------------------------------------------------------------
 * src/core/*.js 是桌宠半边（client.js）与聊天窗口半边（chat.html）的唯一真相源：
 * 两份产物中都含同一段代码，由 build.mjs 按标记注入——改这里，两端同时生效。
 * 约束：只写顶层 const / function；不 import、不 export、不依赖宿主环境；
 *       去掉行首 export 即可作为普通脚本内联（手法参考 hakihakii/bibibobo）。
 * 切勿手改产物（client.js / chat.html），它们会被 build.mjs 覆盖。
 * ==========================================================================*/

  /* ================= 设置存取（localStorage） ================= */
  let settings;
  try { settings = Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(LS_KEY) || '{}')); }
  catch (e) { settings = Object.assign({}, DEFAULTS); }
  const saveSettings = () => { try { localStorage.setItem(LS_KEY, JSON.stringify(settings)); } catch (e) { /* 忽略 */ } };


  /* ================= 后台日志（思考过程只进这里） ================= */
  let logs = [];
  try { logs = JSON.parse(localStorage.getItem(LS_LOG) || '[]'); } catch (e) { logs = []; }
  function log(type, text) {
    logs.push({ t: nowStr(), type, text: String(text).slice(0, 4000) });
    if (logs.length > 200) logs = logs.slice(-200);
    try { localStorage.setItem(LS_LOG, JSON.stringify(logs)); } catch (e) { /* 忽略 */ }
  }
  log('info', 'pet-buddy v' + PB_VERSION + ' 初始化');

  /* ======== src/core/stickers.js ======== */
/* ============================================================================
 * pet-buddy · 共享核心（core）· 贴纸与富文本
 * ----------------------------------------------------------------------------
 * src/core/*.js 是桌宠半边（client.js）与聊天窗口半边（chat.html）的唯一真相源：
 * 两份产物中都含同一段代码，由 build.mjs 按标记注入——改这里，两端同时生效。
 * 约束：只写顶层 const / function；不 import、不 export、不依赖宿主环境；
 *       去掉行首 export 即可作为普通脚本内联（手法参考 hakihakii/bibibobo）。
 * 切勿手改产物（client.js / chat.html），它们会被 build.mjs 覆盖。
 * ==========================================================================*/

  /* ================= 插件资产目录 =================
   * JS 内联样式里的相对 URL 以宿主页面为基准（会 404），一律加插件资产目录前缀。
   * 三种推导，任一生效即可：① 宿主注入的 <script src="/_plugins/<id>/client.js">；
   * ② 本页面自身路径（聊天窗口 /_plugins/<id>/chat.html）；
   * ③ 兜底。改名/移植后依然可用，不再硬编码插件 id。 */
  const ASSET_DIR = (() => {
    try {
      const s = document.querySelector('script[src$="/client.js"]');
      if (s && s.src.indexOf('/_plugins/') > 0) return s.src.replace(/[^/]*$/, '');
    } catch (e) { /* 回退 */ }
    try {
      if (location.pathname.indexOf('/_plugins/') >= 0) return location.pathname.replace(/[^/]*$/, '');
    } catch (e) { /* 回退 */ }
    return '/_plugins/pet-buddy/';
  })();
  let ASSET_DIR_RESOLVED = ''; // v3.3.1：启动时用 CSS 基准解析出的素材绝对目录（空=用 ASSET_DIR 回退）

  /* ---- 素材位置（v3.1.0 实测：宿主只服务插件根级文件，素材必须平铺） ----
   * 宿主对 /_plugins/<id>/ 只服务**根级文件**：根级新建文件立刻 200，而 assets/x.png、
   * assets/sprites/x.png、/./assets/x.png、assets%2Fx.png 全部 404 —— 子目录用不了。
   * 所以素材平铺在插件根目录，按前缀分组：feiyu-*（桌宠精灵图）、st-*（40 张贴纸）、
   * pet-deepseek.webp（内置女仆皮肤）、icon.png（插件图标）；清单见 assets.manifest.json。
   * 下面三个常量是"素材位置"的唯一开关：将来宿主支持子目录，改这三行 + 搬文件即可。 */
  /* 素材前缀：默认按 ASSET_DIR 拼，但**启动时会用 CSS 解析出的绝对基准重算**
   * （见下面的 resolveAssetUrls——宿主用 file/内部协议加载页面时，根相对路径会失效）。 */
  let ASSET_SPRITE = ASSET_DIR + 'feiyu-spritesheet.png';   // 官方精灵图
  let ASSET_SPRITE_CODEX = ASSET_DIR + 'pet-whale-codex.webp'; // 社区桌宠包精灵图（署名见 LICENSE-deepseekpet.txt）
  let ASSET_SKIN_DEFAULT = ASSET_DIR + 'pet-bongocat.png';  // 内置静态皮肤（BongoCat 猫猫，v3.3.3 起）
  let ASSET_STICKER = ASSET_DIR;                            // 贴纸前缀（st-*.webp）

  /** 精灵图网格规格（官方图集与社区包同规格；换规格时改这里 + CSS 变量由 JS 同步） */
  const SPRITE_GRID = { W: 1536, H: 2288, COLS: 8, ROWS: 11, CW: 192, CH: 208 };

  /* ---- 皮肤表（v3.3 可插拔精灵图皮肤） ----
   * 两种皮肤：
   *   ① sprite：整张精灵图按网格播动画（要求 8 列 × 11 行、cell 192×208、每行动作帧数同 STATES）——
   *      官方 ds-pet 与社区「Codex 桌宠包」都是这个规格，所以社区包能直接换图用；
   *   ② image ：单张静态图（内置女仆 / 用户自己传的图），配合 BongoCat 式键鼠监控。
   * 新增社区图集只要：把图平铺放插件根目录 → 在这里加一条（file + 名称 + 署名）→ 登记素材清单，
   * 再在 client.css 里加一行 `.pb2-pet-wrap.<cls> .pb2-sprite { background-image: url("<file>"); }`。
   * 图片一律走 CSS 相对路径加载（http / file 协议都可靠），JS 只切类名。 */
  const SPRITE_SKINS = {
    fish:  { name: '大肥鱼·鲸鲸娘', desc: 'ds-pet 官方 v2 精灵图 · 全动作动画', file: 'feiyu-spritesheet.png', cls: 'pb2-skin-fish', credit: '', url: ASSET_DIR + 'feiyu-spritesheet.png' },
    codex: { name: '大肥鱼·社区桌宠包', desc: '社区二创图集（同网格规格，直接换图可用）· 全动作动画', file: 'pet-whale-codex.webp', cls: 'pb2-skin-codex', credit: '素材：YunYueSama/codex-deepseek-pet（大肥鱼项目署名许可 1.0）', url: ASSET_DIR + 'pet-whale-codex.webp' },
  };
  /** 某皮肤是否走精灵图动画（社区图集与内置官方图集同一套网格规格，无需改渲染） */
  function isSpriteSkin(skin) { return !!SPRITE_SKINS[skin || 'fish']; }
  /** 皮肤的 CSS 类名（切图就靠它；空串=静态图皮肤） */
  function spriteSkinClass(skin) { const s = SPRITE_SKINS[skin]; return s ? s.cls : ''; }
  /** 皮肤精灵图的 URL（预览缩略图用；运行播放不依赖它） */
  function spriteSkinUrl(skin) { const s = SPRITE_SKINS[skin]; return s ? assetUrl(s.file) : ''; }

  /* ---- 静态图皮肤（v3.3.3） ----
   * pet-deepseek.webp（女仆）已按反馈删除：那张图自带桌子和手，再叠我们的浮空双爪图层很违和。
   * 换成 **BongoCat 猫猫**：原版 BongoCat 的键盘猫画面（kuroni/bongocat-osu，MIT），
   * 自带键盘与爪子 → 不叠图层，改用"按下帧"体现键鼠互动（敲键盘时爪子亮一下）。 */
  const IMAGE_SKINS = {
    bongo: {
      name: 'BongoCat 猫猫',
      desc: '键盘猫 · 敲键盘/动鼠标时爪子亮一下（素材：kuroni/bongocat-osu，MIT）',
      file: 'pet-bongocat.png',
      fileDown: 'pet-bongocat-down.png',
      paw: false,           // 素材自带爪子，不叠浮空爪图层
      credit: '素材：kuroni/bongocat-osu（MIT）',
    },
    /* v3.5.1：从社区桌面宠物项目里挑出来的两张形象（都是完整立绘/动画，不要再叠爪图层） */
    hedaren: {
      name: '和大人',
      desc: '清代权臣 Q 版 · 120 帧待机动画（会呼吸、会摆）',
      file: 'pet-hedaren.webp',
      anim: true,           // 动画 WebP：<img> 会自己播
      paw: false,
      credit: '素材：Yukilol13/dsh-hedaren-pet（MIT）',
    },
    ryan: {
      name: '大肥鱼·RYANFFY 立绘',
      desc: '鲸鱼娘正面立绘（静态图）',
      file: 'pet-dafeiyu-ryan.png',
      paw: false,
      credit: '素材：RYANFFY/deepseek-dafeiyu-pet（MIT）',
    },
  };
  /** 某皮肤是否走静态图（BongoCat / 用户上传的自定义图） */
  function isImageSkin(skin) { return !!IMAGE_SKINS[skin]; }

  /** 把探测到的可用前缀应用到所有素材常量上 */
  function applyAssetBase(base) {
    if (!base || base === ASSET_DIR_RESOLVED) return false;
    ASSET_DIR_RESOLVED = base;
    ASSET_SPRITE = base + 'feiyu-spritesheet.png';
    ASSET_SPRITE_CODEX = base + 'pet-whale-codex.webp';
    ASSET_SKIN_DEFAULT = base + 'pet-bongocat.png';
    ASSET_STICKER = base;
    for (const k of Object.keys(SPRITE_SKINS)) SPRITE_SKINS[k].url = base + SPRITE_SKINS[k].file;
    return true;
  }

  /** 从 CSS 取"素材绝对基准"：给隐藏探针挂 `background-image: var(--pb2-asset-base)`，
   *  读 computed style 得到浏览器解析后的绝对 URL，再去掉文件名。
   *  注意：这只是**候选之一**——桌面版把 CSS 内联注入页面时，相对 URL 会以页面为基准，
   *  解析出来的可能压根不是插件目录（v3.3.1 踩过：解析成 http://127.0.0.1:8788/）。 */
  function cssAssetBase(hostEl) {
    let probeEl = null;
    try {
      const host = hostEl || document.body || document.documentElement;
      if (!host || !host.appendChild) return '';
      probeEl = document.createElement('div');
      probeEl.setAttribute('aria-hidden', 'true');
      probeEl.style.cssText = 'position:absolute;left:-9999px;top:0;width:1px;height:1px;' +
        'background-image:var(--pb2-asset-base);background-repeat:no-repeat;';
      host.appendChild(probeEl);
      const bg = getComputedStyle(probeEl).backgroundImage || '';
      const m = bg.match(/^url\((['"]?)(.*?)\1\)$/);
      if (m && m[2] && m[2] !== 'none') return m[2].replace(/[^/]*$/, '');
    } catch (e) { /* 取不到就交给下一个候选 */ }
    finally { if (probeEl && probeEl.remove) probeEl.remove(); }
    return '';
  }

  /** 候选素材前缀（按"最可能可用"排序；都由 icon.png 实测验证过才会被采用） */
  function assetBaseCandidates() {
    const out = [];
    const push = (b) => { if (b && out.indexOf(b) < 0) out.push(b); };
    push('/_plugins/pet-buddy/');                                  // 根相对：走宿主静态服务（现读磁盘，新素材也取得到）
    try { if (location.origin && location.origin !== 'null') push(location.origin + '/_plugins/pet-buddy/'); } catch (e) { /* 老环境 */ }
    push(ASSET_DIR);                                               // 启动时推导出来的（含回退）
    push(cssAssetBase(document.body));                             // CSS 解析出的（宿主重写过 css 时就对）
    try { push(location.href.replace(/[^/]*(\?.*)?$/, '')); } catch (e) { /* 页面同目录 */ }
    return out;
  }

  /** **实测探测**素材基准：逐个候选拿 icon.png 试加载，第一个成功的即为真基准。
   *  为什么不靠推导：桌面版对 CSS 做重写、对路径的解析方式又随注入方式变化，
   *  只有"真能加载出来"才算数（v3.3.0/v3.3.1 两次翻车都是因为信了推导）。
   *  @param {(base:string, how:string, tried:string[])=>void} cb
   */
  function probeAssetBase(cb, opts) {
    const cands = assetBaseCandidates();
    const tried = [];
    const timeout = (opts && opts.timeout) || 2500;
    let i = 0, finished = false;
    const done = (base, how) => { if (!finished) { finished = true; cb(base || '', how || '', tried); } };
    if (typeof Image !== 'function') { done('', 'no-image'); return; }
    const next = () => {
      if (i >= cands.length) return done('', 'none');
      const cand = cands[i++];
      if (!cand) return next();
      tried.push(cand);
      let settled = false;
      const im = new Image();
      const timer = setTimeout(() => { if (!settled) { settled = true; im.onload = im.onerror = null; next(); } }, timeout);
      im.onload = () => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        if (im.naturalWidth > 0) done(cand, cand === '/_plugins/pet-buddy/' ? 'root-relative' : 'candidate');
        else next();
      };
      im.onerror = () => { if (settled) return; settled = true; clearTimeout(timer); next(); };
      im.src = cand + 'icon.png';
    };
    next();
  }

  /** 同步解析（探针未完成时的兜底）：只在 CSS 基准确实不同时改 */
  function resolveAssetUrls(hostEl) {
    const base = cssAssetBase(hostEl);
    if (!base) return { ok: false, base: base, changed: false };
    return { ok: applyAssetBase(base), base: base, changed: ASSET_DIR_RESOLVED === base };
  }
  /** 素材目录（探测成功后优先；不然用启动推导值） */
  function assetDir() { return ASSET_DIR_RESOLVED || ASSET_DIR; }
  /** 合成某个素材的完整 URL（贴纸、皮肤缩略图等用） */
  function assetUrl(file) { return assetDir() + file; }

  // 深海贴纸帧（窗口聊天用；row/col）
  const FISH_STICKERS = {
    wave:  { row: 3, col: 1 }, wave2: { row: 3, col: 3 },
    jump:  { row: 4, col: 2 },
    happy: { row: 0, col: 4 }, idle: { row: 0, col: 0 },
    hum:   { row: 5, col: 0 }, wait: { row: 6, col: 0 },
  };

  /* ---- 表情包贴纸（气泡与聊天共用的白名单渲染，防 XSS） ---- */
  const BEAN = {
    smile: '<circle cx="24" cy="24" r="20" fill="#ffd93b" stroke="#8a6d00" stroke-width="2"/><circle cx="17" cy="20" r="2.6" fill="#5b4a00"/><circle cx="31" cy="20" r="2.6" fill="#5b4a00"/><path d="M15 29q9 8 18 0" fill="none" stroke="#5b4a00" stroke-width="2.4" stroke-linecap="round"/>',
    lol: '<circle cx="24" cy="24" r="20" fill="#ffd93b" stroke="#8a6d00" stroke-width="2"/><path d="M12 18q5-4 10 0M26 18q5-4 10 0" fill="none" stroke="#5b4a00" stroke-width="2.4" stroke-linecap="round"/><path d="M14 27q10 12 20 0z" fill="#5b4a00"/>',
    cry: '<circle cx="24" cy="24" r="20" fill="#ffd93b" stroke="#8a6d00" stroke-width="2"/><path d="M13 20q4-3 8 0M27 20q4-3 8 0" fill="none" stroke="#5b4a00" stroke-width="2.4" stroke-linecap="round"/><path d="M16 32q8-6 16 0" fill="none" stroke="#5b4a00" stroke-width="2.4" stroke-linecap="round"/><ellipse cx="15" cy="26" rx="2.4" ry="4" fill="#6cb8ff"/>',
    angry: '<circle cx="24" cy="24" r="20" fill="#ffb03b" stroke="#8a5200" stroke-width="2"/><path d="M12 15l8 4M36 15l-8 4" stroke="#5b3a00" stroke-width="2.4" stroke-linecap="round"/><circle cx="18" cy="23" r="2.4" fill="#5b3a00"/><circle cx="30" cy="23" r="2.4" fill="#5b3a00"/><path d="M16 33q8-5 16 0" fill="none" stroke="#5b3a00" stroke-width="2.4" stroke-linecap="round"/>',
    shy: '<circle cx="24" cy="24" r="20" fill="#ffd93b" stroke="#8a6d00" stroke-width="2"/><circle cx="17" cy="21" r="2.4" fill="#5b4a00"/><circle cx="31" cy="21" r="2.4" fill="#5b4a00"/><path d="M18 30q6 4 12 0" fill="none" stroke="#5b4a00" stroke-width="2.4" stroke-linecap="round"/><ellipse cx="12" cy="27" rx="3.4" ry="2.2" fill="#ff9d9d"/><ellipse cx="36" cy="27" rx="3.4" ry="2.2" fill="#ff9d9d"/>',
    ok: '<circle cx="24" cy="24" r="20" fill="#ffd93b" stroke="#8a6d00" stroke-width="2"/><circle cx="17" cy="21" r="2.4" fill="#5b4a00"/><circle cx="31" cy="21" r="2.4" fill="#5b4a00"/><path d="M16 30l6 5 10-10" fill="none" stroke="#2e8b57" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>',
    wow: '<circle cx="24" cy="24" r="20" fill="#ffd93b" stroke="#8a6d00" stroke-width="2"/><circle cx="17" cy="19" r="2.8" fill="#5b4a00"/><circle cx="31" cy="19" r="2.8" fill="#5b4a00"/><ellipse cx="24" cy="31" rx="4.4" ry="5.6" fill="#5b4a00"/>',
    sleep: '<circle cx="24" cy="24" r="20" fill="#ffe38a" stroke="#8a6d00" stroke-width="2"/><path d="M13 22q4 3 8 0M27 22q4 3 8 0" fill="none" stroke="#5b4a00" stroke-width="2.4" stroke-linecap="round"/><path d="M20 30q4 2 8 0" fill="none" stroke="#5b4a00" stroke-width="2.2" stroke-linecap="round"/><text x="30" y="14" font-size="9" fill="#5b4a00" font-weight="bold">zZ</text>',
    star: '<circle cx="24" cy="24" r="20" fill="#ffd93b" stroke="#8a6d00" stroke-width="2"/><path d="M17 16l1.8 3.8L23 20l-3 2.8.8 4.2-3.8-2.2-3.8 2.2.8-4.2-3-2.8 4.2-.2z" fill="#ff8c00"/><path d="M31 16l1.8 3.8L37 20l-3 2.8.8 4.2-3.8-2.2-3.8 2.2.8-4.2-3-2.8 4.2-.2z" fill="#ff8c00"/><path d="M18 32q6 4 12 0" fill="none" stroke="#5b4a00" stroke-width="2.2" stroke-linecap="round"/>',
    think: '<circle cx="24" cy="24" r="20" fill="#ffd93b" stroke="#8a6d00" stroke-width="2"/><circle cx="17" cy="22" r="2.4" fill="#5b4a00"/><circle cx="31" cy="22" r="2.4" fill="#5b4a00"/><path d="M16 31h16" stroke="#5b4a00" stroke-width="2.2" stroke-linecap="round"/><circle cx="38" cy="9" r="3.4" fill="#fff" stroke="#8a94b8"/><circle cx="43" cy="4" r="2.2" fill="#fff" stroke="#8a94b8"/>',
  };
  // 模型输出标记的宽容别名：大小写/空格/中文括号/常见同义词都能映射到白名单项
  const STICKER_ALIAS = {
    wave: 'wave', wave2: 'wave2', waves: 'wave', hello: 'wave', hi: 'wave', 挥手: 'wave', 打招呼: 'wave',
    jump: 'jump', jumping: 'jump', 跳: 'jump', 跳跃: 'jump', 开心跳: 'jump',
    happy: 'happy', 满足: 'happy', 开心: 'happy', 高兴: 'happy',
    idle: 'idle', 待机: 'idle', 站: 'idle',
    hum: 'hum', hums: 'hum', hmph: 'hum', 哼: 'hum', 生气: 'hum', 傲娇: 'hum', 生气了: 'hum',
    wait: 'wait', waiting: 'wait', 等: 'wait', 等待: 'wait',
    smile: 'smile', 微笑: 'smile', 笑: 'smile',
    lol: 'lol', laugh: 'lol', 大笑: 'lol', 哈哈: 'lol',
    cry: 'cry', 哭: 'cry', 难过: 'cry', 泪: 'cry',
    angry: 'angry', 怒: 'angry', 炸毛: 'angry',
    shy: 'shy', 害羞: 'shy', 脸红: 'shy',
    ok: 'ok', 好: 'ok', 收到: 'ok',
    wow: 'wow', 惊讶: 'wow', 哇: 'wow', 吃惊: 'wow',
    sleep: 'sleep', 睡: 'sleep', 睡觉: 'sleep', 困: 'sleep',
    star: 'star', 星星眼: 'star', 赞叹: 'star',
    think: 'think', 思考: 'think', 想想: 'think', 疑问: 'think',
  };
  // 匹配宽容：大小写不限、标记内允许空格、支持 [x] / 【x】 / ［x］ 三种括号；
  // stick 长标记：规范形 [stick:archive:xx]/[stick:custom:N]，兜底形 [stick:xx]（缺组名，映射失败则忽略）
  const ST_RE = /[\[【［]\s*(fish|bean|maid|鱼|豆|仆)\s*[:：]\s*([a-zA-Z0-9_\u4e00-\u9fa5]+?)\s*[\]】］]|[\[【［]\s*stick\s*[:：]\s*(?:archive\s*[:：]\s*)?([a-zA-Z0-9_\u4e00-\u9fa5\-]{1,80}?)\s*[\]】］]|[\[【［]\s*stick\s*[:：]\s*custom\s*[:：]\s*(\d{1,3})\s*[\]】］]/gi;
  const GROUP_ALIAS = { fish: 'fish', bean: 'bean', maid: 'maid', '鱼': 'fish', '豆': 'bean', '仆': 'maid' };
  // archive 组贴纸（16 张档案馆 CC BY-NC-SA + 24 张微信 wxgf 裁切）：
  // 语义中文名 → 文件 id（模型输出中文语义键最好写；完整 id/短名/wx 数字简称同样兼容）
  const ARCHIVE_ALIAS = {
    // 语义短名（与 prompt 教学短语双向一致——模型照教学输出「抱头」等也必须可解析）
    '拒绝': 'deepseek-bao-bi-jujue', '睡觉': 'deepseek-bao-jing-shui-jiao', '吃瓜': 'deepseek-bao-xigua',
    '委屈': 'deepseek-bao-tou-wei-qu', '卖萌': 'deepseek-baozhe-weiba', 'token': 'deepseek-baozhe-beizi-kan-token',
    '游戏': 'deepseek-bao-shoubing', '流口水': 'deepseek-bao-glm-wanou-bash', '抱鱼': 'deepseek-bao-zhe-pangyu',
    '无语': 'deepseek-baobi-zuo-zai-pingguan-jian', '吓到': 'deepseek-bei-baozhu-jingxia', '发呆': 'deepseek-bao-xi-chuang-bian',
    '开吃': 'chatgpt-renwu-jieshao', '比心': 'deepseek-bixin', '敷衍': 'deepseek-baozhe-saozhou', '生气': 'deepseek-chashou-shengqi',
    // prompt 教学短语别名（抱臂拒绝=拒绝 等——教学原文同样可解析）
    '抱臂': 'deepseek-bao-bi-jujue', '抱头': 'deepseek-bao-tou-wei-qu', '抱着小鲸': 'deepseek-bao-jing-shui-jiao',
    '抱西瓜': 'deepseek-bao-xigua', '抱尾巴': 'deepseek-baozhe-weiba', 'token罐': 'deepseek-baozhe-beizi-kan-token',
    '坐罐堆': 'deepseek-baobi-zuo-zai-pingguan-jian', '被抱吓到': 'deepseek-bei-baozhu-jingxia',
    '窗边': 'deepseek-bao-xi-chuang-bian', '抱碗': 'chatgpt-renwu-jieshao', '扫帚': 'deepseek-baozhe-saozhou',
    '插手': 'deepseek-chashou-shengqi', '打游戏': 'deepseek-bao-shoubing',
  };
  // 档案表（id + 中文名）：表情面板与解析共用同一份真相源，ARCHIVE_IDS 由它派生
  const ARCHIVE = [
    { id: 'deepseek-bao-bi-jujue',    name: '拒绝：需求太离谱' },
    { id: 'deepseek-bao-jing-shui-jiao', name: '抱着小鲸睡觉' },
    { id: 'deepseek-bao-xigua',       name: '抱西瓜笑开花' },
    { id: 'deepseek-bao-tou-wei-qu',  name: '抱头委屈' },
    { id: 'deepseek-baozhe-weiba',    name: '抱尾巴可爱值拉满' },
    { id: 'deepseek-baozhe-beizi-kan-token', name: '盯着token罐吓到宕机' },
    { id: 'deepseek-bao-shoubing',    name: '这把再输尾巴挂机' },
    { id: 'deepseek-bao-glm-wanou-bash', name: '抱玩偶流口水CPU烧糊' },
    { id: 'deepseek-bao-zhe-pangyu',  name: '托脸抱胖鱼' },
    { id: 'deepseek-baobi-zuo-zai-pingguan-jian', name: '盘点库存盘到无语' },
    { id: 'deepseek-bei-baozhu-jingxia', name: '被抱到脸红CPU红温' },
    { id: 'deepseek-bao-xi-chuang-bian', name: '抱膝坐窗边眨眼' },
    { id: 'chatgpt-renwu-jieshao', name: '介绍会上抱碗开吃' },
    { id: 'deepseek-bixin',           name: '比心' },
    { id: 'deepseek-baozhe-saozhou',  name: '抱扫帚斜眼敷衍' },
    { id: 'deepseek-chashou-shengqi', name: '插手生气' },
    // 微信表情包 640.wxpic 解码裁切（wxgf/HEVC → 6×4=24 格，蓝色大肥鱼系）
    ...Array.from({ length: 24 }, (_, i) => ({ id: 'wx-' + String(i + 1).padStart(2, '0'), name: '微信表情包 ' + String(i + 1).padStart(2, '0') })),
  ];
  const ARCHIVE_IDS = ARCHIVE.map(a => a.id);
  function archiveResolve(id) {
    if (ARCHIVE_IDS.indexOf(id) >= 0) return id;                    // 完整 id / wx-NN
    if (ARCHIVE_ALIAS[id]) return ARCHIVE_ALIAS[id];                // 中文语义键
    const mWx = id.match(/^wx[-_]?(\d{1,2})$/i);                    // wx7 / wx_07
    if (mWx) {
      const cid = 'wx-' + mWx[1].padStart(2, '0');
      if (ARCHIVE_IDS.indexOf(cid) >= 0) return cid;
    }
    const mShort = id.match(/(?:deepseek-)?(.+)/);                  // 短名（去掉 deepseek- 前缀的 id 尾段）
    if (mShort) {
      const cid = 'deepseek-' + mShort[1];
      if (ARCHIVE_IDS.indexOf(cid) >= 0) return cid;
    }
    return null;
  }
  function normSticker(group, name) {
    const g = GROUP_ALIAS[group.toLowerCase()] || group.toLowerCase();
    const n = STICKER_ALIAS[name.toLowerCase()] || STICKER_ALIAS[name] || name.toLowerCase();
    return { g, n };
  }
  function stickerEl(g, n) {
    if (g === 'fish') {
      const f = FISH_STICKERS[n];
      if (!f) return null;
      const el = $new('span', 'sticker pb2-st-fish fish-st');   // 双类名：桌宠半边用 pb2-st-*，窗口页用 fish-st
      // bg-size 800% 1100%：每格恰好=元素大小（86×93），位移=元素尺寸×格序号
      el.style.backgroundPosition = (-86 * f.col) + 'px ' + (-93 * f.row) + 'px';
      return el;
    }
    if (g === 'bean') {
      if (!BEAN[n]) return null;
      const el = $new('span', 'sticker bean-st');
      el.innerHTML = '<svg viewBox="0 0 48 48" aria-hidden="true">' + BEAN[n] + '</svg>'; // 内置字典，非用户输入
      return el;
    }
    if (g === 'maid') {
      const el = $new('span', 'sticker pb2-st-maid maid-st');
      if (n === '1') {
        const img = document.createElement('img');
        img.src = ASSET_SKIN_DEFAULT;
        el.appendChild(img);
        return el;
      }
      return null;
    }
    if (g === 'stick') {
      // n 形如 'archive:<id或语义键或wxN>' 或 'custom:<N>'（与窗口聊天同一命名空间）
      const ci = n.indexOf(':');
      if (ci < 0) return null;
      const kind = n.slice(0, ci), id = n.slice(ci + 1);
      const el = $new('span', 'sticker pb2-st-stick stick-st');
      const img = document.createElement('img');
      if (kind === 'archive') {
        const rid = archiveResolve(id);
        if (!rid) return null;
        img.src = ASSET_STICKER + 'st-' + rid + '.webp';
      } else if (kind === 'custom') {
        const idx = Number(id);
        const arr = (JSON.parse(localStorage.getItem('pb2.settings.v2') || '{}').customStickers) || [];
        if (isNaN(idx) || !arr[idx]) return null;
        img.src = arr[idx];
      } else {
        return null;
      }
      img.alt = kind;
      el.appendChild(img);
      return el;
    }
    return null;
  }
  /** 富文本渲染：文本走 textNode，贴纸标记走白名单元素（防 XSS 主路径）。
   *  v2.2.2 兜底：标记匹配但白名单查无此项（模型编的名字/缺组名的 [stick:xx]）→ 忽略不显示，不出破碎标记 */
  function renderRich(container, text) {
    container.textContent = '';
    let last = 0, m;
    ST_RE.lastIndex = 0;
    while ((m = ST_RE.exec(String(text)))) {
      if (m.index > last) container.appendChild(document.createTextNode(text.slice(last, m.index)));
      let el = null;
      if (m[1]) {
        const { g, n } = normSticker(m[1], m[2]);
        el = stickerEl(g, n);
      } else if (m[4] !== undefined) {
        el = stickerEl('stick', 'custom:' + m[4]);
      } else if (m[3] !== undefined || m[2] !== undefined) {
        // 规范形 [stick:archive:xx] 或兜底形 [stick:xx]：都当 archive 语义/短名解析
        el = stickerEl('stick', 'archive:' + (m[3] !== undefined ? m[3] : m[2]));
      }
      if (el) container.appendChild(el); // null = 白名单查无 → 忽略标记
      last = m.index + m[0].length;
    }
    if (last < String(text).length) container.appendChild(document.createTextNode(text.slice(last)));
  }

  /* ======== src/core/balance.js ======== */
/* ============================================================================
 * pet-buddy · 共享核心（core）· 余额与积分
 * ----------------------------------------------------------------------------
 * src/core/*.js 是桌宠半边（client.js）与聊天窗口半边（chat.html）的唯一真相源：
 * 两份产物中都含同一段代码，由 build.mjs 按标记注入——改这里，两端同时生效。
 * 约束：只写顶层 const / function；不 import、不 export、不依赖宿主环境；
 *       去掉行首 export 即可作为普通脚本内联（手法参考 hakihakii/bibibobo）。
 * 切勿手改产物（client.js / chat.html），它们会被 build.mjs 覆盖。
 * ==========================================================================*/

  /* ================= 余额引擎 ================= */
  // 价目（元/百万 token）：[谷, 峰]。prompt 无缓存命中细分，按未命中价保守估算。
  const PRICES = {
    flash: { hit: [0.02, 0.04], miss: [1, 2], out: [4, 8] },
    pro:   { hit: [0.15, 0.3],  miss: [4.5, 9], out: [13.5, 27] },
  };
  // 全天谷价的法定假日（2026 年公开放假安排）
  const HOLIDAY_VALLEY = new Set([
    '2026-01-01','2026-01-02','2026-01-03',
    '2026-02-15','2026-02-16','2026-02-17','2026-02-18','2026-02-19','2026-02-20','2026-02-21','2026-02-22','2026-02-23',
    '2026-04-04','2026-04-05','2026-04-06',
    '2026-05-01','2026-05-02','2026-05-03','2026-05-04','2026-05-05',
    '2026-06-19','2026-06-20','2026-06-21',
    '2026-09-25','2026-09-26','2026-09-27',
    '2026-10-01','2026-10-02','2026-10-03','2026-10-04','2026-10-05','2026-10-06','2026-10-07',
  ]);
  const pad2 = n => String(n).padStart(2, '0');
  function localDateStr(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  // 谷价：北京时间 00:30–08:30（对应官方错峰时段）或法定假日全天
  function isValley(now) {
    const d = now || new Date();
    if (HOLIDAY_VALLEY.has(localDateStr(d))) return true;
    const mins = d.getHours() * 60 + d.getMinutes();
    return mins >= 30 && mins < 510; // 00:30 ~ 08:30
  }
  function priceTier(model) {
    const m = (model || '').toLowerCase();
    return m.indexOf('pro') >= 0 ? PRICES.pro : PRICES.flash;
  }

  let balCache = { at: 0, data: null };
  let gatewayInfo = { baseURL: '', at: 0 };
  async function gatewayBase() {
    if (gatewayInfo.at && Date.now() - gatewayInfo.at < 300000) return gatewayInfo.baseURL;
    try {
      const r = await fetch('/api/config', { headers: { 'Accept': 'application/json' } });
      if (r.ok) { const j = await r.json(); gatewayInfo = { baseURL: String(j.baseURL || ''), at: Date.now() }; }
    } catch (e) { /* 离线 */ }
    return gatewayInfo.baseURL;
  }
  async function todaySpend(force) {
    if (!force && balCache.data && Date.now() - balCache.at < 60000) return balCache.data;
    const valley = isValley(new Date());
    const out = { date: localDateStr(new Date()), prompt: 0, cacheHit: 0, output: 0, calls: 0, cost: 0, costCredits: 0, credits: null, companyQuota: null, valley, sessions: 0, staleSessions: 0, apiOk: false, gateway: '' };
    try {
      const r = await fetch('/api/sessions', { headers: { 'Accept': 'application/json' } });
      if (r.ok) {
        const j = await r.json();
        const list = (j && j.sessions) || j || [];
        for (const s of list) {
          const active = String(s.updatedAt || s.createdAt || '').slice(0, 10);
          if (active !== out.date) continue; // 今天没活动的会话不算
          // v3.1.0：会话用量是**累计值**（usagePrompt/usageOutput 从建会话算起），跨天会话里
          // 昨天的用量也会被算进来——实测把 22 个活跃会话的历史累计当"今日"，能算出接近整月
          // 额度的虚高数字。所以只统计「今天建的会话」（其累计量全部属于今天），
          // 更早建的跨天会话单独计数提示，不硬塞进今日（deferred：宿主没有按天用量接口）。
          if (String(s.createdAt || '').slice(0, 10) !== out.date) { out.staleSessions++; continue; }
          const p = Number(s.usagePrompt) || 0, o = Number(s.usageOutput) || 0, c = Number(s.usageCalls) || 0;
          // 会话用量里带 usageCacheHit（命中缓存的输入 token）——命中价便宜一个量级，
          // 之前整包按未命中价估，会把花费算高；这里拆开计价。
          const hit = Math.min(p, Math.max(0, Number(s.usageCacheHit) || 0));
          const miss = Math.max(0, p - hit);
          out.prompt += p; out.cacheHit += hit; out.output += o; out.calls += c; out.sessions++;
          const tier = priceTier(s.model);
          const k = valley ? 0 : 1;
          out.cost += (miss / 1e6) * tier.miss[k] + (hit / 1e6) * tier.hit[k] + (o / 1e6) * tier.out[k];
        }
        out.apiOk = true;
      }
    } catch (e) { log('error', '余额取数失败: ' + e.message); }
    out.gateway = await gatewayBase();
    out.cost = Math.round(out.cost * 10000) / 10000;
    // v2.2.3 积分制：今日估算折积分 + 余额来源（v3.1.0：内部通道额度优先，网关账单仅 sk- Key）
    out.costCredits = Math.round(out.cost * perYuanCredits());
    const both = await Promise.all([fetchCompanyQuota(force), fetchCredits(force)]);
    out.companyQuota = both[0];
    out.credits = both[1];
    // v3.1.0：额度接口的「月度累计已用」按天取增量＝当日真实消耗（比 token 估算可信得多，
    // 因为它是后端自己的计价）。插件只在运行期间采样，所以口径是「从今天首次打开插件到现在」。
    try {
      const q = out.companyQuota;
      if (q && q.ok) {
        const used = Number(q.usedPoints) || 0;
        const rec = JSON.parse(localStorage.getItem(LS_QUOTA_DAILY) || 'null');
        if (!rec || rec.date !== out.date || used < Number(rec.last || 0)) {
          // 新的一天（或跨月重置导致数字回退）：重新起算
          out.realSince = nowStr().slice(11, 16);
          out.realToday = 0;
        } else {
          out.realSince = rec.since || '';
          out.realToday = Math.max(0, used - Number(rec.first || 0));
        }
        out.realOk = true;
        localStorage.setItem(LS_QUOTA_DAILY, JSON.stringify({ date: out.date, first: out.realToday > 0 ? Number(rec.first) : used, last: used, since: out.realSince }));
      }
    } catch (e) { /* 只是估算，失败不影响余额显示 */ }
    balCache = { at: Date.now(), data: out };
    return out;
  }
  function fmtMoney(n) {
    if (n >= 100) return '¥' + n.toFixed(1);
    if (n >= 1) return '¥' + n.toFixed(2);
    return '¥' + n.toFixed(4);
  }

  /* ================= v2.2.3 积分制（1000 分 = 1 元） =================
   * 后端（公司网关）按积分计费：1000 分 = 1 元。真实数据源（OpenAI 兼容 billing）：
   *   GET {网关}/v1/dashboard/billing/subscription → system_hard_limit_usd（账户额度，≥1e8 视为不限额）
   *   GET {网关}/v1/dashboard/billing/usage → total_usage（美分，累计；日期参数被网关忽略）
   * 积分 = 美元 × 每元积分（默认 1000，可在聊天设置调整）。
   * 需在聊天设置配置网关地址+令牌；未配置时退回本地 token 估算并折成积分显示。 */
  /* ================= v3.1.0 令牌识别 + 内部通道额度 =================
   * 公司内部通道的令牌形如 jxai-<姓名>-<设备号>（例 jxai-杨镇城-jx-yzc）——它是「身份牌」：
   *   ① 浏览器 fetch 不允许把非 ASCII 字符放进请求头，带中文的令牌根本发不出去；
   *   ② 公司网关 /v1/* 也不认它（实测返回 Invalid token），它不是 OpenAI 兼容的 API Key。
   * 所以内部通道的余额**不看令牌**，而是由助手接口 GET /api/models 的 companyQuota 直接给出
   * （月度额度，单位就是「分」，与插件积分制一致）——这才是内部通道用户看余额的正确来源。
   * 真正能查网关账单的是 sk- 开头的 API Key（走 OpenAI 兼容 billing 接口，见 fetchCredits）。 */
  function parseGatewayToken(raw) {
    const t = String(raw == null ? '' : raw).trim();
    if (!t) return { kind: 'empty', valid: false, label: '未填写' };
    if (/^sk-/.test(t)) return { kind: 'apikey', valid: true, label: '网关 API Key' };
    const m = t.match(/^jxai-([^-]{1,24})-(.+)$/);
    if (m) return { kind: 'inner', valid: true, name: m[1], device: m[2], label: '公司内部通道身份牌' };
    return { kind: 'other', valid: false, label: '格式无法识别' };
  }
  /** 令牌输入框下方的即时说明（聊天设置里用） */
  function tokenHint(raw) {
    const t = parseGatewayToken(raw);
    if (t.kind === 'inner') return '已识别：公司内部通道身份牌（' + t.name + ' · 设备 ' + t.device + '）。' +
      '内部通道的真实额度由助手直接给出（剩余/月度总额），不需要填令牌；这个牌子不是网关 API Key。';
    if (t.kind === 'apikey') return '已识别：网关 API Key（sk- 开头），余额按网关账单（订阅额度 − 累计用量）显示。';
    if (t.kind === 'empty') return '留空即可：余额显示助手给出的内部通道额度（月度分）＋ 今日估算。只有 sk- 开头的 Key 才去读网关账单。';
    return '格式无法识别：网关 API Key 形如 sk-xxxx；公司内部通道身份牌形如 jxai-姓名-设备号（例 jxai-杨镇城-jx-yzc）。';
  }

  let QUOTA_CACHE = { at: 0, data: null };
  /** 助手接口的内部通道额度：{points, remainPoints, usedPoints, periodText, nextAt, asOf}，单位「分」 */
  async function fetchCompanyQuota(force) {
    if (!force && QUOTA_CACHE.data && Date.now() - QUOTA_CACHE.at < 60000) return QUOTA_CACHE.data;
    const out = { ok: false };
    try {
      const r = await fetch('/api/models', { headers: { 'Accept': 'application/json' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      const q = j && j.companyQuota;
      if (!q || typeof q.remainPoints !== 'number') throw new Error('接口未返回 companyQuota');
      out.ok = true;
      out.points = Number(q.points) || 0;
      out.remainPoints = Number(q.remainPoints) || 0;
      out.usedPoints = Number(q.usedPoints) || 0;
      out.periodText = String(q.periodText || '');
      out.nextAt = String(q.nextAt || '');
      out.asOf = String(q.asOf || '');
    } catch (e) {
      out.reason = e.message;
      log('error', '内部额度读取失败: ' + e.message);
    }
    QUOTA_CACHE = { at: Date.now(), data: out };
    return out;
  }
  /** 内部额度一句话（余额气泡/聊天回复共用；无额度时返回空串） */
  function quotaLine(q) {
    if (!q || !q.ok) return '';
    let s = '剩余积分 ' + fmtCredits(q.remainPoints) + ' 分（月度 ' + fmtCredits(q.points) + '，已用 ' + fmtCredits(q.usedPoints) + '）';
    if (q.periodText) s += '，' + q.periodText + '刷新';
    return s;
  }

  let CREDITS_CACHE = { at: 0, data: null };
  function perYuanCredits() { return Number(settings.perYuan) > 0 ? Number(settings.perYuan) : 1000; }
  function fmtCredits(n) { return Math.round(n).toLocaleString('en-US'); }
  async function fetchCredits(force) {
    if (!force && CREDITS_CACHE.data && Date.now() - CREDITS_CACHE.at < 120000) return CREDITS_CACHE.data;
    const base = (settings.gatewayBase || (await gatewayBase())).replace(/\/+$/, '');
    const key = settings.gatewayKey || '';
    const tk = parseGatewayToken(key);
    const out = { ok: false };
    if (tk.kind !== 'apikey') {
      // v3.1.0：非 sk- Key（留空 / 内部通道身份牌 / 其他格式）不去打网关账单接口——
      // 免得白等一次 401，也让余额气泡改说人话（内部通道看助手额度，见 fetchCompanyQuota）
      out.reason = tk.kind === 'inner' ? '内部通道身份牌，不查网关账单（余额看助手额度）'
        : tk.kind === 'empty' ? '未配置网关 API Key' : '令牌不是 sk- 开头的网关 API Key';
    } else if (!base) {
      out.reason = '未配置网关地址';
    } else {
      try {
        const hdr = { 'Authorization': 'Bearer ' + key };
        const end = localDateStr(new Date(Date.now() + 864e5));
        const r1 = await fetch(base + '/v1/dashboard/billing/subscription', { headers: hdr });
        if (!r1.ok) throw new Error('subscription HTTP ' + r1.status);
        const sub = await r1.json();
        let usedUsd = 0;
        try {
          const r2 = await fetch(base + '/v1/dashboard/billing/usage?start_date=2020-01-01&end_date=' + end, { headers: hdr });
          if (r2.ok) {
            const use = await r2.json();
            usedUsd = Number(use.total_usage || 0) / 100; // 美分 → 美元
          }
        } catch (e2) { /* usage 可选 */ }
        const limit = Number(sub.system_hard_limit_usd ?? sub.hard_limit_usd ?? 0);
        const unlimited = limit >= 1e8;
        out.ok = true;
        out.unlimited = unlimited;
        out.remainCredits = unlimited ? null : Math.max(0, Math.round((limit - usedUsd) * perYuanCredits()));
        out.usedCredits = Math.round(usedUsd * perYuanCredits());
        out.perYuan = perYuanCredits();
      } catch (e) {
        out.reason = e.message;
        log('error', '积分读取失败: ' + e.message);
      }
    }
    CREDITS_CACHE = { at: Date.now(), data: out };
    return out;
  }

  /* ======== src/core/speech.js ======== */
/* ============================================================================
 * pet-buddy · 共享核心（core）· 语音播报：把回复念成「哔哔啵啵」的小人声
 * ----------------------------------------------------------------------------
 * 合成核心来自 vendor/bibibobo.js（MIT，构建期原样内联，只去掉行首 export）：
 *   一条抗混叠锯齿波 → 两个带通滤波器捏共振峰（口型）→ 一个字一声
 *   （hash(字) 选音高与口型，同一个字永远同一声）→ 每个声线一组音阶 →
 *   标点管语气（问号尾音上滑、感叹号整句升高、省略号压低）。零依赖、全离线。
 * 播放走 Web Audio 单实例：新一句开始前停掉上一句，音量统一经一个 GainNode。
 * 自动播放策略：无用户手势的冷启动会拿到 suspended 的上下文、声音出不来——
 *   本模块**静默降级**（不上屏、不报错、只记一条日志），绝不弹窗打扰。
 * 调用方约定：speak() 返回 Promise（播完/被跳过/被挡住都会 resolve，不 reject）。
 * ==========================================================================*/

  const SPEECH_SR = 44100;  // 采样率（bibibobo 原样；降到 16k 会闷掉共振峰的齿音）
  let SPEECH = null;        // { ctx, gain, src, id }：全局一份，懒创建

  /** 声线名 → 展示名（设置面板用） */
  const SPEECH_VOICE_NAMES = { fish: '大肥鱼（高）', lumo: '路墨（低）' };

  /** 语音总开关与音量（settings 是唯一真相源；改完调 speechApplyVolume） */
  function speechEnabled() { return settings.speechOn !== false; }
  function speechVolume() { return clamp(Number(settings.speechVolume) >= 0 ? Number(settings.speechVolume) : 0.5, 0, 1); }

  function speechCtx() {
    if (SPEECH && SPEECH.ctx) return SPEECH.ctx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    try {
      const ctx = new Ctx();
      const gain = ctx.createGain();
      gain.gain.value = speechVolume();
      gain.connect(ctx.destination);
      SPEECH = { ctx, gain, src: null, id: 0 };
      return ctx;
    } catch (e) { log('error', '音频上下文创建失败: ' + e.message); return null; }
  }

  function speechApplyVolume() { if (SPEECH && SPEECH.gain) SPEECH.gain.gain.value = speechVolume(); }

  /** 在用户手势里调一次：把被策略挂起的上下文唤起来（之后自动说话才出声） */
  function speechUnlock() {
    const ctx = speechCtx();
    if (!ctx) return false;
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch (e) { /* 只能等下一次手势 */ } }
    if (ctx.state !== 'running') return false;
    // 0 长度缓冲"空播"一次：部分内核要把上下文真正跑起来才算解锁
    try {
      const b = ctx.createBuffer(1, 1, SPEECH_SR);
      const s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.gain); s.start();
    } catch (e) { /* 无所谓，唤醒失败也不影响后续尝试 */ }
    return true;
  }

  function speechStop() {
    if (SPEECH && SPEECH.src) {
      const s = SPEECH.src; SPEECH.src = null;
      try { s.onended = null; s.stop(); } catch (e) { /* 已经停了 */ }
    }
  }

  /** 状态快照（诊断/验证页用） */
  function speechState() {
    return {
      enabled: speechEnabled(), volume: speechVolume(), hasCtx: !!(SPEECH && SPEECH.ctx),
      ctxState: SPEECH && SPEECH.ctx ? SPEECH.ctx.state : 'none', speaking: !!(SPEECH && SPEECH.src),
      follow: speechFollowEnabled(), mode: speechMode(), ttsVoice: ttsVoicePref(), ttsRate: ttsRatePref(),
      ttsCached: ttsCache.size,
    };
  }

  /* ================= v3.4 韵律跟读：TTS → 音高/口型/音量 → 锯齿+带通重唱 =================
   * 经典合成是"一个字一声"（音高只有 5 档、按字哈希决定），所以听起来偏念经、离真人语调远。
   * 这一版换条路：先请宿主「语音」组件的后端 TTS（POST /api/voice/tts，Edge 通道、免配置）
   * 把整句真读一遍，再从这段音频里**逐帧量出**三样东西——
   *   ① 基频 F0（自相关，即"语调"）② 能量（即"轻重"）③ 过零率（当"口型"的粗线索），
   * 最后用 bibibobo 那套「抗混叠锯齿波 + 两个带通」照着这条曲线重唱。
   * 效果：音色仍是「哔哔啵啵」，但抑扬顿挫、疑问上扬、停顿长短全是真人语气。
   * 全流程走本机后端（TTS 在宿主侧合成）；任何一步失败都回退经典合成，绝不因此不出声。 */

  const ANALYZE_SR = 16000;            // 分析用采样率（量音高足够，算得快）
  const PROSODY_HOP_SEC = 0.02;        // 每 20ms 一帧
  const PROSODY_WIN = 1024;            // 每帧 64ms 窗
  const F0_MIN = 70, F0_MAX = 400;     // 人声基频范围
  const TTS_CACHE_MAX = 24;            // 最近若干句的 TTS 结果（同一句重播不再请求）
  const TTS_TIMEOUT_MS = 9000;

  const ttsCache = new Map();          // 文本 → { pcm:Float32Array(16k), durSec }
  const trackCache = new Map();        // 文本 → 韵律轨

  function speechFollowEnabled() { return settings.speechFollow !== false; }
  /** v3.6：三种朗读模式 —— guided（语调引导）/ classic（经典合成）/ tts（普通朗读，真人声直接播） */
  function speechMode() {
    const m = String(settings.speechMode || '');
    if (m === 'guided' || m === 'classic' || m === 'tts') return m;
    return settings.speechFollow === false ? 'classic' : 'guided';
  }
  function ttsVoicePref() { return String(settings.ttsVoice || ''); }
  function ttsRatePref() { return clamp(Number(settings.ttsRate) || 1, 0.5, 2); }

  /** 调宿主后端 TTS 取音频 → 解码 → 16k 单声道 PCM（失败抛错，由 speak 回退经典合成） */
  async function ttsPcm(text, opts) {
    const hit = ttsCache.get(text);
    if (hit) return hit;
    const ctx = speechCtx();
    if (!ctx) throw new Error('no-ctx');
    const o = opts || {};
    const ctrl = new AbortController();
    const timer = setTimeout(() => { try { ctrl.abort(); } catch (e) { /* 已结束 */ } }, o.timeout || TTS_TIMEOUT_MS);
    let ab;
    try {
      const res = await fetch('/api/voice/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text, rate: o.rate || ttsRatePref(), voice: o.voice || ttsVoicePref() }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error('TTS HTTP ' + res.status);
      ab = await res.arrayBuffer();
      if (!ab || ab.byteLength < 512) throw new Error('TTS 音频过短');
    } finally { clearTimeout(timer); }
    const buf = await ctx.decodeAudioData(ab);
    const mono = mixToMono(buf);
    const pcm = buf.sampleRate === ANALYZE_SR ? mono : resampleLinear(mono, buf.sampleRate, ANALYZE_SR);
    const rec = { pcm: pcm, durSec: pcm.length / ANALYZE_SR, srcSampleRate: buf.sampleRate, mono: mono };
    if (ttsCache.size >= TTS_CACHE_MAX) ttsCache.delete(ttsCache.keys().next().value);
    ttsCache.set(text, rec);
    return rec;
  }

  function mixToMono(buf) {
    const n = buf.length, out = new Float32Array(n);
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < n; i++) out[i] += d[i];
    }
    if (buf.numberOfChannels > 1) for (let i = 0; i < n; i++) out[i] /= buf.numberOfChannels;
    return out;
  }

  /** 线性重采样（TTS 源多为 24k/44.1k → 16k） */
  function resampleLinear(x, srIn, srOut) {
    if (!x.length || srIn === srOut) return x;
    const ratio = srOut / srIn, n = Math.max(1, Math.round(x.length * ratio)), out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const pos = i / ratio, i0 = Math.floor(pos), frac = pos - i0;
      const a = x[i0] || 0, b = x[i0 + 1] !== undefined ? x[i0 + 1] : a;
      out[i] = a + (b - a) * frac;
    }
    return out;
  }

  /** 逐帧量韵律（20ms 一帧） */
  function prosodyTrack(pcm) {
    const sr = ANALYZE_SR;
    const hop = Math.max(1, Math.round(PROSODY_HOP_SEC * sr));
    const win = PROSODY_WIN;
    const frames = [];
    let prevF0 = 0;
    for (let s = 0; s + win <= pcm.length; s += hop) {
      const f = analyzeFrame(pcm, s, win, sr, prevF0);
      if (f.f0 > 0) prevF0 = f.f0;
      frames.push(f);
    }
    return { frames: frames, hopSec: hop / sr, durSec: pcm.length / sr, sr: sr };
  }

  /** 单帧分析：去均值 → 自相关找基频（粗搜再细搜，省一半算力）→ 能量与过零率 */
  function analyzeFrame(x, start, win, sr, prevF0) {
    let mean = 0;
    for (let i = 0; i < win; i++) mean += x[start + i];
    mean /= win;
    let energy = 0, zc = 0, prevSign = 0;
    for (let i = 0; i < win; i++) {
      const v = x[start + i] - mean;
      energy += v * v;
      const sgn = v >= 0 ? 1 : 0;
      if (i && sgn !== prevSign) zc++;
      prevSign = sgn;
    }
    const rms = Math.sqrt(energy / win);
    const minLag = Math.max(2, Math.floor(sr / F0_MAX));
    const maxLag = Math.min(win - 4, Math.floor(sr / F0_MIN));
    const corr = (lag) => {
      let acc = 0;
      for (let i = 0; i + lag < win; i++) acc += (x[start + i] - mean) * (x[start + i + lag] - mean);
      return acc / (win - lag);
    };
    let best = -Infinity, bestLag = 0;
    const lags = [];
    for (let lag = minLag; lag <= maxLag; lag += 3) lags.push(lag);            // 粗搜
    for (let lag = Math.max(minLag, bestLag ? bestLag - 3 : minLag); lag <= Math.min(maxLag, (bestLag || minLag) + 3); lag++) {
      if (lags.indexOf(lag) < 0) lags.push(lag);                              // 细搜（稍后统一打分）
    }
    const scored = lags.map((lag) => ({ lag, v: corr(lag) }));
    for (const s of scored) if (s.v > best) { best = s.v; bestLag = s.lag; }
    // 整数倍陷阱：200Hz 的 lag=80/160/240 相关性几乎一样高，取全局最大会误判成低八度。
    // 解决：先找最大，再取"第一个达到 0.9×最大"的 lag（= 最短周期 = 真实基频）。
    if (bestLag) {
      for (const s of scored) {
        if (s.lag < bestLag && s.v >= best * 0.9) { bestLag = s.lag; break; }
      }
    }
    const conf = best / (energy / win + 1e-9);
    let f0 = 0;
    if (rms > 0.006 && conf > 0.25 && bestLag > 0) {
      f0 = sr / bestLag;
      if (prevF0 > 0) {   // 八度纠错：人声不会一帧跳八度
        const cands = [f0, f0 * 2, f0 / 2];
        let pick = f0, bestDiff = Math.abs(Math.log(f0 / prevF0));
        for (const c of cands) { const d = Math.abs(Math.log(c / prevF0)); if (d < bestDiff) { bestDiff = d; pick = c; } }
        f0 = pick;
      }
      if (f0 < F0_MIN || f0 > F0_MAX) f0 = 0;
    }
    // 过零率 → 口型档：高频多的（前元音/齿音）用亮口型，低沉的用暗口型
    const zcr = zc / win;
    const vowel = zcr > 0.18 ? 4 : zcr > 0.12 ? 1 : zcr > 0.08 ? 0 : zcr > 0.05 ? 3 : 2;
    return { f0: f0, rms: rms, vowel: vowel, zcr: zcr };
  }

  /* ---- v3.4.1：把 TTS 用在"选音"上，而不是逐帧重唱 ----
   * v3.4.0 试过"逐帧照抄 F0 连续重唱"（见文件末尾已弃用的 synthFollow）——听感像跑调，不好听。
   * 现在改成：**结构、音色、口型全部照经典合成**（一个字一声、声线音阶、按字选口型），
   * 只把"这个字唱哪个音"从 `hash(字)` 换成"**在声线音阶里挑最接近真人这一声的那个音**"。
   * 于是还是那个哔哔啵啵的小人声，但抑扬顿挫跟着真人语调走（疑问上扬、重音突出都能听出来）。 */

  /** 在声线音阶里挑一个最接近目标频率的音；shift = 整体平移的半音数（不传则自动试一个八度内） */
  function pickScaleMidi(f0, scale, shift) {
    const sc = (scale && scale.length) ? scale : VOICES.fish.scale;
    if (!(f0 > 0)) return sc[0];
    const target = 69 + 12 * Math.log2(f0 / 440);   // Hz → MIDI
    const shifts = (shift === undefined || shift === null) ? [-12, 0, 12] : [shift];
    let best = sc[0], bestD = Infinity;
    for (const s of sc) {
      for (const sh of shifts) {
        const d = Math.abs(s + sh - target);
        if (d < bestD) { bestD = d; best = s + sh; }
      }
    }
    return best;
  }

  /** 整句统一的八度平移量：真人音域（~100–350Hz）比这些"小人声线"（~660–1050Hz）低得多，
   *  必须整句一起挪，才能在保留**相对**音高走向的同时让每个音都落在音阶上（否则全被吸到同一个音）。 */
  function guidedShift(f0list, scale) {
    const sc = (scale && scale.length) ? scale : VOICES.fish.scale;
    const targets = (f0list || []).filter(v => v > 0).map(v => 69 + 12 * Math.log2(v / 440));
    if (!targets.length) return -12;
    let bestShift = -12, bestErr = Infinity;
    for (const sh of [-24, -12, 0, 12, 24]) {
      let err = 0;
      for (const t of targets) {
        let near = Infinity;
        for (const s of sc) near = Math.min(near, Math.abs(s + sh - t));
        err += near;
      }
      err /= targets.length;
      if (err < bestErr) { bestErr = err; bestShift = sh; }
    }
    return bestShift;
  }

  /** 把一串目标音高"放进音阶"：按**相对句中位**的高低去选档。
   *  真人音域（一两百 Hz 到三百多 Hz，跨度常在 15 个半音以上）比这些小人声线（5 档、跨度 8 个半音）宽得多，
   *  直接按绝对值挑最近音，会把大半的字都挤到同一个音上（起伏全丢）——
   *  所以这里只映射**相对走向**：比句中位高就往上选，低就往下选，形状留住、幅度略微夸张一点更可爱。 */
  function guidedPickList(f0list, scale) {
    const sc = (scale && scale.length) ? scale : VOICES.fish.scale;
    const mid = (sc.length - 1) / 2;
    const vals = (f0list || []).map(v => (v > 0 ? 69 + 12 * Math.log2(v / 440) : NaN));
    const ok = vals.filter(v => !isNaN(v));
    if (!ok.length) return vals.map(() => sc[Math.round(mid)]);
    const sorted = ok.slice().sort((a, b) => a - b);
    const pct = (p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)))];
    const med = pct(0.5);
    const span = Math.max(5, (pct(0.9) - pct(0.1)) / 2);   // 自适应幅度
    return vals.map(v => {
      if (isNaN(v)) return sc[Math.round(mid)];
      const d = clamp(((v - med) / span) * 1.25, -1, 1);
      return sc[clamp(Math.round(mid + d * mid), 0, sc.length - 1)];
    });
  }

  /** 每个字的"目标音高"：把 TTS 判为浊音的帧按字数等分，每段取中位基频 */
  function guidedTargets(track, count) {
    const res = new Array(Math.max(0, count)).fill(0);
    const frames = (track && track.frames) || [];
    const voiced = [];
    for (const f of frames) if (f.f0 > 0) voiced.push(f.f0);
    if (!voiced.length || count <= 0) return res;
    const per = Math.max(1, Math.floor(voiced.length / count));
    for (let i = 0; i < count; i++) {
      const seg = voiced.slice(i * per, i === count - 1 ? voiced.length : (i + 1) * per);
      if (!seg.length) continue;
      const sorted = seg.slice().sort((a, b) => a - b);
      res[i] = sorted[Math.floor(sorted.length / 2)];
    }
    return res;
  }

  /** 语调引导合成：结构/音色/口型全照经典，只有音高按上面的"选音"来 */
  function synthGuided(text, track, opts) {
    const o = opts || {};
    const v = typeof o.voice === 'object' ? Object.assign({}, VOICES.fish, o.voice) : (VOICES[o.voice || 'fish'] || VOICES.fish);
    const sampleRate = o.sampleRate || SPEECH_SR;
    const step = o.step || v.step;
    const gap = o.gap === undefined ? 0.22 : o.gap;
    // v3.7：按标点/表情标记切段，段间停顿时长由标点决定（明显断句）
    const sentences = speechSegments(text)
      .map(s => ({ text: s.text, tk: syllables(s.text), pause: Math.max(s.pauseSec, gap * 0.6) }))
      .filter(s => s.tk.length);
    const totalTk = sentences.reduce((n, s) => n + s.tk.length, 0) || 1;
    const targets = guidedTargets(track, totalTk);
    const mids = guidedPickList(targets, v.scale);          // 按相对走向选档（不是绝对值）
    const total = sentences.reduce((n, s) => n + s.tk.length * step + s.pause, 0) + 0.4;
    const out = new Float32Array(Math.ceil(total * sampleRate));
    let t = 0.02, k = 0;
    for (const { text: s, tk, pause } of sentences) {
      const ask = /[？?]$/.test(s), shout = /[！!]/.test(s), sad = /(……|\.\.\.|…)$/.test(s);
      tk.forEach((w, i) => {
        const last = i === tk.length - 1;
        const m = (mids[k++] !== undefined ? mids[k - 1] : v.scale[0]) + (shout ? 3 : 0) - (sad ? 3 : 0);
        const dur = Math.min(step * v.hold, v.maxDur) + (last && (ask || shout || sad) ? 0.1 : 0);
        voice(out, sampleRate, t + i * step, m, dur, v,
          last && ask ? 5 : last && sad ? -4 : last ? v.fall : 0,
          hash(w));   // 口型仍按字来，保持经典听感
      });
      t += tk.length * step + pause;
    }
    for (let i = 0; i < out.length; i++) out[i] = Math.tanh(out[i] * 2.4);
    return out;
  }

  /* 已弃用（v3.4.1）：逐帧照抄 F0 的连续重唱，听感像跑调——保留代码只作对照，默认路径不再用它。 */
  function synthFollow(track, opts) {
    const o = opts || {};
    const v = VOICES[o.voice || 'fish'] || VOICES.fish;
    const sr = SPEECH_SR;
    const frames = track.frames || [];
    const out = new Float32Array(Math.max(1, Math.ceil((track.durSec + 0.06) * sr)));
    if (!frames.length) return out;
    const osc = saw(sr);
    const bp1 = bandpass(sr), bp2 = bandpass(sr);
    let ampSm = 0, f0Sm = frames[0].f0 > 0 ? frames[0].f0 : 180;
    for (let i = 0; i < out.length; i++) {
      const fi = Math.min(frames.length - 1, Math.floor((i / sr) / track.hopSec));
      const fr = frames[fi];
      if (!fr) break;
      const voiced = fr.f0 > 0;
      // 平稳化：音高/音量都走一阶低通（否则有台阶声）；清音段保留少量气息
      const fTarget = voiced ? fr.f0 : f0Sm;
      const aTarget = clamp(fr.rms * 7, 0, 1.2) * (voiced ? 1 : 0.25);
      f0Sm += (fTarget - f0Sm) * 0.25;
      ampSm += (aTarget - ampSm) * 0.2;
      const [a, b] = VOWELS[fr.vowel % VOWELS.length];
      const s = osc(f0Sm);
      out[i] = (bp1(s, a * v.formant, 4) + 0.7 * bp2(s, b * v.formant, 5)) * ampSm * v.gain * 3.0;
    }
    // 峰值归一 + 软限幅：响度稳（音量交给播放端的 GainNode），音色不变
    let peak = 0;
    for (let i = 0; i < out.length; i++) { const a2 = Math.abs(out[i]); if (a2 > peak) peak = a2; }
    if (peak > 0) { const k = 0.9 / peak; for (let i = 0; i < out.length; i++) out[i] = Math.tanh(out[i] * k * 1.6) * 0.95; }
    return out;
  }

  /** 清洗成「能念的文本」：剥掉贴纸标记/代码/链接/markdown 记号，压平空白，按上限截断 */
  function speechClean(raw) {
    let t = String(raw == null ? '' : raw);
    // v3.7：表情/贴纸标记不念，但**当作一次停顿**（用户要求：[stick:…] 也算断句）
    t = t.replace(/\[(?:stick|fish|bean)\s*:[^\]]*\]/gi, '｜');
    t = t.replace(/```[\s\S]*?```/g, ' ');                      // 代码块
    t = t.replace(/`[^`]*`/g, ' ');
    t = t.replace(/https?:\/\/\S+/g, ' ');                      // 链接
    t = t.replace(/[*_#>~]/g, ' ');                             // markdown 记号（保留 ｜ 停顿标记）
    t = t.replace(/[（(]\s*[)）]/g, ' ');
    t = t.replace(/[ \t\r\n]+/g, ' ').trim();
    t = t.replace(/\s*｜\s*/g, '｜');                            // 停顿标记两侧不留空格
    const max = clamp(Math.round(Number(settings.speechMaxChars) || 60), 4, 400);
    if (t.length > max) t = t.slice(0, max).replace(/[，,、；;：:。.!！?？｜\s]+$/, '') + '……';
    return t;
  }

  /** 标点 → 该停多久（秒）。断句明显与否就靠这张表 */
  function pauseOf(p) {
    if (!p) return 0.10;                       // 段与段之间的小气口
    if (p.indexOf('｜') >= 0) return 0.34;      // 表情/贴纸标记 = 明显停顿
    if (/…/.test(p)) return 0.36;               // 省略号拉长
    if (/[。！？!?]/.test(p)) return 0.30;      // 句末
    return 0.16;                                // 逗号/顿号/分号/冒号
  }

  /** 切段：每段带上"说完该停多久"（v3.7 断句的核心） */
  function speechSegments(text) {
    const s = String(text || '');
    const out = [];
    const re = /([^。！？!?…，,、；;：:｜\n]+)([。！？!?…]+|[，,、；;：:]+|｜)?/g;
    let m;
    while ((m = re.exec(s)) !== null) {
      const body = (m[1] || '').trim();
      const punct = m[2] || '';
      if (!body) { if (punct) out.push({ text: '', pauseSec: pauseOf(punct) }); continue; }
      out.push({ text: body + punct, pauseSec: pauseOf(punct) });
    }
    return out;
  }

  /** 经典合成 + 断句：逐段调用 vendor 的 synth，段间按标点插静音 */
  function synthPaced(text, opts) {
    const o = opts || {};
    const sr = o.sampleRate || SPEECH_SR;
    const segs = speechSegments(text).filter(x => syllables(x.text).length > 0);
    if (!segs.length) return new Float32Array(0);
    const parts = [];
    let total = 0.02;
    for (const seg of segs) {
      let a;
      try { a = synth(seg.text, { voice: o.voice, step: o.step, sampleRate: sr }); }
      catch (e) { continue; }
      if (!a || !a.length) continue;
      parts.push({ a: a, pause: seg.pauseSec });
      total += a.length / sr + seg.pauseSec;
    }
    if (!parts.length) return new Float32Array(0);
    const out = new Float32Array(Math.ceil(total * sr));
    let pos = Math.round(0.02 * sr);
    for (const p of parts) {
      if (pos + p.a.length <= out.length) out.set(p.a, pos);
      pos += p.a.length + Math.round(p.pause * sr);
    }
    return out;
  }

  /**
   * 念一句。
   * @param {string} raw 要说的话（会先 speechClean）
   * @param {{force?:boolean, onStart?:Function, onEnd?:Function}} [opts]
   *   force=true 时无视总开关（设置面板的「试听」用）
   * @returns {Promise<{ok:boolean, reason?:string, skipped?:string, seconds?:number, text?:string}>}
   *   ok=true 播完；ok=false 说明原因（off/empty/no-ctx/blocked/synth/start），调用方不必处理错误
   */
  async function speak(raw, opts) {
    const o = opts || {};
    if (!speechEnabled() && !o.force) return { ok: false, skipped: 'off' };
    const text = speechClean(raw);
    if (!text || !text.replace(/[｜\s]+/g, '')) return { ok: false, skipped: 'empty' };
    const ctx = speechCtx();
    if (!ctx) return { ok: false, reason: 'no-ctx' };
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch (e) { /* 等手势 */ } }
    // ① 三种模式（v3.6）：
    //    tts     = 普通朗读，直接用宿主 TTS 的真人声播（不走合成器、不改音色）
    //    guided  = 语调引导（经典音色 + 按真人语调选音）
    //    classic = 经典合成（完全按字）
    let samples = null, via = 'classic', sampleRate = SPEECH_SR;
    const mode = o.style || speechMode();
    if (mode === 'tts') {
      try {
        const rec = await ttsPcm(text, { rate: o.rate });
        if (rec.mono && rec.srcSampleRate) { samples = rec.mono; sampleRate = rec.srcSampleRate; via = 'tts'; }
      } catch (e) {
        log('info', '普通朗读不可用，回退语调引导：' + (e && e.message ? e.message : e));
      }
    }
    if (!samples && mode !== 'classic') {
      try {
        const rec = await ttsPcm(text, { rate: o.rate });
        let track = trackCache.get(text);
        if (!track) {
          track = prosodyTrack(rec.pcm);
          if (trackCache.size >= TTS_CACHE_MAX) trackCache.delete(trackCache.keys().next().value);
          trackCache.set(text, track);
        }
        if (track.frames.length > 2) {
          // v3.4.1：用"语调引导"（经典音色 + 按真人语调选音），不再用连续重唱
          samples = synthGuided(text, track, {
            voice: settings.speechVoice || 'fish',
            step: clamp(Number(settings.speechStep) || 0.13, 0.06, 0.4),
            sampleRate: SPEECH_SR,
          });
          via = 'guided';
        }
      } catch (e) {
        log('info', '韵律跟读不可用，改用经典合成：' + (e && e.message ? e.message : e));
      }
    }
    // ② 经典合成（回退，也是"跟读关闭"时的正路）：一个字一声
    if (!samples) {
      try {
        samples = synthPaced(text, { voice: settings.speechVoice || 'fish', step: clamp(Number(settings.speechStep) || 0.13, 0.06, 0.4), sampleRate: SPEECH_SR });
      } catch (e) {
        log('error', '语音合成失败: ' + e.message);
        return { ok: false, reason: 'synth' };
      }
    }
    const durSec = samples.length / sampleRate;
    let buf;
    try {
      buf = ctx.createBuffer(1, samples.length, sampleRate);
      buf.copyToChannel(samples, 0);
    } catch (e) {
      log('error', '语音缓冲准备失败: ' + e.message);
      return { ok: false, reason: 'buffer' };
    }
    speechStop(); // 单实例：新的一句打断上一句
    const id = ++SPEECH.id;
    const node = ctx.createBufferSource();
    node.buffer = buf; node.connect(SPEECH.gain);
    SPEECH.src = node;
    if (o.onStart) { try { o.onStart({ text, seconds: durSec, via }); } catch (e) { /* 回调出错不影响播放 */ } }
    return new Promise((resolve) => {
      let settled = false;
      const t0 = ctx.currentTime;
      const finish = (r) => {
        if (settled) return;
        settled = true;
        if (SPEECH && SPEECH.src === node) SPEECH.src = null;
        if (o.onEnd) { try { o.onEnd(r); } catch (e) { /* 同上 */ } }
        resolve(Object.assign({ text, seconds: durSec, id, via }, r));
      };
      node.onended = () => finish({ ok: true });
      try { node.start(); } catch (e) { finish({ ok: false, reason: 'start' }); return; }
      // 兜底：正常播完也一定有 onended；这里只防"被策略挡住 → 一声不响也不结束"。
      // 判据：起播 350ms 后音频时钟还没走 → 认定没出声（冷启动被策略拦），静默收场。
      setTimeout(() => {
        if (settled) return;
        if (ctx.state === 'suspended' || ctx.currentTime - t0 < 0.005) {
          log('info', '语音未能出声（浏览器的自动播放策略：需要一次用户点击后才能自动说话）');
          try { node.stop(); } catch (e) { /* 未起播 */ }
          finish({ ok: false, reason: 'blocked' });
        }
      }, 350);
      // 第二道兜底：时钟异常时别让 Promise 永远挂着
      setTimeout(() => { if (!settled) { try { node.stop(); } catch (e) { /* 已停 */ } finish({ ok: true, late: true }); } }, (durSec + 1.2) * 1000);
    });
  }

  /** 试听（设置面板/菜单用：无视开关，念一句固定台词） */
  function speechProbe(text) {
    speechUnlock();
    return speak(text || '哼哼，本小姐的声音，好听吧？', { force: true });
  }

  /* ======== src/core/sfx.js ======== */
/* ============================================================================
 * pet-buddy · 共享核心（core）· 交互音效（v3.3）
 * ----------------------------------------------------------------------------
 * 音效不额外找素材 —— 用同一套「哔哔啵啵」合成器（vendor/bibibobo.js）造短音：
 *   一个字 + 短时长 + 无声隙＝一声干净的「啵 / 叮 / 唰 / 哔」，与语音同一个音色家族。
 * 播放：独立 GainNode 直连输出（音量与语音分开），音效可叠加（连点不会互相掐断），
 *   但同一个音效在 90ms 内只响一次（防手抖连点糊成一片）。
 * 策略：无用户手势时静默降级（不上屏不报错）；开关默认开，音量默认 0.6。
 * ==========================================================================*/

  /** 音效谱：文本 + 声线 + 语速 + 相对音量（文本就是"念"出来的那个字） */
  const SFX_SPEC = {
    tap:  { text: '啵', voice: 'fish', step: 0.085, gain: 0.75 }, // 点桌宠
    pop:  { text: '叮', voice: 'fish', step: 0.10,  gain: 0.55 }, // 菜单/面板弹出、开始收音
    drop: { text: '唰', voice: 'lumo', step: 0.085, gain: 0.60 }, // 拖拽吸附到边缘
    ok:   { text: '嗯', voice: 'fish', step: 0.10,  gain: 0.50 }, // 听写识别成功
    err:  { text: '哔', voice: 'lumo', step: 0.12,  gain: 0.65 }, // 出错
  };
  const SFX_MIN_GAP_MS = 90;
  const SFX_CACHE = new Map();   // name → Float32Array（合成一次反复用）
  const SFX_LAST = new Map();    // name → 上次播放时刻
  let SFX_GAIN = null;

  function sfxEnabled() { return settings.sfxOn !== false; }
  function sfxVolume() { return clamp(Number(settings.sfxVolume) >= 0 ? Number(settings.sfxVolume) : 0.6, 0, 1); }

  function sfxGainNode() {
    const ctx = speechCtx();
    if (!ctx) return null;
    if (!SFX_GAIN || SFX_GAIN.context !== ctx) {
      SFX_GAIN = ctx.createGain();
      SFX_GAIN.gain.value = sfxVolume();
      SFX_GAIN.connect(ctx.destination);
    }
    return SFX_GAIN;
  }
  function sfxApplyVolume() { if (SFX_GAIN) SFX_GAIN.gain.value = sfxVolume(); }

  function sfxSamples(name) {
    if (SFX_CACHE.has(name)) return SFX_CACHE.get(name);
    const spec = SFX_SPEC[name] || SFX_SPEC.pop;
    let out = null;
    try { out = synth(spec.text, { voice: spec.voice, step: spec.step, gap: 0.01, sampleRate: SPEECH_SR }); }
    catch (e) { log('error', '音效合成失败 ' + name + ': ' + e.message); }
    SFX_CACHE.set(name, out);
    return out;
  }

  /**
   * 响一声音效。
   * @param {'tap'|'pop'|'drop'|'ok'|'err'} name
   * @param {{force?:boolean}} [opts] force=true 无视开关（设置面板试听）
   * @returns {boolean} 是否真的发起了播放（false = 关着/无音频环境/被防抖吞掉）
   */
  function sfx(name, opts) {
    const o = opts || {};
    if (!sfxEnabled() && !o.force) return false;
    const spec = SFX_SPEC[name];
    if (!spec) return false;
    const now = Date.now();
    if (!o.force && now - (SFX_LAST.get(name) || 0) < SFX_MIN_GAP_MS) return false;
    SFX_LAST.set(name, now);
    const ctx = speechCtx();
    const gain = sfxGainNode();
    if (!ctx || !gain) return false;
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch (e) { /* 等手势 */ } }
    const samples = sfxSamples(name);
    if (!samples || !samples.length) return false;
    try {
      const buf = ctx.createBuffer(1, samples.length, SPEECH_SR);
      buf.copyToChannel(samples, 0);
      const node = ctx.createBufferSource();
      node.buffer = buf;
      const v = ctx.createGain();
      v.gain.value = clamp(spec.gain * (o.force ? 1 : 1), 0, 1);
      node.connect(v); v.connect(gain);
      node.start();
      return true;
    } catch (e) { log('error', '音效播放失败 ' + name + ': ' + e.message); return false; }
  }

  /** 音效状态（设置面板/诊断用） */
  function sfxState() {
    return { enabled: sfxEnabled(), volume: sfxVolume(), hasGain: !!SFX_GAIN, cached: SFX_CACHE.size, names: Object.keys(SFX_SPEC) };
  }

  /* ======== src/core/voiceinput.js ======== */
/* ============================================================================
 * pet-buddy · 共享核心（core）· 语音听写：对着桌宠说话（右 Alt+M）
 * ----------------------------------------------------------------------------
 * 采集：16 kHz 单声道（AudioContext + MediaStreamSource + ScriptProcessor，
 *   与宿主「语音」组件同一套做法；内核给不到 16k 时内部线性重采样到 16k）。
 * VAD：噪声底自适应，阈值 = max(0.008, 底 × 3.5)（与宿主语音组件同口径）；
 *   尾部静音满 2 秒、或松开热键、或超过 60 秒 → 收尾。
 * 识别：POST /api/c/voice/asr/transcribe —— 宿主「语音」组件的本地离线模型
 *   （零配置、不联网）。组件被关掉时该端点 404，这里给出人话提示，不假装成功。
 * 触发：右 Alt + M（按住说话，松开结束）。左 Alt 是助手自带的听写，本插件不碰。
 * 纪律：识别结果先回显给用户看（「你说：…」）再发出去；空结果不发送。
 * 调用方约定：viStart() 可能失败（未授权/无麦克风），一律返回 {ok, reason}。
 * ==========================================================================*/

  const VI_ASR_URL = '/api/c/voice/asr/transcribe';
  const VI_SR = 16000;            // 识别引擎要的采样率
  const VI_MIN_SPEECH_MS = 350;   // 短于它算噪声毛刺（不说话就不发）
  const VI_TAIL_SILENCE_MS = 2000;// 尾部静音满 2 秒自动收尾
  const VI_MAX_MS = 60000;        // 单次上限
  const VI = {
    phase: 'idle', stream: null, ctx: null, node: null, srcNode: null,
    frames: [], speechMs: 0, silenceMs: 0, noise: 0.004, startedAt: 0, level: 0,
    cbs: [], resultCbs: [], lastErr: '', autoStopped: false, timer: null,
  };

  function viPhase() { return VI.phase; }
  function viLastError() { return VI.lastErr; }
  /** 订阅状态变化：cb(phase, info)；phase = idle | recording | recognizing | error */
  function viOn(cb) { if (typeof cb === 'function') VI.cbs.push(cb); }
  /** 订阅「一轮听写的结论」：cb({ok, text?, reason?})——手动松开、静音自动收尾都走这里 */
  function viOnResult(cb) { if (typeof cb === 'function') VI.resultCbs.push(cb); }
  function viEmitResult(r) { for (const cb of VI.resultCbs) { try { cb(r); } catch (e) { /* 回调异常不影响流程 */ } } }
  function viEmit(extra) {
    const info = Object.assign({ level: VI.level, ms: Date.now() - VI.startedAt, err: VI.lastErr }, extra || {});
    for (const cb of VI.cbs) { try { cb(VI.phase, info); } catch (e) { /* 回调异常不影响录音流程 */ } }
  }
  function viSetPhase(p, extra) { VI.phase = p; viEmit(extra); }

  /** 线性重采样（内核给不到 16k 时用；语音带宽窄，这样够） */
  function viResample(input, fromRate, toRate) {
    if (fromRate === toRate) return input;
    const ratio = fromRate / toRate;
    const outLen = Math.max(1, Math.floor(input.length / ratio));
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const pos = i * ratio, i0 = Math.floor(pos), i1 = Math.min(input.length - 1, i0 + 1), frac = pos - i0;
      out[i] = input[i0] * (1 - frac) + input[i1] * frac;
    }
    return out;
  }
  /** Float32 采样 → 16 位单声道 WAV 的 base64（ASR 接口要的格式） */
  function viWavB64(floats) {
    const len = floats.length;
    const buf = new ArrayBuffer(44 + len * 2);
    const v = new DataView(buf);
    const wstr = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    wstr(0, 'RIFF'); v.setUint32(4, 36 + len * 2, true); wstr(8, 'WAVE');
    wstr(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, VI_SR, true); v.setUint32(28, VI_SR * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    wstr(36, 'data'); v.setUint32(40, len * 2, true);
    for (let i = 0; i < len; i++) {
      const s = Math.max(-1, Math.min(1, floats[i]));
      v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    const u8 = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  /** 语音识别（本地离线模型）：返回识别文本（空串＝没听清） */
  async function viTranscribe(wavB64) {
    const ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), 90000) : null;
    try {
      const r = await fetch(VI_ASR_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cmd: 'transcribe', model: 'xasr', device: 'cpu', wav_b64: wavB64 }),
        signal: ctl ? ctl.signal : undefined,
      });
      if (r.status === 404) throw new Error('语音听写不可用：宿主的「语音」组件未开启（设置 → 语音）');
      if (!r.ok) throw new Error('语音识别失败（HTTP ' + r.status + '）');
      const d = await r.json();
      return String((d && (d.text || d.result)) || '').trim();
    } finally { if (timer) clearTimeout(timer); }
  }

  function viTeardown() {
    if (VI.timer) { clearInterval(VI.timer); VI.timer = null; }
    try { if (VI.node) VI.node.disconnect(); } catch (e) { /* 已断 */ }
    try { if (VI.srcNode) VI.srcNode.disconnect(); } catch (e) { /* 已断 */ }
    try { if (VI.ctx) VI.ctx.close(); } catch (e) { /* 已关 */ }
    try { if (VI.stream) VI.stream.getTracks().forEach((t) => t.stop()); } catch (e) { /* 已停 */ }
    VI.node = null; VI.srcNode = null; VI.ctx = null; VI.stream = null;
    VI.frames = []; VI.speechMs = 0; VI.silenceMs = 0; VI.noise = 0.004; VI.level = 0;
  }

  /** 开始录音。返回 {ok:true} 或 {ok:false, reason} */
  async function viStart() {
    if (VI.phase === 'recording') return { ok: true, already: true };
    if (VI.phase === 'recognizing') return { ok: false, reason: 'busy' };
    VI.lastErr = ''; VI.autoStopped = false;
    const md = (typeof navigator !== 'undefined' && navigator.mediaDevices) ? navigator.mediaDevices : null;
    if (!md || !md.getUserMedia) {
      VI.lastErr = '当前环境没有麦克风接口（需要 https 或本机地址）';
      viSetPhase('error', { reason: 'no-api' });
      return { ok: false, reason: VI.lastErr };
    }
    let stream;
    try {
      stream = await md.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      const denied = e && (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError');
      VI.lastErr = denied ? '麦克风未授权（Windows 设置 → 隐私 → 麦克风 / 允许桌面应用访问）' : ('麦克风不可用：' + (e && e.message ? e.message : e));
      viSetPhase('error', { reason: 'mic' });
      return { ok: false, reason: VI.lastErr };
    }
    VI.stream = stream;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      VI.ctx = new Ctx({ sampleRate: VI_SR });
    } catch (e) { VI.ctx = new (window.AudioContext || window.webkitAudioContext)(); }
    VI.srcNode = VI.ctx.createMediaStreamSource(stream);
    VI.node = VI.ctx.createScriptProcessor(4096, 1, 1);
    VI.frames = []; VI.speechMs = 0; VI.silenceMs = 0; VI.noise = 0.004; VI.startedAt = Date.now();
    VI.node.onaudioprocess = (ev) => {
      if (VI.phase !== 'recording') return;
      const f = ev.inputBuffer.getChannelData(0);
      let sum = 0;
      for (let i = 0; i < f.length; i++) sum += f[i] * f[i];
      const rms = Math.sqrt(sum / f.length);
      VI.level = Math.min(1, rms * 7);
      const frameMs = (f.length / VI.ctx.sampleRate) * 1000;
      const isSpeech = rms > Math.max(0.008, VI.noise * 3.5);
      if (!isSpeech) VI.noise = Math.min(0.02, VI.noise * 0.98 + rms * 0.02);
      if (isSpeech) {
        VI.frames.push(new Float32Array(f));
        VI.speechMs += frameMs; VI.silenceMs = 0;
      } else if (VI.speechMs > 0) {
        VI.frames.push(new Float32Array(f)); // 说话后的间隙也留着（识别更连贯），由收尾统一截
        VI.silenceMs += frameMs;
      }
      // 自动收尾：说过话 + 尾部静音满 2 秒（或单次超上限）
      if ((VI.speechMs >= VI_MIN_SPEECH_MS && VI.silenceMs >= VI_TAIL_SILENCE_MS) || (Date.now() - VI.startedAt > VI_MAX_MS)) {
        VI.autoStopped = true;
        viEmit({ auto: true });
        setTimeout(() => { viStop().catch(() => {}); }, 0);
      }
    };
    VI.srcNode.connect(VI.node);
    VI.node.connect(VI.ctx.destination); // 内核要求节点入图才会回调
    viSetPhase('recording', { started: true });
    try { if (VI.ctx.state === 'suspended') await VI.ctx.resume(); } catch (e) { /* 唤醒失败也继续录 */ }
    return { ok: true };
  }

  /** 结束录音并识别。结论经 viOnResult 派发（无论成功失败），同时作为返回值给出 */
  async function viStop() {
    if (VI.phase !== 'recording') return { ok: false, reason: 'not-recording' };
    const ctxRate = VI.ctx ? VI.ctx.sampleRate : VI_SR;
    const frames = VI.frames, speechMs = VI.speechMs;
    viTeardown();
    viSetPhase('recognizing', { speechMs });
    if (speechMs < VI_MIN_SPEECH_MS) {
      VI.lastErr = '没听到说话（按住 ' + VI_HOTKEY_LABEL + ' 说完再松开）';
      viSetPhase('idle', { silent: true });
      const r = { ok: false, reason: 'silent', silent: true, message: VI.lastErr };
      viEmitResult(r);
      return r;
    }
    const total = frames.reduce((n, c) => n + c.length, 0);
    const all = new Float32Array(total);
    let off = 0;
    for (const c of frames) { all.set(c, off); off += c.length; }
    const pcm = viResample(all, ctxRate, VI_SR);
    try {
      const text = await viTranscribe(viWavB64(pcm));
      viSetPhase('idle', { text });
      if (!text) {
        VI.lastErr = '没听清（说得慢一点、离麦克风近一点）';
        const r = { ok: false, reason: 'empty', message: VI.lastErr };
        viEmitResult(r);
        return r;
      }
      const r = { ok: true, text, seconds: pcm.length / VI_SR };
      viEmitResult(r);
      return r;
    } catch (e) {
      VI.lastErr = (e && e.name === 'AbortError') ? '语音识别超时（识别引擎忙或组件未就绪）' : (e && e.message ? e.message : String(e));
      viSetPhase('error', { reason: 'asr' });
      const r = { ok: false, reason: VI.lastErr, message: VI.lastErr };
      viEmitResult(r);
      return r;
    }
  }

  /** 放弃这一轮（按键取消/失焦）：不识别、不上传 */
  function viCancel() {
    if (VI.phase !== 'recording') return false;
    viTeardown();
    viSetPhase('idle', { cancelled: true });
    return true;
  }

  /* ---- 右 Alt + M：按住说话（左 Alt 属于助手自带的听写，这里不碰） ----
   * 浏览器对右 Alt 的报法不统一：key='Alt' + location=2，或 key='AltGraph'；
   * 两种都认。热键只负责"何时按下/松开"，具体流程由调用方决定。
   * handlers = { onStart, onCancel }：按下时调 onStart；松开时调用方自行 viStop()
   * （viStop 的结论经 viOnResult 派发，所以松开处理不必回传）。 */
  let VI_HOTKEY_BOUND = false;
  let viRightAlt = false;
  function viWatchHotkey(handlers) {
    if (VI_HOTKEY_BOUND) return false;
    VI_HOTKEY_BOUND = true;
    const h = handlers || {};
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Alt' && e.location === 2) viRightAlt = true;
      if (e.key === 'AltGraph') viRightAlt = true;
      if (e.code === 'KeyM' && viRightAlt && !e.repeat) {
        e.preventDefault();
        if (h.onStart) { try { h.onStart(); } catch (err) { /* 调用方异常不影响热键 */ } }
      }
    }, true);
    document.addEventListener('keyup', (e) => {
      if (e.key === 'Alt' && e.location === 2) viRightAlt = false;
      if (e.key === 'AltGraph') viRightAlt = false;
      if (e.code === 'KeyM' && VI.phase === 'recording') {
        e.preventDefault();
        if (h.onStop) { try { h.onStop(); } catch (err) { /* 同上 */ } }
        else viStop().catch(() => {});
      }
    }, true);
    window.addEventListener('blur', () => {
      viRightAlt = false;
      if (VI.phase === 'recording' && viCancel() && h.onCancel) { try { h.onCancel(); } catch (err) { /* 同上 */ } }
    });
    return true;
  }

  /** 热键文案（气泡与设置里共用一处，避免两处写岔） */
  const VI_HOTKEY_LABEL = '右 Alt + M';

  /* ======== src/core/chat.js ======== */
/* ============================================================================
 * pet-buddy · 共享核心（core）· 聊天引擎（三通道）
 * ----------------------------------------------------------------------------
 * src/core/*.js 是桌宠半边（client.js）与聊天窗口半边（chat.html）的唯一真相源：
 * 两份产物中都含同一段代码，由 build.mjs 按标记注入——改这里，两端同时生效。
 * 约束：只写顶层 const / function；不 import、不 export、不依赖宿主环境；
 *       去掉行首 export 即可作为普通脚本内联（手法参考 hakihakii/bibibobo）。
 * 切勿手改产物（client.js / chat.html），它们会被 build.mjs 覆盖。
 * ==========================================================================*/

  /* ================= 聊天引擎（三通道） ================= */
  // 14 轮短期记忆（网关/模拟通道使用；assistant 通道由子对话天然持有）
  const shortMemory = [];

  function periodGreet() {
    const h = new Date().getHours();
    if (h >= 5 && h < 11) return '早上好';
    if (h < 14) return '中午好';
    if (h < 18) return '下午好';
    if (h < 23) return '晚上好';
    return '夜深了';
  }

  /** 组装发给模型的文本。
   * v2.1.3 起：人设不再每轮全量——full=true（子对话首条或人设/昵称变化后的第一条）才带
   * 「桌宠设定+用户资料」；之后正常聊天只发用户消息本身 + 可选余额数据，人设靠子对话历史。 */
  function buildPrompt(userText, balanceBlock, full) {
    const parts = [];
    if (full !== false) {
      const persona = (settings.persona || '').trim() || DEFAULT_PERSONA;
      parts.push('【桌宠设定·系统级，始终遵守】\n' + persona);
      const profile = ['当前时段：' + periodGreet()];
      if (settings.nickname) profile.push('用户昵称：' + settings.nickname);
      if (profile.length) parts.push('【用户资料】' + profile.join('；'));
      // 与窗口化聊天一致的贴纸标记说明（v2.2.2：archive 组全量教学+优先使用指示）
      const ARCH_PROMPT =
        '抱臂拒绝=拒绝、抱着小鲸=睡觉、抱西瓜=吃瓜、抱头=委屈、抱尾巴=卖萌、token罐=token、' +
        '打游戏=游戏、流口水=流口水、抱胖鱼=抱鱼、坐罐堆=无语、被抱吓到=吓到、窗边=发呆、' +
        '抱碗=开吃、比心=比心、扫帚=敷衍、插手=生气；另有 wx1～wx24 大肥鱼日常系列。';
      parts.push('【表情包标记】回复中可以插贴纸（会渲染成图片），写法与可用贴纸：' +
        '① [stick:archive:中文名] —— archive 组（蓝色大肥鱼表情包，你的主力表情，优先使用这组）：' + ARCH_PROMPT + '\n' +
        '② 备选小表情：' +
        Object.keys(FISH_STICKERS).map(k => '[fish:' + k + ']').join(' ') + '、' +
        Object.keys(BEAN).map(k => '[bean:' + k + ']').join(' ') + '、[maid:1]。' +
        '格式必须严格用半角方括号加英文冒号（如 [stick:archive:比心] 或 [bean:smile]），不要写成中文括号或加多余空格；' +
        '适度使用，一条回复最多 1-2 个。');
    }
    if (balanceBlock) parts.push(balanceBlock);
    parts.push('【用户说】' + userText);
    return parts.join('\n\n');
  }

  /* ---- v2.1.3 人设指纹：按子对话分别跟踪「该人设已全量发送」状态（LS_PSTATE 见 core/config.js） ----
   * 指纹 = hash(生效人设 + 昵称)；时段是易变信息不进指纹。
   * 编辑人设/昵称变化 → 指纹变 → 下一条自动全量重发；换模型=新子对话=天然首条。 */
  // v2.2.2：人设指纹加入 PROMPT_VER——首轮人设段落（贴纸教学等）改版后，
  // 老子对话也会自动全量重发一次新说明，无需用户手动操作
  const PROMPT_VER = '20261026-stick-archive';
  function hashStr(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) { h = (((h << 5) + h) + s.charCodeAt(i)) >>> 0; }
    return h.toString(36);
  }
  function personaFingerprint() {
    const persona = (settings.persona || '').trim() || DEFAULT_PERSONA;
    return hashStr(persona + '\u0001' + (settings.nickname || '') + '\u0001' + PROMPT_VER);
  }
  function loadPState() { try { return JSON.parse(localStorage.getItem(LS_PSTATE) || '{}') || {}; } catch (e) { return {}; } }
  function savePState(st) { try { localStorage.setItem(LS_PSTATE, JSON.stringify(st)); } catch (e) { /* 容量满等 */ } }
  function markPersonaSent(key, fp) {
    const st = loadPState();
    st[key] = { fp: fp, at: new Date().toISOString().slice(0, 19) };
    savePState(st);
    log('info', '人设已全量发送至 [' + key + ']（fp=' + fp + '）');
  }
  function needPersonaFull(key) {
    const fp = personaFingerprint();
    const st = loadPState();
    return (!st[key] || st[key].fp !== fp) ? fp : null; // 返回非空=需要全量（附带新指纹）
  }

  function extractNickname(text) {
    const m = text.match(/(?:我叫|我是|叫我|喊我)\s*([\u4e00-\u9fa5A-Za-z0-9_·]{1,12})/);
    if (m && m[1] && !/谁|什么|干嘛|哦|吗|吧|了|的/.test(m[1])) { settings.nickname = m[1]; saveSettings(); return m[1]; }
    return null;
  }
  const BAL_RE = /花(了|费|掉|钱)|用了多(少|少钱)|余额|还剩|额度|多少钱|花费|账单|今日花费/;

  async function apiOK() {
    try { const r = await fetch('/api/models', { headers: { 'Accept': 'application/json' } }); return r.ok; }
    catch (e) { return false; }
  }

  /* ---- 通道 A：助手子对话（统一） ---- */
  async function ensureAssistantSession() {
    const sid = localStorage.getItem(CHAT_LS_SID);
    if (sid) {
      try {
        const r = await fetch('/api/sessions/' + sid, { headers: { 'Accept': 'application/json' } });
        if (r.ok) return sid;
      } catch (e) { /* 落到重建 */ }
    }
    const body = {
      title: '桌宠聊天',
      provider: settings.chatProvider || 'company-internal',
      model: settings.chatModel || 'deepseek-flash',
      permission: 'workspace-write',
      tools: [],
    };
    const r = await fetch('/api/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error('创建桌宠子对话失败：HTTP ' + r.status);
    const j = await r.json();
    localStorage.setItem(CHAT_LS_SID, j.id);
    log('info', '已创建统一子对话 ' + j.id + '（' + body.provider + '/' + body.model + '）');
    return j.id;
  }

  /** 读 chat SSE 流：把事件记进后台日志；连接建立（消息已落库）即回调 onSent；返回流是否正常结束 */
  async function readChatStream(sid, content, onSent) {
    const resp = await fetch('/api/sessions/' + sid + '/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    if (resp.status === 409) throw new Error('BUSY');
    if (!resp.ok) throw new Error('聊天请求失败：HTTP ' + resp.status);
    if (typeof onSent === 'function') { try { onSent(); } catch (ce) { /* 回调容错 */ } }
    if (!resp.body) return true;
    const reader = resp.body.getReader();
    const dec = new TextDecoder('utf-8');
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2);
        const line = chunk.split('\n').find(l => l.startsWith('data:'));
        if (!line) continue;
        let ev = null;
        try { ev = JSON.parse(line.slice(5).trim()); } catch (e) { log('sse', '[raw] ' + chunk.slice(0, 400)); continue; }
        const msg = ev.message || {};
        if (msg.role === 'assistant' && msg.content) log('reasoning', '[assistant 增量] ' + msg.content);
        else if (ev.type === 'reasoning' || msg.reasoning_content) log('reasoning', '[思考] ' + (msg.reasoning_content || ev.content || ''));
        else if (ev.type && ev.type !== 'message') log('sse', '[' + ev.type + '] ' + JSON.stringify(ev).slice(0, 600));
        // 流内即时通道错误检测：模型调用失败（429/停用/连不上）事件一出现就中止等待
        if (msg.role === 'system' && typeof msg.content === 'string' && msg.content.startsWith('{')) {
          try {
            const o = JSON.parse(msg.content);
            if (o.error && (o.type === 'call' || o.type === 'error')) {
              try { reader.cancel(); } catch (ce) { /* 忽略 */ }
              const e2 = new Error('MODEL_CHANNEL: ' + o.error);
              e2.channelError = String(o.error);
              throw e2;
            }
          } catch (pe) { if (pe.channelError) throw pe; }
        }
      }
    }
    return true;
  }

  /** 取最后一条 assistant 回复；无回复时检测模型通道错误（429/停用/连接失败等 system 记录） */
  async function lastAssistantText(sid) {
    const r = await fetch('/api/sessions/' + sid + '/messages', { headers: { 'Accept': 'application/json' } });
    if (!r.ok) throw new Error('取回复失败：HTTP ' + r.status);
    const j = await r.json();
    const msgs = (j && j.messages) || [];
    let reply = '';
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m.role === 'assistant' && (m.text || '').trim()) { reply = m.text.trim(); break; }
    }
    if (reply) return reply;
    // 无回复：倒序找最近的模型调用失败记录（type:call/error 带 error 字段即为通道错误）
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m.role !== 'system' || !(m.text || '').startsWith('{')) continue;
      try {
        const o = JSON.parse(m.text);
        if (o.error && (o.type === 'call' || o.type === 'error')) {
          const e = new Error('MODEL_CHANNEL: ' + o.error);
          e.channelError = String(o.error);
          throw e;
        }
      } catch (pe) { if (pe.channelError) throw pe; }
    }
    return '';
  }

  const pollReply = async (sid, tries) => {
    for (let i = 0; i < (tries || 40); i++) {
      await new Promise(res => setTimeout(res, 3000));
      const t = await lastAssistantText(sid); // 通道错误（429/停用）会直接抛出，不再傻等
      if (t) return t;
    }
    return '';
  };

  async function sendViaAssistant(userText, balanceBlock) {
    const sid = await ensureAssistantSession();
    // v2.1.3：按子对话跟踪人设——首条（或人设/昵称变化后首条）全量，其余只发短消息
    const fpNeed = needPersonaFull(sid);
    const prompt = buildPrompt(userText, balanceBlock, !!fpNeed);
    try { await readChatStream(sid, prompt, fpNeed ? () => markPersonaSent(sid, fpNeed) : null); }
    catch (e) { if (e.message === 'BUSY') return { text: '咳、正忙着呢！一条一条来啦，笨蛋主人～', via: 'assistant' }; throw e; }
    let reply = '';
    try { reply = await lastAssistantText(sid); } catch (e) { throw e; }
    if (!reply) reply = await pollReply(sid, 30);
    if (!reply) reply = '……（刚才好像走神了，再说一遍？）';
    return { text: reply, via: 'assistant' };
  }

  /* ---- 通道 B：网关令牌（OpenAI 兼容 /chat/completions） ---- */
  async function sendViaGateway(userText, balanceBlock) {
    // v3.1.0：先认令牌——jxai-姓名-设备号 是内部通道身份牌，浏览器也不允许把中文塞进请求头，
    // 拿它打网关只会得到一个看不懂的报错，这里直接说清并指路助手通道。
    const tk = parseGatewayToken(settings.gatewayKey);
    if (tk.kind === 'inner') throw new Error('填的是公司内部通道身份牌，不是网关 API Key（网关只认 sk- 开头的 Key）；聊天请切回「助手子对话」通道');
    if (!settings.gatewayBase || !settings.gatewayKey) throw new Error('网关未配置（baseURL / 令牌）');
    // v2.1.3：网关通道同样按指纹跟踪（固定键 'gw'），首条全量、后续短消息（人设在 mem 历史里）
    const fpNeed = needPersonaFull('gw');
    const prompt = buildPrompt(userText, balanceBlock, !!fpNeed);
    shortMemory.push({ role: 'user', content: prompt });
    while (shortMemory.length > 28) shortMemory.shift(); // 14 轮 = 28 条
    const msgs = [{ role: 'system', content: '你是桌宠「大肥鱼·鲸鲸娘」。永远保持角色，短句回复（≤60字），绝不输出思考过程。' }].concat(shortMemory.slice());
    const r = await fetch(settings.gatewayBase.replace(/\/+$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + settings.gatewayKey },
      body: JSON.stringify({ model: settings.gatewayModel || 'deepseek-chat', messages: msgs, max_tokens: 200, stream: false }),
    });
    if (!r.ok) throw new Error('网关返回 HTTP ' + r.status);
    if (fpNeed) markPersonaSent('gw', fpNeed);
    const j = await r.json();
    const text = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content || '').trim();
    if (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.reasoning_content)
      log('reasoning', '[思考·网关] ' + j.choices[0].message.reasoning_content);
    shortMemory.push({ role: 'assistant', content: text });
    while (shortMemory.length > 28) shortMemory.shift();
    return { text: text || '……（网关没说话）', via: 'gateway' };
  }

  /* ---- 通道 C：模拟模式 ---- */
  function sendViaMock(userText, balanceBlock, balData) {
    let reply;
    const nick = extractNickname(userText);
    const t = userText;
    if (balData && BAL_RE.test(t)) {
      const cr = balData.credits || {};
      const q = balData.companyQuota || {};
      const est = fmtCredits(balData.costCredits || 0);
      let quotaPart;
      if (q.ok) quotaPart = quotaLine(q);
      else if (cr.ok && cr.unlimited) quotaPart = '账户不限额';
      else if (cr.ok) quotaPart = '剩余积分 ' + fmtCredits(cr.remainCredits);
      else quotaPart = Number(settings.quota) > 0 ? '剩余额度 ' + fmtMoney(Number(settings.quota)) : '（额度还没告诉我呢）';
      reply = '哼、自己干的活自己看啦：' + quotaPart + '，今日估算 ' + est + ' 分。别太浪！';
    } else if (/你好|您好|hi|hello|在吗|嗨/i.test(t)) {
      reply = '哼，才不是在等你呢……' + periodGreet() + '呀，有事快说！';
    } else if (nick) {
      reply = '记住了，' + nick + '……才、才不是想记住呢！';
    } else if (/你是谁|你是什么/.test(t)) {
      reply = '本小姐是大肥鱼·鲸鲸娘！你桌上最忠实的鱼！（模拟模式陪聊中）';
    } else {
      const pool = [
        '唔……这个嘛，本小姐考虑一下再告诉你！',
        '真是的，什么问题都丢给我……不过我会认真想的。',
        '好啦好啦，陪你聊两句，快去忙正事！',
        '（尾巴拍了拍水面）嗯哼？继续说，我听着呢。',
      ];
      reply = pool[Math.floor(Math.random() * pool.length)];
    }
    shortMemory.push({ role: 'user', content: userText }, { role: 'assistant', content: reply });
    while (shortMemory.length > 28) shortMemory.shift();
    return Promise.resolve({ text: reply, via: 'mock' });
  }

  /** 统一入口：send(text) → {text, via}；助手不可用自动回落模拟并提示 */
  async function chatSend(userText, opts) {
    const opts2 = opts || {};
    // v2.1.3：昵称提取统一前置（原来只有模拟通道做）——昵称进人设指纹，
    // 必须在 needPersonaFull 判定之前生效，昵称变化才能触发下一类全量重发
    extractNickname(userText);
    let balData = null, balanceBlock = null;
    if (BAL_RE.test(userText) || opts2.withBalance) {
      balData = await todaySpend(true);
      const cr = balData.credits || {};
      const q = balData.companyQuota || {};
      const est = fmtCredits(balData.costCredits || 0);
      let quotaPart;
      if (q.ok) quotaPart = quotaLine(q) + '（助手给出的内部通道额度）';
      else if (cr.ok && cr.unlimited) quotaPart = '网关账户不限额';
      else if (cr.ok) quotaPart = '剩余积分 ' + fmtCredits(cr.remainCredits) + '（网关实时，累计已用 ' + fmtCredits(cr.usedCredits) + ' 分）';
      else quotaPart = Number(settings.quota) > 0 ? '自填剩余额度 ' + fmtMoney(Number(settings.quota)) : '额度未知（助手额度接口不可用，可在聊天设置里自填）';
      balanceBlock = '【余额数据·系统注入，积分制：1000 分 = 1 元】' +
        (balData.realOk ? '今日已用 ' + fmtCredits(balData.realToday || 0) + ' 分（来自额度接口的真实计价' + (balData.realSince ? '，自 ' + balData.realSince + ' 起统计' : '') + '）；' : '') +
        '今日(' + balData.date + ')新建 ' + balData.sessions +
        ' 个会话，估算消耗 ' + est + ' 分（输入 ' + balData.prompt + ' tok（其中缓存命中 ' + (balData.cacheHit || 0) + '）、输出 ' + balData.output +
        ' tok、' + balData.calls + ' 次调用，按' + (balData.valley ? '谷' : '峰') + '时价估算' +
        (balData.staleSessions ? '；另有 ' + balData.staleSessions + ' 个跨天会话的累计用量无法拆到今日，未计入' : '') +
        '）；' + quotaPart + '。回复用户时请直接用「分」作单位，不要解释算法。';
    }
    const channel = settings.channel || 'assistant';
    if (channel === 'gateway') {
      try { return await sendViaGateway(userText, balanceBlock); }
      catch (e) {
        log('error', '网关通道失败: ' + e.message);
        const r = await sendViaMock(userText, balanceBlock, balData);
        // v3.1.0：不再静默回落——网关失败原因摆在回复开头（与助手通道口径一致）
        return { text: '（网关通道走不通：' + e.message + '，先用模拟模式陪你～）' + r.text, via: 'mock-fallback' };
      }
    }
    if (channel === 'mock') return sendViaMock(userText, balanceBlock, balData);
    // assistant：先探活
    if (!(await apiOK())) {
      log('error', '助手 API 不可达，回落模拟模式');
      const r = await sendViaMock(userText, balanceBlock, balData);
      return { text: '（助手不在线，本小姐亲自上！）' + r.text, via: 'mock-fallback' };
    }
    try {
      return await sendViaAssistant(userText, balanceBlock);
    } catch (e) {
      log('error', '助手通道失败: ' + e.message);
      const r = await sendViaMock(userText, balanceBlock, balData);
      // 模型通道级错误（429 余额不足 / 渠道停用 / 连接失败）给明确原因，不装傻
      if (e.channelError || /MODEL_CHANNEL/.test(e.message)) {
        const raw = String(e.channelError || '');
        let why = raw.split(/[：:]/)[0].slice(0, 26) || '模型通道不可用';
        if (/429|余额不足/.test(raw)) why = '模型通道余额不足';
        return { text: '（' + why + '，先用模拟模式陪你～去聊天设置里换个模型或通道吧）' + r.text, via: 'mock-fallback' };
      }
      return { text: '（助手闹脾气了，我来说～）' + r.text, via: 'mock-fallback' };
    }
  }
  /* pb:core:end */

  const SPRITE = { W: 1536, H: 2288, COLS: 8, ROWS: 11, CW: 192, CH: 208 };
  // v2.2.0：「哦鲸鲸」头顶气泡是官方形象的一部分（实际约占格子 60%×30%），贴纸/桌宠均不再 clip
  // 官方 shared/motion.js 权威帧时长（毫秒）
  const STATES = {
    idle:          { row: 0, durations: [280, 110, 110, 140, 140, 320] },
    'running-right': { row: 1, durations: [100, 100, 100, 100, 100, 100, 100, 100] },
    'running-left':  { row: 2, durations: [100, 100, 100, 100, 100, 100, 100, 100] },
    waving:        { row: 3, durations: [160, 160, 160, 160] },
    jumping:       { row: 4, durations: [140, 140, 140, 140, 140] },
    failed:        { row: 5, durations: [160, 160, 160, 160, 160, 160, 160, 160] },
    waiting:       { row: 6, durations: [180, 180, 180, 180, 180, 180] },
    running:       { row: 7, durations: [160, 160, 160, 160, 160, 160] },
    review:        { row: 8, durations: [160, 160, 160, 160, 160, 160] },
  };

  /** 官方 petFrame 同款算法：返回 {row, col} */
  function frameOf(stateName, elapsedMs) {
    const st = STATES[stateName] || STATES.idle;
    const cycle = st.durations.reduce((a, b) => a + b, 0);
    let rem = Math.max(0, elapsedMs) % cycle;
    let col = 0;
    while (col < st.durations.length - 1 && rem >= st.durations[col]) rem -= st.durations[col++];
    return { row: st.row, col };
  }

  /* ================= UI：根节点 ================= */
  const root = $new('div', 'pb2-root');
  document.body.appendChild(root);
  const petWrap = $new('div', 'pb2-pet-wrap pb2-skin-fish');
  const viewport = $new('div', 'pb2-viewport');
  const sprite = $new('div', 'pb2-sprite');
  viewport.appendChild(sprite);
  const imgSkin = $new('img', 'pb2-img-skin');
  imgSkin.alt = '桌宠';
  // BongoCat 式监控图层：双爪 + 键帽（鼠标/键盘联动，皮肤开启监控时显示）
  const paws = $new('div', 'pb2-paws');
  const PAW_SVG = '<svg viewBox="0 0 30 26"><ellipse cx="15" cy="15" rx="13" ry="10.5" fill="#fdfdff" stroke="#c3cdea" stroke-width="1.6"/><ellipse cx="6.5" cy="7.5" rx="3.2" ry="4" fill="#f3c9d8"/><ellipse cx="15" cy="5.5" rx="3.2" ry="4" fill="#f3c9d8"/><ellipse cx="23.5" cy="7.5" rx="3.2" ry="4" fill="#f3c9d8"/></svg>';
  const pawL = $new('div', 'pb2-paw pb2-paw-l');
  const pawR = $new('div', 'pb2-paw pb2-paw-r');
  pawL.innerHTML = PAW_SVG; pawR.innerHTML = PAW_SVG; // 内置装饰 SVG，非动态内容
  const keycap = $new('div', 'pb2-keycap');
  paws.appendChild(pawL); paws.appendChild(pawR); paws.appendChild(keycap);
  petWrap.appendChild(viewport); petWrap.appendChild(imgSkin); petWrap.appendChild(paws);
  const bubble = $new('div', 'pb2-bubble');
  bubble.hidden = true;
  const restoreDot = $new('div', 'pb2-restore-dot', '🐟');
  restoreDot.title = '点我唤回大肥鱼';
  const menu = $new('div', 'pb2-menu');
  menu.hidden = true;
  root.appendChild(petWrap); root.appendChild(bubble); root.appendChild(menu); root.appendChild(restoreDot);

  /* ================= 桌宠动画与交互 ================= */
  let skinMode = 'fish'; // fish | img
  let petState = 'idle', stateStart = performance.now(), transient = null, transientUntil = 0;
  let lastPaint = '';
  /* v3.3.2：素材基准**靠实测探测**（不再靠推导）——桌面版把 CSS 内联注入页面，
     相对 URL 会以页面为基准；而宿主又会重写 CSS 里它"已知"的素材路径，
     结果官方图能显示、新加的社区图 404。所以启动时拿 icon.png 逐个候选试加载，
     第一个真能加载的才算数；探测完成后按最终前缀重画一次皮肤。 */
  const assetProbe = { ok: false, base: '', how: '', tried: [] };
  const SKIN_WARNED = {};   // 同一会话里每种皮肤只提示一次，避免反复弹同样的提示
  // v3.3.3：旧的女仆皮肤已下线（素材自带桌子与手，叠浮空爪图层很违和）——老设置自动切到 BongoCat
  if (settings.skin === 'maid') { settings.skin = 'bongo'; saveSettings(); }

  /** 皮肤图可用性预检：失败不改用户设置、只临时穿回官方形象并说明一次 */
  function verifySkinImage(skin, done) {
    const item = SPRITE_SKINS[skin];
    if (!item) { done(true, ''); return; }
    let finished = false;
    const im = new Image();
    const timer = setTimeout(() => { if (!finished) { finished = true; done(false, '加载超时'); } }, 5000);
    im.onload = () => { if (finished) return; finished = true; clearTimeout(timer); done(true, im.naturalWidth + 'x' + im.naturalHeight); };
    im.onerror = () => { if (finished) return; finished = true; clearTimeout(timer); done(false, '读不到 ' + assetUrl(item.file)); };
    im.src = assetUrl(item.file);
  }

  function applySkin() {
    const s = settings.skin || 'fish';
    const sp = SPRITE_SKINS[s];   // v3.3：精灵图皮肤（内置官方 / 社区桌宠包，同一套网格规格）
    petWrap.classList.remove('pb2-skin-fish', 'pb2-skin-img', 'pb2-skin-codex', 'pb2-skin-anim');
    if (sp) {
      skinMode = 'fish';
      petWrap.classList.add(sp.cls);        // CSS 类仍然保留（宿主重写过的官方路径靠它兜底）
      // 网格变量交给 CSS（同规格图集值相同；将来支持不同 cell 的图集只改这里）
      root.style.setProperty('--pb2-sheet-w', SPRITE_GRID.W + 'px');
      root.style.setProperty('--pb2-sheet-h', SPRITE_GRID.H + 'px');
      // 探测到可用基准后，直接用实测前缀指定图（CSS 那条路在桌面版里对新素材不生效）
      if (assetProbe.ok) { try { sprite.style.backgroundImage = 'url("' + spriteSkinUrl(s) + '")'; } catch (e) { /* 保留 CSS 兜底 */ } }
      else { sprite.style.backgroundImage = ''; }
      lastPaint = ''; // 强制下一帧重画
      // 基准还没探测出来时先不判失败（否则会误报"图没加载出来"）
      if (!assetProbe.ok) { applyMonitor(); return; }
      verifySkinImage(s, (ok, info) => {
        if (ok || SKIN_WARNED[s]) return;
        SKIN_WARNED[s] = true;
        log('error', '皮肤图加载失败（' + s + '）：' + info);
        try { sprite.style.backgroundImage = 'url("' + spriteSkinUrl('fish') + '")'; } catch (e) { petWrap.classList.add(SPRITE_SKINS.fish.cls); }
        bubbleSay('这套衣服的图没读出来，先临时穿回原来的～（设置不动，下次再试）', 5600);
      });
    } else {
      skinMode = 'img';
      petWrap.classList.add('pb2-skin-img');
      const im = IMAGE_SKINS[s];     // v3.3.3：内置静态皮肤（BongoCat / 和大人 / RYANFFY）
      petWrap.classList.toggle('pb2-skin-anim', !!(im && im.anim));   // 动画 WebP 不再叠呼吸动画
      let url = '';
      if (im) url = assetUrl(im.file);
      else {
        const c = (settings.customSkins || []).find(x => x.id === s);
        if (c) url = c.dataUrl;
      }
      imgSkin.src = url || assetUrl(IMAGE_SKINS.bongo.file);
      // v3.6.1：图加载完之后要重算 wrap 尺寸（切换皮肤时那会儿还拿不到新图尺寸）
      imgSkin.onload = () => { if (skinMode === 'img') { lastPaint = ''; refreshLayout(); } };
      // 静态图兜底：读不到就临时显示官方形象并说明一次（同样不动用户设置）
      imgSkin.onerror = () => {
        if (SKIN_WARNED[s]) return;
        SKIN_WARNED[s] = true;
        log('error', '静态皮肤图加载失败：' + imgSkin.src);
        petWrap.classList.remove('pb2-skin-img');
        petWrap.classList.add(SPRITE_SKINS.fish.cls);
        skinMode = 'fish'; lastPaint = '';
        bubbleSay('这张图没读出来，先临时穿回原来的～（设置不动，下次再试）', 5200);
      };
    }
    applyMonitor();
  }
  applySkin();
  probeAssetBase((base, how, tried) => {
    assetProbe.ok = !!base; assetProbe.base = base; assetProbe.how = how; assetProbe.tried = tried;
    if (base) applyAssetBase(base);
    log(base ? 'info' : 'error', '素材基准 = ' + (base || '(未探测到，用回退 ' + ASSET_DIR + ')') +
      ' ｜ 候选试过 ' + tried.length + ' 个：' + tried.join(' , '));
    applySkin();   // 用最终前缀重画皮肤与贴纸
  });

  function paintFrame() {
    if (skinMode !== 'fish') return;
    const action = transient && performance.now() < transientUntil ? transient : 'idle';
    if (action !== petState) { petState = action; stateStart = performance.now(); }
    const f = frameOf(action, performance.now() - stateStart);
    const key = f.row + ':' + f.col;
    if (key !== lastPaint) {
      // 整图平移到目标格：纯 GPU 合成（transform），不触发重绘 → 动作切换不闪烁
      const s = (settings.size || 96) / SPRITE.CW;
      sprite.style.transform = 'scale(' + s + ') translate3d(' + (-SPRITE.CW * f.col) + 'px,' + (-SPRITE.CH * f.row) + 'px,0)';
      lastPaint = key;
    }
  }
  (function loop() { paintFrame(); requestAnimationFrame(loop); })();

  // 偶尔挥手/跳跃
  function scheduleIdleFun() {
    setTimeout(() => {
      if (!settings.hidden && !drag && (!transient || performance.now() >= transientUntil)) {
        transient = Math.random() < 0.5 ? 'waving' : 'jumping';
        transientUntil = performance.now() + 1500;
      }
      scheduleIdleFun();
    }, 18000 + Math.random() * 22000);
  }
  scheduleIdleFun();

  /* ---- 位置：默认右下角，吸附 + 记忆 ---- */
  /** v3.6.1：静态图皮肤按图片自身比例定 wrap 尺寸（否则横图/竖图与交互区对不上，看着"位置偏了"） */
  function petAspect() {
    if (skinMode === 'img') {
      const nw = imgSkin && imgSkin.naturalWidth ? imgSkin.naturalWidth : 0;
      const nh = imgSkin && imgSkin.naturalHeight ? imgSkin.naturalHeight : 0;
      if (nw && nh) return clamp(nh / nw, 0.45, 2.2);
    }
    return SPRITE.CH / SPRITE.CW;   // 精灵图 192×208
  }
  function petSize() {
    const w = settings.size || 96;
    return { w: w, h: Math.round(w * petAspect()) };
  }
  function placeDefault() {
    const s = petSize();
    return { left: window.innerWidth - s.w - 18, bottom: 14 };
  }
  function applyPos(pos) {
    const s = petSize();
    petWrap.style.width = s.w + 'px';
    petWrap.style.height = s.h + 'px';
    const left = clamp(pos.left, 4, Math.max(4, window.innerWidth - s.w - 4));
    const bottom = clamp(pos.bottom, 4, Math.max(4, window.innerHeight - s.h - 4));
    petWrap.style.left = left + 'px';
    petWrap.style.bottom = bottom + 'px';
  }
  function refreshLayout() {
    applyPos(settings.pos || placeDefault());
    lastPaint = ''; // 尺寸变化 → 下一帧按新 scale 重画
  }
  refreshLayout();
  window.addEventListener('resize', refreshLayout);

  /* ---- 气泡 ---- */
  function showBubble(textNodeBuilder, ms, inputMode) {
    bubble.textContent = '';
    bubble.classList.toggle('pb2-bubble-input', !!inputMode);
    textNodeBuilder(bubble);
    bubble.hidden = false;
    const s = petSize();
    const wrapLeft = parseFloat(petWrap.style.left) || 0;
    const wrapBottom = parseFloat(petWrap.style.bottom) || 0;
    bubble.style.left = clamp(wrapLeft - 40, 8, Math.max(8, window.innerWidth - 270)) + 'px';
    bubble.style.bottom = (wrapBottom + s.h + 10) + 'px';
    bubble.style.setProperty('--pb2-tail', clamp(wrapLeft + s.w * 0.42 - parseFloat(bubble.style.left), 14, 220) + 'px');
    if (bubbleTimer) clearTimeout(bubbleTimer);
    if (ms) bubbleTimer = setTimeout(() => { bubble.hidden = true; }, ms);
  }
  let bubbleTimer = null;
  function bubbleSay(text, ms) { showBubble(b => { const t = $new('span', 'pb2-bubble-text'); renderRich(t, text); b.appendChild(t); }, ms || 4200); }

  /* ---- 单击 / 双击（260ms 区分） / 拖动 / 长按 / 连戳 ---- */
  let clickTimer = null, pendingSingle = null;
  let drag = null;
  let suppressClickUntil = 0;
  let pokeCount = 0, pokeTimer = null;     // 连戳计数（1.4s 窗口）
  let holdTimer = null;                    // 长按（未拖动）摸头

  petWrap.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    speechUnlock(); // v3.2：点桌宠就是用户手势——顺手解锁音频（之后自动播报才出声）
    sfx('tap');     // v3.3：点桌宠一声「啵」
    const startL = parseFloat(petWrap.style.left) || 0;
    const startB = parseFloat(petWrap.style.bottom) || 0;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, startL, startB, moved: false, downAt: Date.now() };
    try { petWrap.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
    // 长按 ≥650ms 且没拖动 → 摸头反应
    if (holdTimer) clearTimeout(holdTimer);
    holdTimer = setTimeout(() => {
      if (drag && !drag.moved) {
        drag.headPat = true;
        transient = 'waving'; transientUntil = performance.now() + 1500;
        bubbleSay('唔……被摸头了……才、才没有很高兴呢！ [bean:shy]', 3600);
      }
    }, 650);
  });
  petWrap.addEventListener('pointermove', e => {
    if (!drag || drag.id !== e.pointerId) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 6) return; // 拖动判定阈值
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    drag.moved = true;
    petWrap.classList.add('pb2-dragging');
    transient = e.movementX < 0 ? 'running-left' : 'running-right';
    transientUntil = performance.now() + 300;
    applyPos({ left: drag.startL + dx, bottom: drag.startB - dy });
  });
  function endDrag(e) {
    if (!drag || (e.pointerId !== undefined && drag.id !== e.pointerId)) return;
    const wasMoved = drag.moved;
    const wasHeadPat = !!drag.headPat;
    const holdMs = Date.now() - drag.downAt;
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    if (wasMoved) {
      // 左右边缘吸附：距边缘 < 视口 18% 吸到 8px
      let left = parseFloat(petWrap.style.left) || 0;
      const vw = window.innerWidth;
      if (left < vw * 0.18) left = 8;
      else if (left > vw * 0.82 - petSize().w) left = vw - petSize().w - 8;
      settings.pos = { left, bottom: parseFloat(petWrap.style.bottom) || 0 };
      saveSettings();
      petWrap.classList.remove('pb2-dragging');
      applyPos(settings.pos);
      if (left === 8 || left === vw - petSize().w - 8) sfx('drop'); // v3.3：吸附到边缘给一声「唰」
      transient = 'waving'; transientUntil = performance.now() + 1200;
    }
    suppressClickUntil = wasMoved ? Date.now() + 200 : 0;
    const d = drag; drag = null;
    petWrap.classList.remove('pb2-dragging');
    if (wasMoved) return;
    if (wasHeadPat) return; // 摸头已经给过反应，不再走点击
    if (holdMs < 700 && e.type === 'pointerup') handleClickCandidate();
  }
  petWrap.addEventListener('pointerup', endDrag);
  petWrap.addEventListener('pointercancel', endDrag);

  /** 戳一下的即时动作反馈（不等待 260ms 判定，手感即时） */
  function pokeReaction() {
    const pool = ['waving', 'jumping', 'waving', 'jumping', 'waiting'];
    transient = pool[Math.floor(Math.random() * pool.length)];
    transientUntil = performance.now() + 1400;
  }

  function handleClickCandidate() {
    if (Date.now() < suppressClickUntil) return;
    pokeReaction(); // 即时动作：无论单击还是双击先给反馈
    // 连戳计数（1.4s 窗口内累计）
    pokeCount++;
    if (pokeTimer) clearTimeout(pokeTimer);
    pokeTimer = setTimeout(() => { pokeCount = 0; }, 1400);
    if (pokeCount === 3) { bubbleSay('戳戳戳……戳的这么开心，是要发芽吗！ [bean:angry]', 3200); }
    if (pokeCount === 5) { transient = 'failed'; transientUntil = performance.now() + 2000; bubbleSay('爆鱼预警！再戳本小姐就掀桌了！ [fish:hum]', 3200); }
    if (pokeCount >= 8) { pokeCount = 0; transient = 'waiting'; transientUntil = performance.now() + 2600; bubbleSay('（装死中）…… fish 已离线 [bean:sleep]', 3200); }
    // 260ms 等待可能的第二次点击（双击）
    if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; onPetDoubleClick(); return; }
    clickTimer = setTimeout(() => { clickTimer = null; onPetSingleClick(); }, 260);
  }

  /* ---- 单击：余额气泡 ---- */
  /** v3.1.0 统一余额文案（积分制，1000 分 = 1 元）：三级来源
   *  ① 助手接口的内部通道额度（companyQuota，真实、无需令牌）→ 首选；
   *  ② sk- 网关 Key 的账单（订阅额度 − 累计用量，OpenAI 兼容 billing）；
   *  ③ 用户在聊天设置里自填的额度。
   *  今日消耗给两个口径：额度接口按天增量（真实，口径是今天打开插件起）＋ token 估算（标注估算）。 */
  function balanceLine(d) {
    const c = d.credits || {};
    const q = d.companyQuota || {};
    const detail = (d.valley ? '谷' : '峰') + '价·入 ' + fmtTok(d.prompt) + ' tok（命中 ' + fmtTok(d.cacheHit) + '）·出 ' + fmtTok(d.output) + '·' + d.calls + ' 次';
    const stale = d.staleSessions ? '；' + d.staleSessions + ' 个跨天会话未计入' : '';
    const est = '估算 ' + fmtCredits(d.costCredits || 0) + ' 分（' + d.sessions + ' 个新会话·' + detail + stale + '）';
    const real = d.realOk ? '今日 +' + fmtCredits(d.realToday || 0) + ' 分' + (d.realSince ? '（' + d.realSince + ' 起）' : '') : '';
    const today = real ? real + '·' + est : est;
    if (q.ok) return quotaLine(q) + ' ｜ ' + today;
    if (c.ok && c.unlimited) return '账户不限额 ｜ ' + today;
    if (c.ok) return '剩余积分 ' + fmtCredits(c.remainCredits) + ' ｜ ' + today;
    if (Number(settings.quota) > 0) return '自填额度 ' + fmtMoney(Number(settings.quota)) + ' ｜ ' + today;
    return today;
  }
  function onPetSingleClick() {
    const greet = periodGreet();
    const nick = settings.nickname ? '，' + settings.nickname : '';
    showBubble(b => {
      const main = $new('span', 'pb2-bubble-text', '戳什么戳！' + greet + nick + '，算账给你看……');
      const cost = $new('span', 'pb2-bubble-cost', '余额算术进行中…');
      b.appendChild(main); b.appendChild(cost);
      todaySpend(true).then(d => {
        if (!d.apiOk) { cost.textContent = '（助手不在线，算不了账啦）'; return; }
        cost.textContent = balanceLine(d);
      });
    }, 8000);
  }

  /* ---- 双击：就地输入框 ---- */
  function onPetDoubleClick() {
    showBubble(b => {
      const input = $new('input', 'pb2-bubble-in');
      input.type = 'text'; input.maxLength = 500;
      input.placeholder = '跟大肥鱼说点什么…';
      const row = $new('div', 'pb2-bubble-send');
      const send = $new('button', null, '发送');
      const cancel = $new('button', null, '取消');
      row.appendChild(cancel); row.appendChild(send);
      b.appendChild(input); b.appendChild(row);
      setTimeout(() => input.focus(), 30);
      const doSend = () => {
        const text = input.value.trim();
        if (!text) return;
        speechUnlock(); // 用户手势里解锁音频：之后桌宠的自动播报才出得了声
        bubbleSay('……让本小姐想想', 20000);
        chatSend(text).then(r => {
          bubbleSay(r.text, Math.max(6000, Math.min(20000, r.text.length * 260)));
          speakReply(r.text); // v3.2：问答闲聊互动 → 桌宠开口说话
        }).catch(err => { sfx('err'); bubbleSay('出错了：' + err.message, 5000); });
      };
      send.addEventListener('click', doSend);
      cancel.addEventListener('click', () => { bubble.hidden = true; });
      input.addEventListener('keydown', ev => {
        if (ev.key === 'Enter') { ev.preventDefault(); doSend(); }
        if (ev.key === 'Escape') bubble.hidden = true;
      });
    }, 0, true);
  }

  /* ================= 语音（v3.2）：回复播报 + 语音闲聊听写 =================
     · 回复播报：聊天回复念出来（本地离线合成，声线/音量/语速/字数上限都在设置里）
     · 语音闲聊：按住「右 Alt + M」说话，松开就发；也可点右键菜单「语音闲聊」，
       说完静音 2 秒自动收尾（不用摸键盘）
     · 左 Alt 是助手自带的语音听写（设置 → 语音），本插件不碰、不抢
     · 浏览器自动播放策略：没有用户手势时不会出声——所以点桌宠/开菜单/发消息
       这些手势里顺手解锁一次；真被挡住也只是安静不响，不弹窗不报错 */
  function speakReply(text, opts) {
    return speak(text, Object.assign({
      onStart: () => { transient = 'waving'; transientUntil = performance.now() + 1500; },
    }, opts || {}));
  }

  /** 听写结果 → 当闲聊发出去（先回显「你说：…」，用户能核对识别得对不对） */
  function sendVoiceChat(text) {
    bubbleSay('你说：' + text, 3200);
    transient = 'review'; transientUntil = performance.now() + 1400;
    chatSend(text).then(r => {
      bubbleSay(r.text, Math.max(6000, Math.min(20000, r.text.length * 260)));
      speakReply(r.text);
    }).catch(err => { sfx('err'); bubbleSay('出错了：' + err.message, 5000); });
  }

  /** 菜单点「语音闲聊」：不摸键盘也能说一轮（静音 2 秒自动收尾并发送） */
  function voiceChatByButton() {
    if (viPhase() !== 'idle') { bubbleSay('还在处理上一句呢，等一下下…', 2600); return; }
    speechUnlock(); // 点了菜单 = 用户手势
    viStart().then(r => { if (!r.ok) bubbleSay('语音这边不行：' + r.reason, 6000); });
  }

  viOn((phase, info) => {   // 状态 → 气泡与动作
    if (phase === 'recording') {
      sfx('pop'); // 开始收音：一声「叮」，让用户知道在听了
      transient = 'waiting'; transientUntil = performance.now() + 60000;
      bubbleSay('（在听……说完松开 ' + VI_HOTKEY_LABEL + '）', 0);
      return;
    }
    if (phase === 'recognizing') {
      transient = 'review'; transientUntil = performance.now() + 20000;
      bubbleSay('（听懂了，让本小姐想想……）', 0);
      return;
    }
    if (phase === 'error') {
      transient = 'failed'; transientUntil = performance.now() + 1500;
      bubbleSay('语音这边有点问题：' + (info && info.err ? info.err : '未知原因'), 6500);
      return;
    }
    if (phase === 'idle' && info && info.cancelled) bubbleSay('（不说了？那本小姐继续躺着）', 3000);
  });

  viOnResult(r => {         // 一轮听写的结论：松开热键 / 静音自动收尾 / 菜单触发都走这里
    if (r.ok) { sfx('ok'); sendVoiceChat(r.text); }
    else if (r.message) { sfx('err'); bubbleSay(r.message, 5200); }
  });

  viWatchHotkey({           // 按住 右 Alt+M 说话（按下是用户手势，顺手解锁音频）
    onStart: () => { if (viPhase() !== 'idle') return; speechUnlock(); viStart().catch(() => {}); },
    onStop: () => { viStop().catch(() => {}); },
    onCancel: () => bubbleSay('（松开太快，这次不算）', 2600),
  });

  /* ================= BongoCat 式鼠标 / 键盘监控 =================
     女仆 / 自定义皮肤开启监控后：
     · 鼠标在页面内移动 → 双爪整体转向鼠标方向
     · 按下鼠标左/右键 → 对应爪子按下
     · 敲键盘（非输入框时）→ 头顶弹出键帽徽章 + 爪子按下弹跳
     说明：浏览器安全模型限制，键盘/鼠标监听只在助手页面聚焦时生效。 */
  function applyMonitor() {
    const on = settings.monitor !== false && skinMode === 'img' && currentPawEnabled();
    petWrap.classList.toggle('pb2-monitor-on', on);
  }
  /** 浮空爪图层要不要叠（v3.3.3）：素材自带爪子/桌面的内置皮肤不叠，只保留它自己的互动 */
  function currentPawEnabled() {
    const s = settings.skin || 'fish';
    const im = IMAGE_SKINS[s];
    if (im) return im.paw !== false;      // 内置静态皮肤自己声明（BongoCat = 不叠）
    if (SPRITE_SKINS[s]) return false;    // 精灵图皮肤不用爪图层
    return true;                          // 用户上传的图：默认叠（适合没有手的角色图）
  }
  /** BongoCat 皮肤专属互动：键鼠一动就切到「爪子按下帧」，110ms 后切回 */
  let pawFrameTimer = null, pawPulseAt = 0;
  function pawFramePulse() {
    const im = IMAGE_SKINS[settings.skin || ''];
    if (!im || !im.fileDown || skinMode !== 'img') return false;
    const now = performance.now();
    if (now - pawPulseAt < 140) return true;   // 节流：别把图切成高频闪烁
    pawPulseAt = now;
    imgSkin.src = assetUrl(im.fileDown);
    if (pawFrameTimer) clearTimeout(pawFrameTimer);
    pawFrameTimer = setTimeout(() => { if (skinMode === 'img') imgSkin.src = assetUrl(im.file); }, 110);
    return true;
  }
  function keyLabel(e) {
    const k = e.key;
    if (k === ' ') return 'Space';
    if (k === 'Enter') return '⏎';
    if (k === 'Escape') return 'Esc';
    if (k === 'Backspace') return '⌫';
    if (k === 'ArrowUp') return '↑';
    if (k === 'ArrowDown') return '↓';
    if (k === 'ArrowLeft') return '←';
    if (k === 'ArrowRight') return '→';
    if (k.length === 1) return k.toUpperCase();
    return k.slice(0, 7);
  }
  let keycapTimer = null;
  function monitorInteractive() {
    return settings.monitor !== false && skinMode === 'img' && !settings.hidden;
  }
  document.addEventListener('pointermove', e => {
    if (!monitorInteractive()) { paws.style.transform = 'rotate(0deg)'; return; }
    pawFramePulse();                       // BongoCat 皮肤：鼠标一动爪子亮一下
    const r = petWrap.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height * 0.55;
    const dx = e.clientX - cx, dy = e.clientY - cy;
    if (Math.hypot(dx, dy) < 40) { paws.style.transform = 'rotate(0deg)'; return; }
    const ang = Math.atan2(dy, dx) * 180 / Math.PI; // -180..180，0=右
    const clamped = clamp(ang > 90 || ang < -90 ? (ang > 0 ? 90 : -90) : ang, -26, 26);
    paws.style.transform = 'rotate(' + (clamped * 0.35).toFixed(1) + 'deg)';
  }, { passive: true });
  document.addEventListener('mousedown', e => {
    if (!monitorInteractive()) return;
    pawFramePulse();
    if (e.button === 0) pawL.classList.add('pb2-down');
    if (e.button === 2) pawR.classList.add('pb2-down');
  }, true);
  document.addEventListener('mouseup', () => {
    pawL.classList.remove('pb2-down'); pawR.classList.remove('pb2-down');
  }, true);
  document.addEventListener('keydown', e => {
    if (!monitorInteractive()) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return; // 打字不弹
    pawFramePulse();                       // BongoCat 皮肤：敲键盘爪子亮一下
    keycap.textContent = keyLabel(e);
    keycap.classList.remove('pb2-show');
    void keycap.offsetWidth; // 重启动画
    keycap.classList.add('pb2-show');
    if (e.key === ' ' || e.key === 'Enter') { pawL.classList.add('pb2-down'); pawR.classList.add('pb2-down'); }
    else if (e.key.length === 1) pawL.classList.add('pb2-down');
    else pawR.classList.add('pb2-down');
    if (keycapTimer) clearTimeout(keycapTimer);
    keycapTimer = setTimeout(() => {
      keycap.classList.remove('pb2-show');
      pawL.classList.remove('pb2-down'); pawR.classList.remove('pb2-down');
    }, 650);
  });

  /* ---- 右键菜单（v3.6：分栏整理 —— 聊天 / bibo语音 / bibo音效 / 桌宠 / 设置） ---- */
  const MENU_ITEMS = [
    { icon: 'chat', label: '气泡聊天', act: openChatPanel },
    { icon: 'speaker', label: 'bibo语音', sub: [
      { icon: 'speaker', label: '试听语音', act: () => { speechUnlock(); speechProbe('哼哼，本小姐的声音，好听吧？'); } },
      { icon: 'mic', label: '语音闲聊（按住 ' + VI_HOTKEY_LABEL + '）', act: () => voiceChatByButton() },
      { icon: 'book', label: '常用语…', act: openPhraseBook },
      { sep: true },
      { icon: 'talk', label: () => '朗读模式：' + speechStyleLabel(), act: () => cycleSpeechStyle(), keepOpen: true },
      { icon: 'palette', label: () => 'bibo音色：' + speechVoiceLabel(), act: () => cycleSpeechVoice(), keepOpen: true },
      { icon: 'mic', label: () => '朗读音色：' + ttsVoiceLabel(), act: () => cycleTtsVoice(), keepOpen: true },
      { icon: 'speed', label: () => '朗读速度：' + speechSpeedLabel(), act: () => cycleSpeechSpeed(), keepOpen: true },
    ] },
    { icon: 'bell', label: 'bibo音效', sub: [
      { icon: 'bell', label: () => '音效：' + (settings.sfxOn !== false ? '开' : '关'), act: () => toggleSfx(), keepOpen: true },
      { icon: 'speed', label: () => '音效音量：' + Math.round(sfxVolume() * 100) + '%', act: () => cycleSfxVolume(), keepOpen: true },
      { icon: 'speaker', label: '试听音效', act: () => { speechUnlock(); ['tap', 'pop', 'drop', 'ok', 'err'].forEach((n, i) => setTimeout(() => sfx(n, { force: true }), i * 320)); } },
    ] },
    { icon: 'mask', label: '桌宠', sub: [
      { icon: 'mask', label: '修改模型…', act: openModelPicker },
      { icon: 'note', label: '角色设定…', act: openPersonaEditor },
      { icon: 'pin', label: '位置重置', act: () => { settings.pos = null; saveSettings(); refreshLayout(); bubbleSay('回到窝啦～', 2200); } },
      { icon: 'eyeoff', label: '隐藏桌宠', act: () => { settings.hidden = true; saveSettings(); applyHidden(); } },
    ] },
    { icon: 'gear', label: '设置', sub: [
      { icon: 'gear', label: '聊天设置…', act: openChatSettings },
      { icon: 'speaker', label: '声音设置…', act: openChatSettings },
      { icon: 'brain', label: '查看思考过程', act: openLogViewer },
    ] },
  ];
  /** 菜单图标：'ic-xxx' 这样的名字走自绘 PNG；其他字符串当 emoji 用（兼容扩展项） */
  function menuIcon(host, spec) {
    if (spec && /^[a-z0-9-]+$/.test(spec)) {
      const im = document.createElement('img');
      im.className = 'pb2-mico';
      im.alt = '';
      im.src = assetUrl('ic-' + spec + '.png');
      im.onerror = () => { im.replaceWith($new('span', null, '·')); };   // 图标缺了就退成小点，不塌版
      host.appendChild(im);
    } else if (spec) {
      host.appendChild($new('span', null, spec));
    } else {
      host.appendChild($new('span', null, ''));
    }
  }
  /* v3.5 朗读三件套：菜单里点一下循环切换，当前值直接写在菜单文字上（子菜单不关，就地刷新） */
  /* v3.7 朗读音色（= 宿主 TTS 的音色，跟 bibo 声线是两回事）
   * 列表来自 GET /api/voice/voices（实测可用，返回 name/display/gender）；取不到就用内置兜底。 */
  const TTS_FALLBACK_VOICES = [
    { name: 'zh-CN-XiaoxiaoNeural', display: '晓晓（女）' },
    { name: 'zh-CN-XiaoyiNeural', display: '晓伊（女）' },
    { name: 'zh-CN-YunxiNeural', display: '云希（男）' },
    { name: 'zh-CN-YunjianNeural', display: '云健（男）' },
    { name: 'zh-CN-YunyangNeural', display: '云扬（男）' },
  ];
  let TTS_VOICES = { at: 0, list: [] };
  async function fetchTtsVoices(force) {
    if (!force && TTS_VOICES.list.length && Date.now() - TTS_VOICES.at < 600000) return TTS_VOICES.list;
    try {
      const r = await fetch('/api/voice/voices', { headers: { Accept: 'application/json' } });
      if (r.ok) {
        const j = await r.json();
        const list = (j && j.voices ? j.voices : [])
          .filter(v => v && v.name)
          .map(v => ({ name: v.name, display: v.display || v.name, gender: v.gender || '' }));
        if (list.length) { TTS_VOICES = { at: Date.now(), list: list }; return list; }
      }
    } catch (e) { log('info', '朗读音色列表取不到：' + e.message); }
    return TTS_VOICES.list;
  }
  function ttsVoiceList() { return TTS_VOICES.list.length ? TTS_VOICES.list : TTS_FALLBACK_VOICES; }
  function ttsVoiceLabel() {
    const v = String(settings.ttsVoice || '');
    if (!v) return '宿主默认';
    const f = ttsVoiceList().find(x => x.name === v);
    return f ? f.display : v;
  }
  function cycleTtsVoice() {
    const keys = [''].concat(ttsVoiceList().map(x => x.name));
    const i = Math.max(0, keys.indexOf(String(settings.ttsVoice || '')));
    settings.ttsVoice = keys[(i + 1) % keys.length];
    saveSettings(); ttsCache.clear(); trackCache.clear();
    bubbleSay('朗读音色：' + ttsVoiceLabel(), 2600);
    sfx('tap');
    if (speechMode() === 'tts') speechProbe('这是' + ttsVoiceLabel() + '的声音，听着如何？');
  }

  /* v3.6 朗读三档：语调引导 / 经典合成 / 普通朗读（真人声） */
  const SPEECH_MODES = [
    { id: 'guided', label: '语调引导' },
    { id: 'classic', label: '经典合成' },
    { id: 'tts', label: '普通朗读' },
  ];
  const SPEECH_SPEEDS = [
    { label: '慢', step: 0.18 },
    { label: '正常', step: 0.13 },
    { label: '快', step: 0.10 },
    { label: '很快', step: 0.08 },
  ];
  function speechStyleLabel() {
    const m = SPEECH_MODES.find(x => x.id === speechMode());
    return m ? m.label : '语调引导';
  }
  function speechVoiceLabel() { return SPEECH_VOICE_NAMES[settings.speechVoice || 'fish'] || '大肥鱼（高）'; }
  function nearestSpeed(step) {
    const v = clamp(Number(step) || 0.13, 0.04, 0.4);
    let best = SPEECH_SPEEDS[1], bestD = Infinity, idx = 1;
    SPEECH_SPEEDS.forEach((s, i) => { const d = Math.abs(s.step - v); if (d < bestD) { bestD = d; best = s; idx = i; } });
    return { item: best, index: idx };
  }
  function speechSpeedLabel() {
    const n = nearestSpeed(settings.speechStep);
    return n.item.label + '（' + (0.13 / n.item.step).toFixed(2).replace(/0$/, '') + '×）';
  }
  function cycleSpeechStyle() {
    const ids = SPEECH_MODES.map(x => x.id);
    const i = Math.max(0, ids.indexOf(speechMode()));
    settings.speechMode = ids[(i + 1) % ids.length];
    settings.speechFollow = settings.speechMode !== 'classic';   // 老字段同步（兼容）
    saveSettings(); ttsCache.clear(); trackCache.clear();
    const tip = settings.speechMode === 'tts' ? '（真人声直接播，不改音色）'
      : settings.speechMode === 'guided' ? '（音高跟着真人语调走）' : '（音高按字固定）';
    bubbleSay('朗读模式：' + speechStyleLabel() + tip, 3200);
    sfx('tap');
    speechProbe(settings.speechMode === 'tts' ? '这就是普通朗读，喜欢吗？'
      : settings.speechMode === 'guided' ? '这样说话，是不是更像在聊天？' : '嗯，这样也很有味道。');
  }
  /** 音效音量循环（30% / 60% / 90%） */
  function cycleSfxVolume() {
    const steps = [0.3, 0.6, 0.9];
    const cur = sfxVolume();
    let i = steps.findIndex(v => Math.abs(v - cur) < 0.06);
    settings.sfxVolume = steps[(i + 1) % steps.length];
    saveSettings(); sfxApplyVolume(); sfx('pop', { force: true });
    bubbleSay('音效音量：' + Math.round(settings.sfxVolume * 100) + '%', 2200);
  }
  function cycleSpeechVoice() {
    const keys = Object.keys(SPEECH_VOICE_NAMES);
    const i = Math.max(0, keys.indexOf(settings.speechVoice || 'fish'));
    settings.speechVoice = keys[(i + 1) % keys.length];
    saveSettings();
    bubbleSay('朗读音色：' + speechVoiceLabel(), 2800);
    speechProbe('这个声线，你觉得怎么样？');
  }
  function cycleSpeechSpeed() {
    const n = nearestSpeed(settings.speechStep);
    const next = SPEECH_SPEEDS[(n.index + 1) % SPEECH_SPEEDS.length];
    settings.speechStep = next.step;
    saveSettings();
    bubbleSay('朗读速度：' + speechSpeedLabel(), 2800);
    speechProbe('这个速度，跟得上吗？');
  }

  /** 一键开关音效（菜单里用；改完给一声反馈：切到开时响一下） */  function toggleSfx() {
    settings.sfxOn = settings.sfxOn === false;
    saveSettings();
    if (settings.sfxOn) { sfx('pop', { force: true }); bubbleSay('音效开啦，听见没？', 2200); }
    else bubbleSay('音效关掉了，安静一会儿～', 2200);
  }
  function buildMenu() {
    menu.textContent = '';
    for (const it of MENU_ITEMS) {
      if (it.sep) { menu.appendChild($new('div', 'pb2-msep')); continue; }
      const row = $new('div', 'pb2-mi');
      menuIcon(row, it.icon);
      row.appendChild($new('span', 'pb2-mlabel', typeof it.label === 'function' ? it.label() : it.label));
      if (it.sub) {
        row.appendChild($new('span', 'pb2-marrow', '▾'));   // 折叠标记：点一下就地展开
        const sub = $new('div', 'pb2-submenu');
        for (const s of it.sub) {
          if (s.sep) { sub.appendChild($new('div', 'pb2-msep')); continue; }
          const r2 = $new('div', 'pb2-mi');
          menuIcon(r2, s.icon);
          r2.appendChild($new('span', 'pb2-mlabel', typeof s.label === 'function' ? s.label() : s.label));
          r2.addEventListener('click', ev => {
            ev.stopPropagation();
            if (!s.keepOpen) menu.hidden = true;
            s.act();
            if (s.keepOpen) {                       // v3.5：切换类项目就地刷新文字、不关菜单
              const l2 = r2.querySelector('.pb2-mlabel');
              if (l2) l2.textContent = typeof s.label === 'function' ? s.label() : s.label;
              sfx('tap');
            }
          });
          sub.appendChild(r2);
        }
        row.appendChild(sub);
        // v3.3.2：改成**就地展开**（原来是悬停向右弹出，桌宠在屏幕右下时会被窗口边界裁掉）
        row.addEventListener('click', ev => {
          ev.stopPropagation();
          row.classList.toggle('pb2-sub-open');
          const arrow = row.querySelector('.pb2-marrow');
          if (arrow) arrow.textContent = row.classList.contains('pb2-sub-open') ? '▴' : '▾';
        });
      } else {
        row.addEventListener('click', () => {
          if (it.keepOpen) {
            it.act();
            const lbl = row.querySelector('.pb2-mlabel');
            if (lbl) lbl.textContent = typeof it.label === 'function' ? it.label() : it.label;
            sfx('tap');
          } else { menu.hidden = true; it.act(); }
        });
      }
      menu.appendChild(row);
    }
  }
  petWrap.addEventListener('contextmenu', e => {
    e.preventDefault(); e.stopPropagation();
    sfx('pop'); // v3.3：右键菜单弹出
    buildMenu();
    menu.hidden = false;
    menu.style.left = clamp(e.clientX - 8, 6, window.innerWidth - 200) + 'px';
    menu.style.top = clamp(e.clientY - 8, 6, window.innerHeight - 300) + 'px';
  });
  document.addEventListener('pointerdown', e => { if (!menu.hidden && !menu.contains(e.target)) menu.hidden = true; }, true);
  restoreDot.addEventListener('click', () => { settings.hidden = false; saveSettings(); applyHidden(); refreshLayout(); });

  function applyHidden() { root.classList.toggle('pb2-hidden-mode', !!settings.hidden); }
  applyHidden();

  /* ================= 弹窗基建 ================= */
  let dialogMask = null;
  function openDialog(title, bodyBuilder, footButtons) {
    closeDialog();
    sfx('pop'); // v3.3：面板弹出给一声轻响
    dialogMask = $new('div', 'pb2-mask');
    const dlg = $new('div', 'pb2-dialog');
    const tt = $new('div', 'pb2-dtitle');
    tt.appendChild($new('span', null, title));
    const x = $new('button', 'pb2-dclose', '✕');
    x.addEventListener('click', closeDialog);
    tt.appendChild(x);
    const body = $new('div', 'pb2-dbody');
    bodyBuilder(body);
    const foot = $new('div', 'pb2-dfoot');
    (footButtons || [{ label: '关闭' }]).forEach(cfg => {
      const btn = $new('button', cfg.primary ? 'pb2-primary' : null, cfg.label);
      btn.addEventListener('click', () => { if (cfg.onClick) { if (cfg.onClick() === false) return; } closeDialog(); });
      foot.appendChild(btn);
    });
    dlg.appendChild(tt); dlg.appendChild(body); dlg.appendChild(foot);
    dialogMask.appendChild(dlg);
    root.appendChild(dialogMask);
  }
  function closeDialog() { if (dialogMask) { dialogMask.remove(); dialogMask = null; } }

  /** 小输入弹窗（宿主里 window.prompt 不保证可用，自己做一个） */
  function askText(title, def, onOk) {
    openDialog(title, body => {
      const inp = $new('input');
      inp.type = 'text'; inp.value = def || ''; inp.style.width = '100%';
      body.appendChild(inp);
      body.appendChild($new('div', 'pb2-hint', '回车或点「确定」保存（留空=取消）'));
      inp.addEventListener('keydown', ev => {
        if (ev.key === 'Enter') { ev.preventDefault(); const v = inp.value.trim(); if (v) { closeDialog(); onOk(v); } }
      });
      setTimeout(() => { try { inp.focus(); inp.select(); } catch (e) { /* 焦点无所谓 */ } }, 30);
    }, [
      { label: '取消' },
      { label: '确定', primary: true, onClick: () => {
        const inp = dialogMask && dialogMask.querySelector('input[type=text]');
        const v = inp ? inp.value.trim() : '';
        if (v) setTimeout(() => onOk(v), 0);
      } },
    ]);
  }

  /** 模型包导出（自定义模型 → .json 文件；增删改查里的"导出"） */
  function exportSkinPack(list) {
    const pack = {
      format: 'pet-buddy-skinpack', version: 1, exportedAt: nowStr(),
      skins: list.map(c => ({ name: c.name, dataUrl: c.dataUrl })),
    };
    try {
      const blob = new Blob([JSON.stringify(pack, null, 1)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'petbuddy-skins-' + (list.length === 1 ? String(list[0].name || 'skin').replace(/[\\/:*?"<>|]/g, '_') : 'all') + '.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      bubbleSay('模型包导出好啦（在系统下载文件夹）', 3400);
    } catch (e) { bubbleSay('导出失败：' + e.message, 4200); }
  }

  /** 模型包导入（.json → 自定义模型；返回 added 数量） */
  function importSkinPackFile(file, done) {
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const pack = JSON.parse(String(rd.result));
        const list = Array.isArray(pack) ? pack : (pack.skins || []);
        if (!list.length) throw new Error('里面没有模型');
        let added = 0;
        for (const s of list) {
          if (!s || typeof s.dataUrl !== 'string' || s.dataUrl.slice(0, 5) !== 'data:') continue;
          settings.customSkins = (settings.customSkins || []).concat([{
            id: 'custom:' + Date.now() + ':' + (added++),
            name: String(s.name || '导入的模型').slice(0, 24),
            dataUrl: s.dataUrl,
          }]);
        }
        // 自定义模型上限 24 个（localStorage 不是无底洞）＋每个 2MB 以内
        settings.customSkins = (settings.customSkins || []).slice(-24);
        saveSettings();
        done(added);
      } catch (e) { done(0, e && e.message ? e.message : String(e)); }
    };
    rd.readAsText(file);
  }

  /* ---- 常用语库（增删改查：加一条、改文字、删掉、点一条就让它念） ---- */
  function openPhraseBook() {
    const getArr = () => (settings.phrases = settings.phrases || []);
    openDialog('常用语（点「说」就念出来）', body => {
      body.appendChild($new('div', 'pb2-hint', '存在本机（localStorage），最多 30 条；语音闲聊、试听都用得上。'));
      const inp = $new('input');
      inp.type = 'text'; inp.placeholder = '加一条，例如：今天吃白饭？'; inp.style.flex = '1 1 auto';
      const bAdd = $new('button', null, '添加'); bAdd.type = 'button';
      const addRow = $new('div', 'pb2-row');
      addRow.appendChild(inp); addRow.appendChild(bAdd);
      const listBox = $new('div');
      function render() {
        listBox.textContent = '';
        const arr = getArr();
        if (!arr.length) { listBox.appendChild($new('div', 'pb2-hint', '还没有常用语～加一条试试')); return; }
        for (const p of arr) {
          const row = $new('div', 'pb2-row');
          row.appendChild($new('span', 'pb2-rowtext', p.text));
          const bSay = $new('button', null, '说'); bSay.type = 'button';
          bSay.addEventListener('click', () => { speechUnlock(); speak(p.text, { force: true }); });
          const bEdit = $new('button', null, '改'); bEdit.type = 'button';
          bEdit.addEventListener('click', () => askText('改成什么？', p.text, (v) => { p.text = v.slice(0, 60); saveSettings(); openPhraseBook(); }));
          const bDel = $new('button', null, '删'); bDel.type = 'button';
          bDel.addEventListener('click', () => { settings.phrases = getArr().filter(x => x.id !== p.id); saveSettings(); render(); });
          row.appendChild(bSay); row.appendChild(bEdit); row.appendChild(bDel);
          listBox.appendChild(row);
        }
      }
      function add(text) {
        const arr = getArr();
        const t = String(text || '').trim().slice(0, 60);
        if (!t) return false;
        if (arr.some(x => x.text === t)) return false;
        if (arr.length >= 30) { bubbleSay('最多 30 条哦', 2600); return false; }
        arr.push({ id: 'p' + Date.now() + ':' + arr.length, text: t });
        saveSettings();
        return true;
      }
      bAdd.addEventListener('click', () => { if (add(inp.value)) { inp.value = ''; render(); } });
      inp.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); if (add(inp.value)) { inp.value = ''; render(); } } });
      body.appendChild(addRow);
      body.appendChild(listBox);
      const bPreset = $new('button', null, '加几条示例'); bPreset.type = 'button';
      bPreset.addEventListener('click', () => {
        ['今天吃白饭？没饭了！', '余额还剩多少呀？', '哼，才不是在等你呢……'].forEach(t => add(t));
        render();
      });
      body.appendChild(bPreset);
      render();
      setTimeout(() => { try { inp.focus(); } catch (e) { /* 无所谓 */ } }, 30);
    });
  }

  /* ---- 模型选择器（BongoCat 式管理思路） ---- */
  function openModelPicker() {
    openDialog('修改桌宠模型', body => {
      const hidden = Array.isArray(settings.hiddenSkins) ? settings.hiddenSkins : [];
      body.appendChild($new('h4', null, '内置模型（可移除，移除后可恢复）'));
      const grid = $new('div', 'pb2-model-grid');
      const allBuiltin = Object.keys(SPRITE_SKINS).map(id => ({
        id,
        name: SPRITE_SKINS[id].name,
        desc: SPRITE_SKINS[id].desc + (SPRITE_SKINS[id].credit ? ' · ' + SPRITE_SKINS[id].credit : ''),
        thumb: SPRITE_SKINS[id].url,
        bgPos: '-192px -208px',
      })).concat(Object.keys(IMAGE_SKINS).map(id => ({
        id,
        name: IMAGE_SKINS[id].name,
        desc: IMAGE_SKINS[id].desc + (IMAGE_SKINS[id].credit ? ' · ' + IMAGE_SKINS[id].credit : ''),
        thumb: assetUrl(IMAGE_SKINS[id].file),
        contain: true,
      })));
      const builtin = allBuiltin.filter(m => hidden.indexOf(m.id) < 0);
      for (const m of builtin) {
        const card = $new('div', 'pb2-model-card' + (settings.skin === m.id ? ' pb2-selected' : ''));
        const th = $new('div', 'pb2-model-thumb');
        th.style.backgroundImage = 'url("' + m.thumb + '")';
        if (m.bgPos) { th.style.backgroundSize = '1536px 2288px'; th.style.backgroundPosition = m.bgPos; }
        else if (m.contain) { th.style.backgroundSize = 'contain'; th.style.backgroundPosition = 'center'; th.style.backgroundRepeat = 'no-repeat'; }
        const info = $new('div');
        info.appendChild($new('div', 'pb2-model-name', m.name));
        info.appendChild($new('div', 'pb2-model-desc', m.desc));
        // v3.7：内置模型也能移除（从列表隐藏，素材不动；随时可恢复）
        const acts = $new('div', 'pb2-model-acts');
        const del = $new('button', 'pb2-model-act pb2-model-del', '移除');
        del.type = 'button';
        del.title = '从列表移除（素材不删，可在下方「恢复已移除」找回）';
        del.addEventListener('click', ev => {
          ev.stopPropagation();
          const list = Array.isArray(settings.hiddenSkins) ? settings.hiddenSkins.slice() : [];
          if (list.indexOf(m.id) < 0) list.push(m.id);
          settings.hiddenSkins = list;
          if (settings.skin === m.id) { settings.skin = 'fish'; applySkin(); refreshLayout(); }
          saveSettings(); sfx('tap');
          bubbleSay('已经把「' + m.name + '」从列表里移除啦（可恢复）', 2800);
          openModelPicker();
        });
        acts.appendChild(del);
        card.appendChild(th); card.appendChild(info); card.appendChild(acts);
        card.addEventListener('click', () => { settings.skin = m.id; saveSettings(); applySkin(); refreshLayout(); closeDialog(); sfx('ok'); bubbleSay('变身！' + m.name + '登场～', 2600); });
        grid.appendChild(card);
      }
      body.appendChild(grid);
      if (hidden.length) {
        const restore = $new('button', null, '恢复已移除的模型（' + hidden.length + '）');
        restore.type = 'button';
        restore.style.marginTop = '6px';
        restore.addEventListener('click', () => {
          settings.hiddenSkins = [];
          saveSettings(); sfx('ok');
          bubbleSay('都找回来啦～', 2200);
          openModelPicker();
        });
        body.appendChild(restore);
      }
      body.appendChild($new('h4', null, '自定义模型（上传图片 · 可改名/导出/删除）'));
      const impBtn = $new('button', null, '导入模型包（.json）'); impBtn.type = 'button';
      const impFile = $new('input'); impFile.type = 'file'; impFile.accept = '.json,application/json'; impFile.style.display = 'none';
      impBtn.addEventListener('click', () => impFile.click());
      impFile.addEventListener('change', () => {
        const f = impFile.files && impFile.files[0];
        if (!f) return;
        importSkinPackFile(f, (n, err) => {
          if (n > 0) { openModelPicker(); bubbleSay('导入了 ' + n + ' 个模型～', 2800); }
          else bubbleSay('导入失败：' + (err || '文件里没有可用模型'), 4400);
        });
      });
      const impRow = $new('div', 'pb2-row');
      impRow.appendChild(impBtn); impRow.appendChild(impFile);
      const all = settings.customSkins || [];
      if (all.length > 1) {
        const expAll = $new('button', null, '全部导出'); expAll.type = 'button';
        expAll.addEventListener('click', () => exportSkinPack(all));
        impRow.appendChild(expAll);
      }
      body.appendChild(impRow);
      const file = $new('input'); file.type = 'file'; file.accept = 'image/*';
      file.addEventListener('change', () => {
        const f = file.files && file.files[0];
        if (!f) return;
        if (f.size > 2 * 1024 * 1024) { body.appendChild($new('div', 'pb2-hint', '图片超过 2MB，请压缩后再上传')); return; }
        const rd = new FileReader();
        rd.onload = () => {
          const id = 'custom:' + Date.now();
          settings.customSkins = (settings.customSkins || []).concat([{ id, name: f.name, dataUrl: String(rd.result) }]);
          settings.skin = id; saveSettings(); applySkin(); refreshLayout(); closeDialog();
          bubbleSay('新衣服穿好啦～', 2400);
        };
        rd.readAsDataURL(f);
      });
      body.appendChild(file);
      const customs = settings.customSkins || [];
      if (customs.length) {
        const grid2 = $new('div', 'pb2-model-grid');
        for (const c of customs) {
          const card = $new('div', 'pb2-model-card' + (settings.skin === c.id ? ' pb2-selected' : ''));
          const th = $new('div', 'pb2-model-thumb');
          th.style.backgroundImage = 'url("' + c.dataUrl + '")';
          const info = $new('div');
          info.appendChild($new('div', 'pb2-model-name', c.name));
          info.appendChild($new('div', 'pb2-model-desc', '自定义上传'));
          const acts = $new('div', 'pb2-model-acts');
          const ren = $new('button', 'pb2-model-act', '改名'); ren.type = 'button';
          ren.addEventListener('click', ev => {
            ev.stopPropagation();
            askText('给这张模型起个名字', c.name || '', (v) => { c.name = v.slice(0, 24); saveSettings(); openModelPicker(); });
          });
          const exp = $new('button', 'pb2-model-act', '导出'); exp.type = 'button';
          exp.addEventListener('click', ev => { ev.stopPropagation(); exportSkinPack([c]); });
          const del = $new('button', 'pb2-model-act pb2-model-del', '删除'); del.type = 'button';
          del.addEventListener('click', ev => {
            ev.stopPropagation();
            settings.customSkins = settings.customSkins.filter(x => x.id !== c.id);
            if (settings.skin === c.id) settings.skin = 'fish';
            saveSettings(); applySkin(); refreshLayout(); openModelPicker();
          });
          acts.appendChild(ren); acts.appendChild(exp); acts.appendChild(del);
          card.appendChild(th); card.appendChild(info); card.appendChild(acts);
          card.addEventListener('click', () => { settings.skin = c.id; saveSettings(); applySkin(); refreshLayout(); closeDialog(); });
          grid2.appendChild(card);
        }
        body.appendChild(grid2);
      }
      body.appendChild($new('div', 'pb2-hint', '模型管理思路参考 BongoCat：内置 + 上传 + 改名/导出/导入/删除。上传图片与常用语都只存本机 localStorage。'));
    });
  }

  /* ---- 角色设定（可编辑） ---- */
  function openPersonaEditor() {
    openDialog('角色设定', body => {
      body.appendChild($new('label', null, '大肥鱼的性格设定（留空恢复默认：傲娇搞笑毒舌忠诚挚友）'));
      const ta = $new('textarea');
      ta.value = settings.persona || '';
      ta.placeholder = DEFAULT_PERSONA;
      ta.addEventListener('input', () => { ta.dataset.dirty = '1'; });
      body.appendChild(ta);
      const reset = $new('button'); reset.type = 'button'; reset.textContent = '恢复默认'; reset.style.marginTop = '8px';
      reset.addEventListener('click', () => { ta.value = ''; ta.dataset.dirty = '1'; });
      body.appendChild(reset);
      openDialog._personaTA = ta;
    }, [
      { label: '取消' },
      { label: '保存', primary: true, onClick: () => {
          const ta = openDialog._personaTA;
          if (ta) { settings.persona = ta.dataset.dirty ? ta.value.trim() : settings.persona; saveSettings(); bubbleSay('记住了！以后就这么演。', 2600); }
        } },
    ]);
  }

  /* ---- 聊天设置：通道 / 模型 / 额度 / 网关 ---- */
  function openChatSettings() {
    openDialog('聊天设置', body => {
      body.appendChild($new('label', null, '聊天通道'));
      const ch = $new('select');
      [['assistant', '助手子对话（统一）· 默认'], ['gateway', '网关令牌（OpenAI 兼容）'], ['mock', '模拟模式（离线）']].forEach(([v, l]) => {
        const op = $new('option', null, l); op.value = v; if (settings.channel === v) op.selected = true; ch.appendChild(op);
      });
      body.appendChild(ch);
      body.appendChild($new('label', null, '聊天模型（助手通道）'));
      const mdl = $new('select');
      CHAT_MODELS.forEach(m => {
        const op = $new('option', null, m.label);
        op.value = m.provider + '|' + m.model;
        if (settings.chatProvider === m.provider && settings.chatModel === m.model) op.selected = true;
        mdl.appendChild(op);
      });
      body.appendChild(mdl);
      body.appendChild($new('label', null, '剩余额度（元，自填可选；填了余额报告会带上）'));
      const quota = $new('input'); quota.type = 'number'; quota.min = '0'; quota.step = '0.01';
      quota.value = Number(settings.quota) > 0 ? String(settings.quota) : '';
      body.appendChild(quota);
      body.appendChild($new('label', null, '每元积分（积分制换算，后端 1000 分 = 1 元）'));
      const py = $new('input'); py.type = 'number'; py.min = '1'; py.step = '1';
      py.value = perYuanCredits();
      body.appendChild(py);
      body.appendChild($new('label', null, '网关 baseURL（只有 sk- 开头的 API Key 才需要；内部通道看助手额度，不用填）'));
      const gb = $new('input'); gb.type = 'text'; gb.placeholder = 'https://.../v1（可留空）'; gb.value = settings.gatewayBase || '';
      body.appendChild(gb);
      body.appendChild($new('label', null, '网关令牌（只存本浏览器 localStorage，不进日志）'));
      const gk = $new('input'); gk.type = 'password';
      gk.placeholder = '留空即可 ｜ sk-xxxx（网关 API Key）｜ jxai-姓名-设备号（内部通道身份牌）';
      gk.value = settings.gatewayKey || '';
      body.appendChild(gk);
      // v3.1.0 令牌格式识别：即时告诉用户填的是什么、余额从哪来
      const tkHint = $new('div', 'pb2-hint', tokenHint(gk.value));
      const tkExtra = $new('div', 'pb2-hint');
      body.appendChild(tkHint); body.appendChild(tkExtra);
      const refreshTokenHint = () => {
        const t = parseGatewayToken(gk.value);
        tkHint.textContent = tokenHint(gk.value);
        tkExtra.textContent = '';
        if (t.kind === 'inner') {
          const used = settings.nickname === t.name;
          const b = $new('button', null, used ? '昵称已是「' + t.name + '」' : '用「' + t.name + '」当昵称');
          b.type = 'button'; b.style.marginTop = '6px';
          b.addEventListener('click', () => {
            settings.nickname = t.name; saveSettings();
            b.textContent = '昵称已是「' + t.name + '」';
            bubbleSay('身份牌收到！以后叫你 ' + t.name + '～', 2800);
          });
          tkExtra.appendChild(b);
        }
      };
      gk.addEventListener('input', refreshTokenHint);
      refreshTokenHint();
      body.appendChild($new('label', null, '网关模型名'));
      const gm = $new('input'); gm.type = 'text'; gm.placeholder = 'deepseek-chat'; gm.value = settings.gatewayModel || '';
      body.appendChild(gm);
      body.appendChild($new('label', null, 'BongoCat 式鼠标/键盘监控（女仆/自定义皮肤：爪子跟随鼠标、按键弹键帽）'));
      const mon = $new('select');
      [['1', '开启（页面聚焦时生效）'], ['0', '关闭']].forEach(([v, l]) => {
        const op = $new('option', null, l); op.value = v;
        if ((settings.monitor !== false ? '1' : '0') === v) op.selected = true;
        mon.appendChild(op);
      });
      body.appendChild(mon);
      body.appendChild($new('label', null, '声音 · 语音播报（聊天回复念出来）'));
      const spOn = $new('select');
      [['1', '开启'], ['0', '关闭（不说话）']].forEach(([v, l]) => {
        const op = $new('option', null, l); op.value = v;
        if ((settings.speechOn !== false ? '1' : '0') === v) op.selected = true;
        spOn.appendChild(op);
      });
      body.appendChild(spOn);
      body.appendChild($new('label', null, '声音 · bibo音色（合成器声线，影响「语调引导 / 经典合成」）'));
      const spVoice = $new('select');
      Object.keys(SPEECH_VOICE_NAMES).forEach(k => {
        const op = $new('option', null, SPEECH_VOICE_NAMES[k]); op.value = k;
        if ((settings.speechVoice || 'fish') === k) op.selected = true;
        spVoice.appendChild(op);
      });
      body.appendChild(spVoice);
      body.appendChild($new('label', null, '声音 · 音量'));
      const spVol = $new('input'); spVol.type = 'range'; spVol.min = '0'; spVol.max = '1'; spVol.step = '0.05';
      spVol.value = String(speechVolume());
      body.appendChild(spVol);
      body.appendChild($new('label', null, '声音 · 语速（每字间隔秒，越小越快）'));
      const spStep = $new('input'); spStep.type = 'range'; spStep.min = '0.08'; spStep.max = '0.3'; spStep.step = '0.01';
      spStep.value = String(clamp(Number(settings.speechStep) || 0.13, 0.08, 0.3));
      body.appendChild(spStep);
      body.appendChild($new('label', null, '声音 · 单次朗读上限（字，超出截断）'));
      const spMax = $new('input'); spMax.type = 'number'; spMax.min = '4'; spMax.max = '400'; spMax.step = '1';
      spMax.value = String(clamp(Math.round(Number(settings.speechMaxChars) || 60), 4, 400));
      body.appendChild(spMax);
      body.appendChild($new('label', null, '声音 · 风格（引导＝经典音色+按真人语调选音；普通朗读＝直接用真人声）'));
      const spFollow = $new('select');
      [['guided', '语调引导（还是哔哔啵啵的音色，音高贴真人语调）'],
       ['classic', '经典合成（完全按字，音高固定几档）'],
       ['tts', '普通朗读（真人声直接播，不改音色）']].forEach(([v, l]) => {
        const op = $new('option', null, l); op.value = v;
        if (speechMode() === v) op.selected = true;
        spFollow.appendChild(op);
      });
      body.appendChild(spFollow);
      body.appendChild($new('label', null, '声音 · 朗读音色（宿主 TTS 的音色，影响「普通朗读」）'));
      const ttsVoiceSel = $new('select');
      const buildVoiceOptions = () => {
        ttsVoiceSel.textContent = '';
        const opt0 = $new('option', null, '宿主默认'); opt0.value = '';
        if (!settings.ttsVoice) opt0.selected = true;
        ttsVoiceSel.appendChild(opt0);
        for (const v of ttsVoiceList()) {
          const op = $new('option', null, v.display || v.name); op.value = v.name;
          if (settings.ttsVoice === v.name) op.selected = true;
          ttsVoiceSel.appendChild(op);
        }
        if (settings.ttsVoice && !ttsVoiceList().some(v => v.name === settings.ttsVoice)) {
          const op = $new('option', null, settings.ttsVoice + '（自定义）'); op.value = settings.ttsVoice;
          op.selected = true; ttsVoiceSel.appendChild(op);
        }
      };
      buildVoiceOptions();
      body.appendChild(ttsVoiceSel);
      fetchTtsVoices().then(() => buildVoiceOptions());   // 拿到宿主音色表后刷新一次
      body.appendChild($new('label', null, '声音 · 朗读语速（0.5–2，1 为正常）'));
      const ttsRateInp = $new('input'); ttsRateInp.type = 'number';
      ttsRateInp.min = '0.5'; ttsRateInp.max = '2'; ttsRateInp.step = '0.1';
      ttsRateInp.value = String(clamp(Number(settings.ttsRate) || 1, 0.5, 2));
      body.appendChild(ttsRateInp);
      const probe = $new('button', null, '试听一句'); probe.type = 'button';      probe.addEventListener('click', () => { // 先落盘当前值再试听，听到的即保存后的效果
        settings.speechOn = spOn.value === '1';
        settings.speechVoice = spVoice.value;
        settings.speechVolume = Number(spVol.value);
        settings.speechStep = Number(spStep.value) || 0.13;
        settings.speechMaxChars = Number(spMax.value) || 60;
        settings.speechMode = spFollow.value;
        settings.speechFollow = spFollow.value !== 'classic';
        settings.ttsVoice = ttsVoiceSel.value;
        settings.ttsRate = clamp(Number(ttsRateInp.value) || 1, 0.5, 2);
        speechApplyVolume(); saveSettings();
        ttsCache.clear(); trackCache.clear();   // 换风格/音色/语速后，缓存作废
        speechProbe('哼哼，本小姐的声线，就是这个味道吧？');
      });
      body.appendChild(probe);
      body.appendChild($new('label', null, '音效 · 开关（点桌宠 / 弹面板 / 拖拽吸附 / 听写提示）'));
      const sfxOnSel = $new('select');
      [['1', '开启'], ['0', '关闭']].forEach(([v, l]) => {
        const op = $new('option', null, l); op.value = v;
        if ((settings.sfxOn !== false ? '1' : '0') === v) op.selected = true;
        sfxOnSel.appendChild(op);
      });
      body.appendChild(sfxOnSel);
      body.appendChild($new('label', null, '音效 · 音量（与语音音量独立）'));
      const sfxVol = $new('input'); sfxVol.type = 'range'; sfxVol.min = '0'; sfxVol.max = '1'; sfxVol.step = '0.05';
      sfxVol.value = String(sfxVolume());
      body.appendChild(sfxVol);
      const sfxProbe = $new('button', null, '试听音效'); sfxProbe.type = 'button';
      sfxProbe.addEventListener('click', () => { // 先落盘当前值，再连着把五个音效响一遍
        settings.sfxOn = sfxOnSel.value === '1';
        settings.sfxVolume = Number(sfxVol.value);
        sfxApplyVolume(); saveSettings();
        ['tap', 'pop', 'drop', 'ok', 'err'].forEach((n, i) => setTimeout(() => sfx(n, { force: true }), i * 320));
      });
      body.appendChild(sfxProbe);
      body.appendChild($new('div', 'pb2-hint', '语音闲聊：按住「' + VI_HOTKEY_LABEL + '」说话，松开就发给我（助手窗口要在前台）；也可以点右键菜单「语音闲聊」，说完静音 2 秒自动收尾。听写用宿主「语音」组件的本地离线模型（在 设置 → 语音 里开关）。左 Alt 是助手自带的语音听写，本插件不占用。浏览器策略：没有任何用户手势时不会自动出声，点一下桌宠即可解锁。'));
      body.appendChild($new('div', 'pb2-hint', '通道提示：模型调用失败（余额不足/通道停用/断连）会即时识别并自动回落模拟模式，具体原因会显示在回复开头；通道恢复后助手聊天自动可用。积分制：1000 分 = 1 元。余额来源：① 助手额度（公司内部通道的月度剩余/总额，默认走这条，不需要填令牌）；② sk- 开头的网关 API Key（读网关账单：订阅额度 − 累计用量）；③ 本页自填额度。jxai-姓名-设备号 是公司内部通道的身份牌，只用来认人（可一键当昵称），不是网关 Key。'));
      openDialog._fields = { ch, mdl, quota, py, gb, gk, gm, mon, spOn, spVoice, spVol, spStep, spMax, spFollow, ttsVoiceSel, ttsRateInp, sfxOnSel, sfxVol };
    }, [
      { label: '取消' },
      { label: '保存', primary: true, onClick: () => {
          const f = openDialog._fields; if (!f) return;
          settings.channel = f.ch.value;
          const pm = f.mdl.value.split('|');
          if (settings.chatProvider !== pm[0] || settings.chatModel !== pm[1]) {
            settings.chatProvider = pm[0]; settings.chatModel = pm[1];
            localStorage.removeItem(CHAT_LS_SID); // 换模型 → 重建统一子对话
          }
          settings.quota = Number(f.quota.value) || 0;
          settings.perYuan = Number(f.py.value) > 0 ? Number(f.py.value) : 1000;
          settings.gatewayBase = f.gb.value.trim();
          settings.gatewayKey = f.gk.value;
          settings.gatewayModel = f.gm.value.trim();
          settings.monitor = f.mon.value === '1';
          settings.speechOn = f.spOn.value === '1';
          settings.speechVoice = f.spVoice.value;
          settings.speechVolume = Number(f.spVol.value);
          settings.speechStep = Number(f.spStep.value) || 0.13;
          settings.speechMaxChars = Number(f.spMax.value) || 60;
          settings.speechMode = f.spFollow.value;
          settings.speechFollow = f.spFollow.value !== 'classic';
          settings.ttsVoice = f.ttsVoiceSel.value;
          settings.ttsRate = clamp(Number(f.ttsRateInp.value) || 1, 0.5, 2);
          settings.sfxOn = f.sfxOnSel.value === '1';
          settings.sfxVolume = Number(f.sfxVol.value);
          speechApplyVolume();
          sfxApplyVolume();
          ttsCache.clear(); trackCache.clear();
          CREDITS_CACHE = { at: 0, data: null }; // 换算/凭据变更 → 立即重取
          saveSettings(); applyMonitor(); bubbleSay('设置好了～', 2000);
        } },
    ]);
  }

  /* ---- 思考过程查看器 ---- */
  function openLogViewer() {
    openDialog('思考过程（后台日志·仅供查看）', body => {
      const list = $new('div', 'pb2-loglist');
      if (!logs.length) list.appendChild($new('div', 'pb2-logrow', '（暂无日志）'));
      for (const it of logs.slice(-100).reverse()) {
        const row = $new('div', 'pb2-logrow pb2-t-' + it.type);
        row.appendChild($new('div', 'pb2-loghead', it.t + '  [' + it.type + ']'));
        row.appendChild($new('div', null, it.text));
        list.appendChild(row);
      }
      body.appendChild(list);
      const clear = $new('button'); clear.type = 'button'; clear.textContent = '清空日志'; clear.style.marginTop = '10px';
      clear.addEventListener('click', () => { logs = []; try { localStorage.removeItem(LS_LOG); } catch (e) {} openLogViewer(); });
      body.appendChild(clear);
      body.appendChild($new('div', 'pb2-hint', '模型的思考过程（reasoning）只写进这里，聊天里永远不会显示。'));
    });
  }

  /* ---- 窗口化聊天 ----
   * v3.6：默认改成**页面内气泡聊天面板**（没有浏览器地址栏、没有窗口边框、可随处拖动）；
   * 老做法（独立窗口 chat.html）保留在「设置 → 打开独立聊天窗口」里。 */
  let chatp = null, chatpMsgs = null, chatpInput = null, chatpBtn = null, chatpBusy = false;

  function chatpAdd(kind, text) {
    const row = $new('div', 'pb2-chatp-msg pb2-' + kind);
    if (kind === 'pet' || kind === 'me') { try { renderRich(row, text); } catch (e) { row.textContent = text; } }
    else row.textContent = text;
    chatpMsgs.appendChild(row);
    chatpMsgs.scrollTop = chatpMsgs.scrollHeight;
    return row;
  }

  async function chatpSend() {
    const text = (chatpInput.value || '').trim();
    if (!text || chatpBusy) return;
    chatpInput.value = '';
    chatpBusy = true; chatpBtn.disabled = true;
    chatpAdd('me', text);
    const typing = chatpAdd('sys', '大肥鱼思考中…');
    try {
      speechUnlock();
      const r = await chatSend(text);
      typing.remove();
      chatpAdd('pet', r.text);
      speak(r.text);
    } catch (e) {
      typing.remove();
      sfx('err');
      chatpAdd('pet', '出错了：' + e.message);
    } finally { chatpBusy = false; chatpBtn.disabled = false; chatpInput.focus(); }
  }

  function openChatPanel() {
    speechUnlock(); sfx('pop');
    if (chatp) { chatp.hidden = false; try { chatpInput.focus(); } catch (e) { /* 焦点无所谓 */ } return; }
    chatp = $new('div', 'pb2-chatp');
    const head = $new('div', 'pb2-chatp-head');
    const ttl = $new('span', null, '和大肥鱼聊天');
    ttl.style.flex = '1 1 auto';
    head.appendChild(ttl);
    const close = $new('button', 'pb2-chatp-close', '✕');
    close.type = 'button';
    close.title = '收起来（右键 →「气泡聊天」可再打开）';
    close.addEventListener('click', () => { chatp.hidden = true; sfx('tap'); });
    head.appendChild(close);
    chatp.appendChild(head);
    chatpMsgs = $new('div', 'pb2-chatp-msgs');
    chatp.appendChild(chatpMsgs);
    const foot = $new('div', 'pb2-chatp-foot');
    chatpInput = $new('input');
    chatpInput.type = 'text';
    chatpInput.placeholder = '说点什么…（回车发送）';
    chatpBtn = $new('button', null, '发送');
    chatpBtn.type = 'button';
    chatpBtn.addEventListener('click', chatpSend);
    chatpInput.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); chatpSend(); } });
    foot.appendChild(chatpInput); foot.appendChild(chatpBtn);
    chatp.appendChild(foot);
    document.body.appendChild(chatp);
    chatpAdd('sys', '（试试问我余额还剩多少～）');
    setTimeout(() => { try { chatpInput.focus(); } catch (e) { /* 同上 */ } }, 60);
  }
  function openChatWindow() {
    window.open(assetDir() + 'chat.html', 'pb2-chat', 'width=470,height=720');
  }

  /* ================= 启动问候 ================= */
  setTimeout(() => {
    if (settings.hidden) return;
    const greet = periodGreet();
    const nick = settings.nickname ? '，' + settings.nickname : '';
    bubbleSay(greet + nick + '！大肥鱼在岗，戳我看账，双击聊天～', 6000);
  }, 900);

  /* ================= 对外（测试钩子，只读） ================= */
  window.PB2 = Object.freeze({
    version: PB_VERSION,
    states: STATES,
    frameOf,
    balance: todaySpend,
    chatSend,
    settings: () => Object.assign({}, settings),
    logs: () => logs.slice(),
    els: { root, petWrap, sprite, bubble, menu },
    assets: { dir: assetDir, url: assetUrl, resolve: resolveAssetUrls, probe: assetProbe, spriteUrl: spriteSkinUrl, grid: SPRITE_GRID },    speech: speak,
    speechProbe,
    speechClean,
    speechState,
    sfx,
    sfxState,
    voice: { start: viStart, stop: viStop, cancel: viCancel, phase: viPhase, lastError: viLastError, label: VI_HOTKEY_LABEL },
    _test: {
      singleClick: onPetSingleClick,
      doubleClick: onPetDoubleClick,
      applySkin, refreshLayout, applyHidden, applyMonitor,
      pokeReaction, handleClickCandidate,
      renderRich, stickerEl, normSticker,
      sendVoiceChat, voiceChatByButton, speakReply,
      speechUnlock, speechStop, speechApplyVolume,
      sfxApplyVolume, isSpriteSkin, toggleSfx, buildMenu, MENU_ITEMS,
      verifySkinImage, spriteSkinClass,
      mixToMono, resampleLinear, prosodyTrack, analyzeFrame, synthFollow, ttsPcm, trackCache, ttsCache,
      synth, toWav, synthGuided, guidedTargets, guidedPickList, pickScaleMidi, VOICES,
      setSkin: (id) => { settings.skin = id; saveSettings(); applySkin(); refreshLayout(); },
      settingsRef: settings,
      openChatPanel, cycleSfxVolume, speechMode,
      cycleSpeechStyle, cycleSpeechVoice, cycleSpeechSpeed, speechStyleLabel,
      synthPaced, speechSegments, pauseOf, fetchTtsVoices, ttsVoiceLabel, cycleTtsVoice, ttsVoiceList,
      els2: { viewport, sprite, paws, pawL, pawR, keycap },
      isValley, priceTier, buildPrompt, extractNickname,
      personaFingerprint, loadPState, needPersonaFull,
      sendViaMock,
    },
  });
})();
