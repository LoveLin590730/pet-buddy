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
const PB_VERSION = '4.3.0';

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
    deletedSkins: [],        // v3.9 被"彻底删除"的皮肤 id（永久，不再出现在恢复列表）
    /* v3.8 开场白与余额格式 */
    greeting: '',            // 自定义开场白（空=默认；支持 {greet} 时段问候、{nickname} 昵称）
    pokeLines: [],           // v3.10 被戳一戳的反应词（空=用内置默认那几条；单击时随机挑一条 +（余额））
    pokeUpdatedAt: 0,        // 台词上次自动更新时间戳
    pokeAutoDays: 0,         // 台词自动更新周期（0=关闭，1=每天，7=每周）
    balanceStyle: 'short',   // 余额气泡格式：short 简洁 / detail 详细 / playful 傲娇
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
  let ASSET_SPRITE = ASSET_DIR + 'feiyu-spritesheet.webp';   // 官方精灵图（v4.1 起 WebP，体积 -59%）
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
    fish:  { name: '大肥鱼·鲸鲸娘', desc: 'ds-pet 官方 v2 精灵图 · 全动作动画', file: 'feiyu-spritesheet.webp', cls: 'pb2-skin-fish', credit: '', url: ASSET_DIR + 'feiyu-spritesheet.webp' },
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

  /* ---- v4.1 自定义动图皮肤：GIF / 动画 WebP 上传即会动 ----
   * 渲染路径与内置皮肤完全同路（<img> 会自动播 GIF/动画 WebP，和大人 120 帧已验证），
   * 这里只负责三件事：①判定一张 dataUrl 是不是动图 ②动画皮肤不叠 CSS 呼吸（pb2-skin-anim）
   * ③上传/导入前做体积与 localStorage 容量预检（存不下就明说，不静默丢）。
   * 上限沿用静态图既有约定延伸：静态 2MB；动图 4MB（base64 后约 5.3MB，
   * localStorage 配额约 10MB，CUSTOM_STORE_BUDGET 之外还给设置留余量）。 */
  const CUSTOM_STATIC_MAX = 2 * 1024 * 1024;   // 静态图上限（沿用既有约定）
  const CUSTOM_ANIM_MAX   = 4 * 1024 * 1024;   // 动图上限（GIF/动画 WebP）
  const CUSTOM_STORE_BUDGET = 9.0e6;           // 自定义皮肤总存储预算（字符；localStorage 上限约 10MB）

  /** 判定 dataUrl 是不是动图：'gif' | 'webp' | ''（静态/未知）。
   *  GIF89a：数 Graphic Control Extension（0x21 0xF9）出现次数，≥2 判动画（每帧带一个 GCE；
   *          单帧透明 GIF 也可能有 1 个 GCE，所以阈值取 2）。
   *  WebP：RIFF 容器里遍历 chunk，见到 'ANIM' 即动画（一定在头部，扫前 64KB 足够）。 */
  function imgAnimKind(dataUrl) {
    const s = String(dataUrl || '');
    const comma = s.indexOf(',');
    if (s.slice(0, 5) !== 'data:' || comma < 0) return '';
    let bytes;
    try { bytes = atob(s.slice(comma + 1)); } catch (e) { return ''; }
    const n = bytes.length;
    if (n < 12) return '';
    // GIF：头 GIF89a + ≥2 个 GCE → 动画
    if (bytes.slice(0, 6) === 'GIF89a') {
      let gce = 0;
      for (let i = 0; i < n - 1 && gce < 2; i++) if (bytes.charCodeAt(i) === 0x21 && bytes.charCodeAt(i + 1) === 0xF9) gce++;
      return gce >= 2 ? 'gif' : '';
    }
    // WebP：RIFF....WEBP + ANIM chunk
    if (bytes.slice(0, 4) === 'RIFF' && bytes.slice(8, 12) === 'WEBP') {
      let p = 12;
      while (p + 8 <= n && p <= 65536) {
        const tag = bytes.substr(p, 4);
        const sz = bytes.charCodeAt(p + 4) | (bytes.charCodeAt(p + 5) << 8) | (bytes.charCodeAt(p + 6) << 16) | (bytes.charCodeAt(p + 7) << 24);
        if (tag === 'ANIM') return 'webp';
        p += 8 + sz + (sz & 1);   // chunk 按 2 字节对齐
      }
    }
    return '';
  }

  /** 自定义皮肤是否为动图：c.anim 是缓存标记（上传时写入；旧数据与导入包没有就现场判定一次并记在内存里） */
  function customSkinAnim(c) {
    if (!c || typeof c.dataUrl !== 'string') return false;
    if (c.anim === true) return true;
    if (c.anim === false) return false;
    const k = imgAnimKind(c.dataUrl);
    c.anim = k !== '';            // 现场判定结果缓存到对象上（下次 saveSettings 顺带落盘）
    return c.anim;
  }

  /** 上传/导入前容量预检：新的 dataUrl 加进现有列表后，序列化长度是否还在预算内 */
  function customSkinStoreFits(list, dataUrl) {
    let total = String(dataUrl || '').length + 2048;   // 2048 = 其他字段与设置的粗略余量
    for (const c of (list || [])) total += String(c && c.dataUrl || '').length + 160;
    return total <= CUSTOM_STORE_BUDGET;
  }

  /** v4.1 空闲随机小动作（图片皮肤用）：与精灵图皮肤的 waving/jumping 等价，
   * 但图片皮肤没有帧序列，改用 CSS 整体小动作（keyframes 见 client.css）。 */
  const IMG_IDLE_FUNS = ['pb2-fun-wobble', 'pb2-fun-jump', 'pb2-fun-tilt'];
  function pickIdleFunClass(r) {
    const v = r == null ? Math.random() : Number(r);   // 注意 0 是合法输入，不能用 || 兜底
    const i = Math.floor((isNaN(v) ? Math.random() : v) * IMG_IDLE_FUNS.length);
    return IMG_IDLE_FUNS[Math.min(Math.max(i, 0), IMG_IDLE_FUNS.length - 1)];
  }

  /** 把探测到的可用前缀应用到所有素材常量上 */
  function applyAssetBase(base) {
    if (!base || base === ASSET_DIR_RESOLVED) return false;
    ASSET_DIR_RESOLVED = base;
    ASSET_SPRITE = base + 'feiyu-spritesheet.webp';
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

  /* ======== src/core/zipread.js ======== */
/* ============================================================================
 * pet-buddy · 共享核心（core）· ZIP 包读取（v4.2：上传 zip 模型包，自动挑出里面的图片）
 * ----------------------------------------------------------------------------
 * 场景：用户从网上下载的桌宠模型常是 zip（源码仓 zip、素材打包 zip），里面混着代码与图片。
 *      模型管理里直接选 zip → 这里解析出图片条目清单 → 用户挑一张 → 解压成 dataUrl，
 *      之后走与「上传图片」完全相同的路径（动画判定 / 2MB·4MB 上限 / localStorage 容量预检）。
 * 实现：纯手工解析 ZIP 结构（EOCD → central directory → local file header），
 *      解压用浏览器/Node 内置的 DecompressionStream('deflate-raw')——零第三方依赖、纯离线。
 * 限制：不支持 zip64（>4GB 或 >65535 条目）与加密包；rar/7z 不在浏览器能力范围内（先转 zip）。
 * 约束：只写顶层 const / function；不 import / 不 export；await 只在 async 函数里。
 * ==========================================================================*/

  /* ---- 二进制读取小工具（ZIP 头都是小端） ---- */
  function zipU16(v, p) { return v[p] | (v[p + 1] << 8); }
  function zipU32(v, p) { return (v[p] | (v[p + 1] << 8) | (v[p + 2] << 16) | (v[p + 3] << 24)) >>> 0; }

  /** 从 ArrayBuffer 解析条目清单：[{name, size, csize, method, offset}]（只读目录，不解压数据） */
  function zipEntries(buf) {
    const v = new Uint8Array(buf);
    const n = v.length;
    if (n < 22 || zipU32(v, 0) !== 0x04034b50) throw new Error('这不是 zip 包（缺 PK 头）');
    /* 1) 从尾部往前找 EOCD（0x06054b50；后面可能跟着最多 64KB 的注释） */
    let eocd = -1;
    for (let i = n - 22; i >= Math.max(0, n - 22 - 65536); i--) {
      if (v[i] === 0x50 && v[i + 1] === 0x4b && zipU16(v, i + 2) === 0x0605) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('zip 目录读不到（EOCD 未找到）');
    const count = zipU16(v, eocd + 10);
    let cdSize = zipU32(v, eocd + 12), cdOff = zipU32(v, eocd + 16);
    if (count === 0xFFFF || cdSize === 0xFFFFFFFF || cdOff === 0xFFFFFFFF)
      throw new Error('zip64 包暂不支持：请先解压出来，再挑里面的图上传');
    /* 2) 逐条读 central directory（签名 0x02014b50，固定头 46 字节 + 名 + extra + 注释） */
    const decoder = new TextDecoder();
    const out = [];
    let p = cdOff;
    for (let i = 0; i < count; i++) {
      if (p + 46 > n || zipU32(v, p) !== 0x02014b50) throw new Error('zip 目录损坏（第 ' + (i + 1) + ' 条对不上）');
      const method = zipU16(v, p + 10);
      const csize = zipU32(v, p + 20);
      const size = zipU32(v, p + 24);
      const nameLen = zipU16(v, p + 28);
      const extraLen = zipU16(v, p + 30);
      const commentLen = zipU16(v, p + 32);
      const offset = zipU32(v, p + 42);
      const name = decoder.decode(v.subarray(p + 46, p + 46 + nameLen));
      if (method === 99) throw new Error('这个 zip 加密了（AES），解不开：请用不加密的 zip');
      if ((zipU16(v, p + 8) & 0x1) === 0) out.push({ name: name, size: size, csize: csize, method: method, offset: offset });
      /* 带加密 flag（bit0）的条目直接跳过，不让它出现在可选列表里 */
      p += 46 + nameLen + extraLen + commentLen;
    }
    return out;
  }

  /** 条目是不是能当皮肤的图片（png/gif/webp/jpg；排除 macOS 垃圾目录与隐藏文件） */
  function zipImageEntries(entries, maxSize) {
    const lim = maxSize || 8 * 1024 * 1024;
    return (entries || []).filter(function (e) {
      if (!e || !e.name || e.size > lim || e.size < 64) return false;
      const low = e.name.toLowerCase();
      if (low.indexOf('__macosx/') >= 0 || low.split('/').pop().charAt(0) === '.') return false;
      return /\.(png|gif|webp|jpe?g|apng)$/.test(low);
    });
  }

  /** raw deflate 解压（内置 DecompressionStream；不支持时给人话错误） */
  async function zipInflateRaw(u8) {
    if (typeof DecompressionStream !== 'function')
      throw new Error('当前内核不支持解压 zip（需要较新的 Edge/Chrome）');
    const ds = new DecompressionStream('deflate-raw');
    const wr = ds.writable.getWriter();
    const pump = wr.write(u8).then(function () { return wr.close(); }).catch(function () { /* 读端报错即可 */ });
    const rd = ds.readable.getReader();
    const chunks = [];
    for (;;) {
      const r = await rd.read();
      if (r.done) break;
      chunks.push(r.value);
    }
    await pump.catch(function () { /* 解压失败在下面统一报 */ });
    let total = 0;
    for (const c of chunks) total += c.length;
    const out = new Uint8Array(total);
    let pos = 0;
    for (const c of chunks) { out.set(c, pos); pos += c.length; }
    return out;
  }

  /** 解压单个条目 → Uint8Array（stored 直取；deflate 走 DecompressionStream） */
  async function zipExtract(buf, entry) {
    const v = new Uint8Array(buf);
    const p = entry.offset;
    if (zipU32(v, p) !== 0x04034b50) throw new Error('条目定位失败（包可能不完整）');
    const nameLen = zipU16(v, p + 26);
    const extraLen = zipU16(v, p + 28);
    const start = p + 30 + nameLen + extraLen;
    const data = v.subarray(start, start + entry.csize);
    if (entry.method === 0) return data;                    // stored：原样
    if (entry.method === 8) return await zipInflateRaw(data); // deflate
    throw new Error('不支持的压缩方法（' + entry.method + '）');
  }

  /** Uint8Array → dataUrl（按扩展名给 MIME；base64 手工编，不依赖 FileReader） */
  function zipBytesToDataUrl(bytes, name) {
    const low = String(name || '').toLowerCase();
    const mime = /\.gif$/.test(low) ? 'image/gif' : /\.webp$/.test(low) ? 'image/webp'
      : /\.jpe?g$/.test(low) ? 'image/jpeg' : 'image/png';
    let s = '';
    const CH = 32768;
    for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return 'data:' + mime + ';base64,' + btoa(s);
  }

  /* ======== src/core/deliver.js ======== */
/* ============================================================================
 * pet-buddy · 共享核心（core）· 交付成果（对话产出的文件）
 * ----------------------------------------------------------------------------
 * 场景：助手在对话里产出文件（图片、折线图、表格、文档、网页…），回复中会带上本地绝对路径
 *      （如 C:\Users\JXKJ1\Documents\坚祥数字助理\我的花费折线图_20261106-1119.png）。
 *      本模块把这类路径认出来，渲染成「成果卡片」——文件名 + 完整路径 + 复制路径 / 打开，
 *      让用户能立刻拿到文件位置（气泡聊天面板与独立聊天窗口共用这一份）。
 * 只认常见成果扩展名：正文里的「v4.2」「node.js」之类不会被误判。
 * 约束：只写顶层 const / function；不 import / 不 export；只用 DOM 与标准 Web API。
 * ==========================================================================*/

  /* ---- 识别 ---- */
  const DELIVER_EXTS = {
    image: 'png jpg jpeg gif webp bmp svg ico',
    sheet: 'xlsx xls csv',
    doc:   'docx doc pdf md txt',
    slide: 'pptx ppt',
    web:   'html htm mhtml',
    archive: 'zip 7z rar',
    media: 'mp4 mov mkv wav mp3 m4a',
    code:  'py js mjs ts json yml yaml',
  };
  const DELIVER_EXT_LIST = Object.keys(DELIVER_EXTS)
    .reduce((acc, k) => acc.concat(DELIVER_EXTS[k].split(' ')), []);
  /* 路径体：不以换行/制表/引号/尖括号/竖线/问号/星号/冒号中断，非贪婪到扩展名收尾（支持中文与空格） */
  const DELIVER_RE = new RegExp(
    '(?:file:\\/\\/\\/)?([A-Za-z]:[\\\\/][^\\r\\n\\t"\'<>|?*:]*?\\.(?:' + DELIVER_EXT_LIST.join('|') + '))(?![\\w])', 'gi');

  /** 按扩展名归大类（决定卡片图标）：image/sheet/doc/slide/web/archive/media/code/other */
  function fileKindOf(ext) {
    const e = String(ext || '').toLowerCase();
    for (const k of Object.keys(DELIVER_EXTS)) if (DELIVER_EXTS[k].split(' ').indexOf(e) >= 0) return k;
    return 'other';
  }

  /** 从一段文本里抽出本地成果文件：[{path, name, ext, kind}]（去重，保持出现顺序） */
  function extractFilePaths(text) {
    const s = String(text == null ? '' : text);
    const out = [], seen = {};
    DELIVER_RE.lastIndex = 0;
    let m;
    while ((m = DELIVER_RE.exec(s))) {
      const p = String(m[1]).replace(/[，。；：、）》】」]+$/, '');
      const key = p.toLowerCase();
      if (seen[key]) continue;
      seen[key] = 1;
      const name = p.split(/[\\/]/).pop() || p;
      const dot = name.lastIndexOf('.');
      const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
      out.push({ path: p, name: name, ext: ext, kind: fileKindOf(ext) });
    }
    return out;
  }

  /** Windows 路径 → file:// URL（「打开」按钮尝试用；打不开时上层提示复制路径） */
  function pathToFileUrl(p) {
    const s = String(p || '').replace(/\\/g, '/');
    return 'file:///' + s.replace(/^\/+/, '');
  }

  /* ---- 渲染（自绘图标，零素材依赖） ---- */
  const DELIVER_SVG = {
    image: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="1.8" y="2.6" width="12.4" height="10.8" rx="2"/><circle cx="5.7" cy="6.3" r="1.1" fill="currentColor" stroke="none"/><path d="M2.6 12.6l3.4-3.6 2.4 2.4 2.3-2.3 2.7 2.7"/></svg>',
    sheet: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="2" y="2.6" width="12" height="10.8" rx="1.6"/><path d="M2 6.2h12M6.2 6.2v7.2M10.1 6.2v7.2"/></svg>',
    doc:   '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M4.2 1.9h4.9L12.9 5.6v8.5H4.2z"/><path d="M9 1.9v3.8h3.8M6.1 8.6h3.8M6.1 11h3.8"/></svg>',
    slide: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="1.8" y="2.8" width="12.4" height="8.4" rx="1.4"/><path d="M8 11.2v2.4M5.4 13.6h5.2"/></svg>',
    web:   '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="8" cy="8" r="6"/><path d="M2 8h12M8 2c2.3 2.6 2.3 9.4 0 12M8 2c-2.3 2.6-2.3 9.4 0 12"/></svg>',
    archive: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="2.2" y="2.6" width="11.6" height="10.8" rx="1.6"/><path d="M8 2.6v2.6M8 6.4v1.8M8 9.4v1.8"/></svg>',
    media: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="1.8" y="3.2" width="12.4" height="9.6" rx="1.6"/><path d="M6.6 6.1l3.8 1.9-3.8 1.9z" fill="currentColor" stroke="none"/></svg>',
    code:  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M5.6 5.1L2.7 8l2.9 2.9M10.4 5.1L13.3 8l-2.9 2.9"/></svg>',
    other: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M4.2 1.9h4.9L12.9 5.6v8.5H4.2z"/><path d="M9 1.9v3.8h3.8"/></svg>',
  };

  /** 复制文本：优先 clipboard API，失败回落 textarea + execCommand（老内核/非安全上下文） */
  function copyPlainText(s, btn, onFail) {
    const done = () => { if (btn) { btn.textContent = '已复制'; setTimeout(() => { if (btn.textContent === '已复制') btn.textContent = '复制路径'; }, 1500); } };
    try {
      if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(s).then(done, () => legacyCopyText(s, done, onFail));
        return;
      }
    } catch (e) { /* 继续回落 */ }
    legacyCopyText(s, done, onFail);
  }
  function legacyCopyText(s, done, onFail) {
    try {
      const ta = document.createElement('textarea');
      ta.value = s;
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); done();
    } catch (e) { if (onFail) onFail(); }
  }

  /** 尝试打开本地文件：先把路径复制好，再试 file://（多数宿主页不允许，失败由 onFail 提示） */
  function openLocalPath(p, onFail) {
    copyPlainText(p, null, null);
    let opened = false;
    try { opened = !!window.open(pathToFileUrl(p), '_blank'); } catch (e) { opened = false; }
    if (!opened && onFail) onFail();
  }

  /** 单张成果卡片（DOM）：图标 + 文件名 + 路径 + 复制/打开 */
  function makeDeliverCard(f, onFail) {
    const card = document.createElement('div');
    card.className = 'pb2-deliv';
    const ico = document.createElement('span');
    ico.className = 'pb2-deliv-ico';
    ico.innerHTML = DELIVER_SVG[f.kind] || DELIVER_SVG.other;   // 自家常量 SVG，不含用户数据
    card.appendChild(ico);
    const mid = document.createElement('div');
    mid.className = 'pb2-deliv-mid';
    const nm = document.createElement('div');
    nm.className = 'pb2-deliv-name'; nm.textContent = f.name; nm.title = f.path;
    const pt = document.createElement('div');
    pt.className = 'pb2-deliv-path'; pt.textContent = f.path; pt.title = f.path;
    mid.appendChild(nm); mid.appendChild(pt);
    card.appendChild(mid);
    const copy = document.createElement('button');
    copy.type = 'button'; copy.className = 'pb2-deliv-btn'; copy.textContent = '复制路径'; copy.title = '复制完整路径';
    copy.addEventListener('click', (ev) => { ev.stopPropagation(); copyPlainText(f.path, copy, onFail); });
    card.appendChild(copy);
    const open = document.createElement('button');
    open.type = 'button'; open.className = 'pb2-deliv-btn'; open.textContent = '打开';
    open.title = '尝试用默认程序打开（本页可能不允许；失败时路径已复制）';
    open.addEventListener('click', (ev) => { ev.stopPropagation(); openLocalPath(f.path, onFail); });
    card.appendChild(open);
    return card;
  }

  /** 把文本里的成果文件渲染成卡片追加到 host；返回识别到的文件数（0 = 没动 DOM）。
   *  onFail = 打不开本地文件时的提示回调（各端文案不同：桌宠弹气泡，网页窗口用页内提示）。 */
  function renderDeliverables(host, text, onFail) {
    const files = extractFilePaths(text);
    if (!files.length || !host) return 0;
    const box = document.createElement('div');
    box.className = 'pb2-deliv-box';
    for (const f of files) box.appendChild(makeDeliverCard(f, onFail));
    host.appendChild(box);
    return files.length;
  }

  /* ======== src/core/petpack.js ======== */
/* ============================================================================
 * pet-buddy · 共享核心（core）· 宠物动作包（petpack）
 * ----------------------------------------------------------------------------
 * 「动作包」= 一整套动作视频（VP9-alpha webm，平铺在插件根目录，宿主只服务根级文件）
 *            + 语义角色映射（每个动作属于 idle / 点击 / 拖拽 / 余额档位 / 随机表演 / 睡觉…）。
 * 数据从模型包（dsh-pet 格式 zip：assets/webm + assets/config.jsonc）整合而来，
 * 由 tools/import-petpack.mjs 生成（含转码参数、体积、来源记录）——数据段勿手改，重跑脚本即可。
 * 本文件只放「取值与挑选」（DOM 无关，两端可用）；视频播放与调度在 pet.client.js 的 petpack 段。
 * 约束：只写顶层 const / function；不 import / 不 export。
 * ==========================================================================*/

  /* @@PETPACK-DATA-START@@（由 tools/import-petpack.mjs 生成，勿手改） */
  const PETPACKS = {
   "dshpack": {
    "id": "dshpack",
    "name": "大肥鱼·鲸鲸娘（完整动作包）",
    "source": "dsh-pet-source.zip",
    "importedAt": "2026-11-19 15:26:06",
    "params": {
     "width": 160,
     "fps": 12,
     "crf": 45,
     "crop": [
      0.62,
      0.92
     ],
     "codec": "vp9-alpha"
    },
    "thumb": "dp-thumb.png",
    "srcTotalKB": 56479,
    "outTotalKB": 6639,
    "actions": [
     {
      "file": "dp-001.webm",
      "name": "三球抛接",
      "role": "random",
      "srcKB": 536,
      "outKB": 65
     },
     {
      "file": "dp-002.webm",
      "name": "下五子棋",
      "role": "random",
      "srcKB": 503,
      "outKB": 55
     },
     {
      "file": "dp-003.webm",
      "name": "东张西望",
      "role": "turn",
      "srcKB": 417,
      "outKB": 51
     },
     {
      "file": "dp-004.webm",
      "name": "中秋赏月吃月饼",
      "role": "random",
      "srcKB": 500,
      "outKB": 55
     },
     {
      "file": "dp-005.webm",
      "name": "优雅女仆舞",
      "role": "random",
      "srcKB": 565,
      "outKB": 68
     },
     {
      "file": "dp-006.webm",
      "name": "余额-分文不剩",
      "role": "balance",
      "srcKB": 479,
      "outKB": 57
     },
     {
      "file": "dp-007.webm",
      "name": "余额-数金皱眉",
      "role": "balance",
      "srcKB": 312,
      "outKB": 31
     },
     {
      "file": "dp-008.webm",
      "name": "余额-袋空如洗",
      "role": "balance",
      "srcKB": 374,
      "outKB": 42
     },
     {
      "file": "dp-009.webm",
      "name": "余额-金袋叮当",
      "role": "balance",
      "srcKB": 519,
      "outKB": 68
     },
     {
      "file": "dp-010.webm",
      "name": "余额-钱袋如常",
      "role": "balance",
      "srcKB": 378,
      "outKB": 46
     },
     {
      "file": "dp-011.webm",
      "name": "余额-钱袋满溢",
      "role": "balance",
      "srcKB": 608,
      "outKB": 87
     },
     {
      "file": "dp-012.webm",
      "name": "侧身急躁跑",
      "role": "baifan",
      "srcKB": 718,
      "outKB": 94
     },
     {
      "file": "dp-013.webm",
      "name": "偷吃零食被抓住",
      "role": "random",
      "srcKB": 422,
      "outKB": 47
     },
     {
      "file": "dp-014.webm",
      "name": "写代码",
      "role": "random",
      "srcKB": 375,
      "outKB": 41
     },
     {
      "file": "dp-015.webm",
      "name": "写福字",
      "role": "random",
      "srcKB": 489,
      "outKB": 56
     },
     {
      "file": "dp-016.webm",
      "name": "凭空生花",
      "role": "random",
      "srcKB": 606,
      "outKB": 81
     },
     {
      "file": "dp-017.webm",
      "name": "动物环绕",
      "role": "random",
      "srcKB": 958,
      "outKB": 140
     },
     {
      "file": "dp-018.webm",
      "name": "原地专心玩魔方",
      "role": "random",
      "srcKB": 433,
      "outKB": 47
     },
     {
      "file": "dp-019.webm",
      "name": "原地小憩沉眠",
      "role": "random",
      "srcKB": 424,
      "outKB": 48
     },
     {
      "file": "dp-020.webm",
      "name": "原地左转奔跑",
      "role": "moves",
      "srcKB": 600,
      "outKB": 76
     },
     {
      "file": "dp-021.webm",
      "name": "原地敲击桌面互动",
      "role": "random",
      "srcKB": 394,
      "outKB": 42
     },
     {
      "file": "dp-022.webm",
      "name": "原地漂浮踏步",
      "role": "moves",
      "srcKB": 578,
      "outKB": 63
     },
     {
      "file": "dp-023.webm",
      "name": "原地跳跃抓碎头顶物品",
      "role": "random",
      "srcKB": 605,
      "outKB": 76
     },
     {
      "file": "dp-024.webm",
      "name": "原地蹲下玩玩具汽车",
      "role": "random",
      "srcKB": 493,
      "outKB": 63
     },
     {
      "file": "dp-025.webm",
      "name": "原地重力下蹲压缩",
      "role": "random",
      "srcKB": 210,
      "outKB": 26
     },
     {
      "file": "dp-026.webm",
      "name": "变鸽子",
      "role": "random",
      "srcKB": 498,
      "outKB": 63
     },
     {
      "file": "dp-027.webm",
      "name": "可爱宅舞",
      "role": "random",
      "srcKB": 563,
      "outKB": 59
     },
     {
      "file": "dp-028.webm",
      "name": "吃Token",
      "role": "random",
      "srcKB": 561,
      "outKB": 63
     },
     {
      "file": "dp-029.webm",
      "name": "吃冰淇淋融化",
      "role": "random",
      "srcKB": 498,
      "outKB": 57
     },
     {
      "file": "dp-030.webm",
      "name": "吃午餐",
      "role": "random",
      "srcKB": 484,
      "outKB": 54
     },
     {
      "file": "dp-031.webm",
      "name": "吃大闸蟹",
      "role": "random",
      "srcKB": 533,
      "outKB": 60
     },
     {
      "file": "dp-032.webm",
      "name": "吃年糕",
      "role": "random",
      "srcKB": 441,
      "outKB": 50
     },
     {
      "file": "dp-033.webm",
      "name": "吃早餐",
      "role": "random",
      "srcKB": 431,
      "outKB": 50
     },
     {
      "file": "dp-034.webm",
      "name": "吃晚餐",
      "role": "random",
      "srcKB": 725,
      "outKB": 100
     },
     {
      "file": "dp-035.webm",
      "name": "吃汤圆",
      "role": "random",
      "srcKB": 427,
      "outKB": 47
     },
     {
      "file": "dp-036.webm",
      "name": "吃白饭",
      "role": "random",
      "srcKB": 449,
      "outKB": 47
     },
     {
      "file": "dp-037.webm",
      "name": "吃粽子",
      "role": "random",
      "srcKB": 436,
      "outKB": 47
     },
     {
      "file": "dp-038.webm",
      "name": "吃糖葫芦",
      "role": "random",
      "srcKB": 459,
      "outKB": 51
     },
     {
      "file": "dp-039.webm",
      "name": "吃腊八粥",
      "role": "random",
      "srcKB": 450,
      "outKB": 51
     },
     {
      "file": "dp-040.webm",
      "name": "吃西瓜",
      "role": "random",
      "srcKB": 472,
      "outKB": 54
     },
     {
      "file": "dp-041.webm",
      "name": "吃重阳糕",
      "role": "random",
      "srcKB": 458,
      "outKB": 50
     },
     {
      "file": "dp-042.webm",
      "name": "吃长寿面",
      "role": "random",
      "srcKB": 478,
      "outKB": 56
     },
     {
      "file": "dp-043.webm",
      "name": "吃青团",
      "role": "random",
      "srcKB": 369,
      "outKB": 38
     },
     {
      "file": "dp-044.webm",
      "name": "吃饭·碗饭",
      "role": "baifan",
      "srcKB": 426,
      "outKB": 24
     },
     {
      "file": "dp-045.webm",
      "name": "吃饭团",
      "role": "baifan",
      "srcKB": 410,
      "outKB": 28
     },
     {
      "file": "dp-046.webm",
      "name": "吃饺子",
      "role": "random",
      "srcKB": 542,
      "outKB": 65
     },
     {
      "file": "dp-047.webm",
      "name": "吹气球",
      "role": "random",
      "srcKB": 733,
      "outKB": 88
     },
     {
      "file": "dp-048.webm",
      "name": "吹笛子",
      "role": "random",
      "srcKB": 750,
      "outKB": 98
     },
     {
      "file": "dp-049.webm",
      "name": "哈欠连天",
      "role": "random",
      "srcKB": 414,
      "outKB": 49
     },
     {
      "file": "dp-050.webm",
      "name": "堆雪人",
      "role": "random",
      "srcKB": 507,
      "outKB": 63
     },
     {
      "file": "dp-051.webm",
      "name": "大口吃零食",
      "role": "random",
      "srcKB": 788,
      "outKB": 108
     },
     {
      "file": "dp-052.webm",
      "name": "女仆屈膝礼仪",
      "role": "random",
      "srcKB": 357,
      "outKB": 38
     },
     {
      "file": "dp-053.webm",
      "name": "小幅度原地360度旋转展示",
      "role": "random",
      "srcKB": 572,
      "outKB": 75
     },
     {
      "file": "dp-054.webm",
      "name": "小提琴演奏",
      "role": "random",
      "srcKB": 591,
      "outKB": 71
     },
     {
      "file": "dp-055.webm",
      "name": "工作状态-原地踱步张望",
      "role": "workStatus",
      "srcKB": 461,
      "outKB": 50
     },
     {
      "file": "dp-056.webm",
      "name": "工作状态-垂头叹气冒汗",
      "role": "workStatus",
      "srcKB": 194,
      "outKB": 25
     },
     {
      "file": "dp-057.webm",
      "name": "工作状态-忙碌点按",
      "role": "workStatus",
      "srcKB": 464,
      "outKB": 48
     },
     {
      "file": "dp-058.webm",
      "name": "工作状态-思考冒泡",
      "role": "workStatus",
      "srcKB": 399,
      "outKB": 52
     },
     {
      "file": "dp-059.webm",
      "name": "工作状态-清点归档",
      "role": "workStatus",
      "srcKB": 354,
      "outKB": 37
     },
     {
      "file": "dp-060.webm",
      "name": "工作状态-雀跃庆祝",
      "role": "workStatus",
      "srcKB": 477,
      "outKB": 58
     },
     {
      "file": "dp-061.webm",
      "name": "开心小跑",
      "role": "baifan",
      "srcKB": 521,
      "outKB": 55
     },
     {
      "file": "dp-062.webm",
      "name": "待机呼吸休闲",
      "role": "idle",
      "srcKB": 431,
      "outKB": 49
     },
     {
      "file": "dp-063.webm",
      "name": "悠闲哼歌",
      "role": "random",
      "srcKB": 570,
      "outKB": 68
     },
     {
      "file": "dp-064.webm",
      "name": "扑克魔术",
      "role": "random",
      "srcKB": 451,
      "outKB": 52
     },
     {
      "file": "dp-065.webm",
      "name": "打瞌睡被惊醒",
      "role": "random",
      "srcKB": 443,
      "outKB": 50
     },
     {
      "file": "dp-066.webm",
      "name": "抽陀螺",
      "role": "random",
      "srcKB": 509,
      "outKB": 60
     },
     {
      "file": "dp-067.webm",
      "name": "拆礼物",
      "role": "random",
      "srcKB": 506,
      "outKB": 63
     },
     {
      "file": "dp-068.webm",
      "name": "插茱萸赏菊",
      "role": "random",
      "srcKB": 475,
      "outKB": 55
     },
     {
      "file": "dp-069.webm",
      "name": "摇扇纳凉",
      "role": "random",
      "srcKB": 498,
      "outKB": 60
     },
     {
      "file": "dp-070.webm",
      "name": "撸猫",
      "role": "random",
      "srcKB": 340,
      "outKB": 36
     },
     {
      "file": "dp-071.webm",
      "name": "收红包",
      "role": "random",
      "srcKB": 461,
      "outKB": 49
     },
     {
      "file": "dp-072.webm",
      "name": "放孔明灯",
      "role": "random",
      "srcKB": 580,
      "outKB": 70
     },
     {
      "file": "dp-073.webm",
      "name": "放河灯",
      "role": "random",
      "srcKB": 370,
      "outKB": 38
     },
     {
      "file": "dp-074.webm",
      "name": "放烟花",
      "role": "random",
      "srcKB": 1299,
      "outKB": 165
     },
     {
      "file": "dp-075.webm",
      "name": "放风筝",
      "role": "random",
      "srcKB": 752,
      "outKB": 99
     },
     {
      "file": "dp-076.webm",
      "name": "整体换装试色",
      "role": "random",
      "srcKB": 512,
      "outKB": 70
     },
     {
      "file": "dp-077.webm",
      "name": "是啊，吃什么",
      "role": "random",
      "srcKB": 574,
      "outKB": 62
     },
     {
      "file": "dp-078.webm",
      "name": "晨间刷牙",
      "role": "random",
      "srcKB": 415,
      "outKB": 42
     },
     {
      "file": "dp-079.webm",
      "name": "期待开饭",
      "role": "baifan",
      "srcKB": 399,
      "outKB": 27
     },
     {
      "file": "dp-080.webm",
      "name": "涮火锅",
      "role": "random",
      "srcKB": 456,
      "outKB": 53
     },
     {
      "file": "dp-081.webm",
      "name": "深度思考碎碎念",
      "role": "random",
      "srcKB": 423,
      "outKB": 50
     },
     {
      "file": "dp-082.webm",
      "name": "点击回应-傲娇生气",
      "role": "clicks",
      "srcKB": 383,
      "outKB": 50
     },
     {
      "file": "dp-083.webm",
      "name": "点击回应-元气挥手",
      "role": "clicks",
      "srcKB": 412,
      "outKB": 46
     },
     {
      "file": "dp-084.webm",
      "name": "点击回应-害羞惊讶",
      "role": "clicks",
      "srcKB": 526,
      "outKB": 66
     },
     {
      "file": "dp-085.webm",
      "name": "点击回应-开心跃动",
      "role": "clicks",
      "srcKB": 525,
      "outKB": 62
     },
     {
      "file": "dp-086.webm",
      "name": "点击回应-挠痒咯咯笑",
      "role": "clicks",
      "srcKB": 415,
      "outKB": 43
     },
     {
      "file": "dp-087.webm",
      "name": "照镜子",
      "role": "random",
      "srcKB": 492,
      "outKB": 56
     },
     {
      "file": "dp-088.webm",
      "name": "玩水枪",
      "role": "random",
      "srcKB": 511,
      "outKB": 61
     },
     {
      "file": "dp-089.webm",
      "name": "玩游戏气急败坏",
      "role": "random",
      "srcKB": 513,
      "outKB": 56
     },
     {
      "file": "dp-090.webm",
      "name": "用鲸鱼尾巴拍打地面",
      "role": "random",
      "srcKB": 344,
      "outKB": 35
     },
     {
      "file": "dp-091.webm",
      "name": "睡觉-开始",
      "role": "sleep.start",
      "srcKB": 324,
      "outKB": 39
     },
     {
      "file": "dp-092.webm",
      "name": "睡觉-循环",
      "role": "sleep.loop",
      "srcKB": 231,
      "outKB": 27
     },
     {
      "file": "dp-093.webm",
      "name": "睡觉-起来",
      "role": "sleep.end",
      "srcKB": 371,
      "outKB": 44
     },
     {
      "file": "dp-094.webm",
      "name": "碎碎念-发呆碎碎念",
      "role": "whisper",
      "srcKB": 319,
      "outKB": 31
     },
     {
      "file": "dp-095.webm",
      "name": "碎碎念-对屏碎碎念",
      "role": "whisper",
      "srcKB": 356,
      "outKB": 30
     },
     {
      "file": "dp-096.webm",
      "name": "碎碎念-擦桌碎碎念",
      "role": "whisper",
      "srcKB": 342,
      "outKB": 36
     },
     {
      "file": "dp-097.webm",
      "name": "穿针乞巧",
      "role": "random",
      "srcKB": 470,
      "outKB": 57
     },
     {
      "file": "dp-098.webm",
      "name": "舞狮头",
      "role": "random",
      "srcKB": 617,
      "outKB": 80
     },
     {
      "file": "dp-099.webm",
      "name": "荡秋千",
      "role": "random",
      "srcKB": 629,
      "outKB": 74
     },
     {
      "file": "dp-100.webm",
      "name": "萌化小幽灵",
      "role": "random",
      "srcKB": 412,
      "outKB": 49
     },
     {
      "file": "dp-101.webm",
      "name": "蓝鲸现世",
      "role": "random",
      "srcKB": 472,
      "outKB": 64
     },
     {
      "file": "dp-102.webm",
      "name": "蝴蝶蜜蜂环绕头顶开花",
      "role": "random",
      "srcKB": 833,
      "outKB": 110
     },
     {
      "file": "dp-103.webm",
      "name": "螃蟹走路",
      "role": "moves",
      "srcKB": 583,
      "outKB": 73
     },
     {
      "file": "dp-104.webm",
      "name": "被吓一跳",
      "role": "random",
      "srcKB": 276,
      "outKB": 23
     },
     {
      "file": "dp-105.webm",
      "name": "被落叶淹没",
      "role": "random",
      "srcKB": 749,
      "outKB": 98
     },
     {
      "file": "dp-106.webm",
      "name": "被鼠标拖拽悬空反馈",
      "role": "drag",
      "srcKB": 454,
      "outKB": 50
     },
     {
      "file": "dp-107.webm",
      "name": "装点圣诞树",
      "role": "random",
      "srcKB": 799,
      "outKB": 108
     },
     {
      "file": "dp-108.webm",
      "name": "讨糖南瓜灯",
      "role": "random",
      "srcKB": 472,
      "outKB": 57
     },
     {
      "file": "dp-109.webm",
      "name": "超大伸懒腰",
      "role": "random",
      "srcKB": 388,
      "outKB": 43
     },
     {
      "file": "dp-110.webm",
      "name": "踢毽子",
      "role": "random",
      "srcKB": 519,
      "outKB": 60
     },
     {
      "file": "dp-111.webm",
      "name": "轻快摇摆舞",
      "role": "random",
      "srcKB": 530,
      "outKB": 55
     },
     {
      "file": "dp-112.webm",
      "name": "轻快记录",
      "role": "random",
      "srcKB": 437,
      "outKB": 49
     },
     {
      "file": "dp-113.webm",
      "name": "骑木马",
      "role": "random",
      "srcKB": 681,
      "outKB": 84
     },
     {
      "file": "dp-114.webm",
      "name": "鲸鱼吐泡泡特效",
      "role": "random",
      "srcKB": 442,
      "outKB": 51
     }
    ],
    "roles": {
     "idle": [
      "待机呼吸休闲"
     ],
     "turn": [
      "东张西望"
     ],
     "drag": [
      "被鼠标拖拽悬空反馈"
     ],
     "clicks": [
      "点击回应-开心跃动",
      "点击回应-害羞惊讶",
      "点击回应-傲娇生气",
      "点击回应-挠痒咯咯笑",
      "点击回应-元气挥手"
     ],
     "moves": [
      "螃蟹走路",
      "原地漂浮踏步",
      "原地左转奔跑"
     ],
     "balance": [
      "余额-钱袋满溢",
      "余额-金袋叮当",
      "余额-钱袋如常",
      "余额-数金皱眉",
      "余额-袋空如洗",
      "余额-分文不剩"
     ],
     "whisper": [
      "碎碎念-擦桌碎碎念",
      "碎碎念-发呆碎碎念",
      "碎碎念-对屏碎碎念"
     ],
     "workStatus": [
      "工作状态-思考冒泡",
      "工作状态-忙碌点按",
      "工作状态-清点归档",
      "工作状态-原地踱步张望",
      "工作状态-雀跃庆祝",
      "工作状态-垂头叹气冒汗"
     ],
     "sleep": {
      "start": [
       "睡觉-开始"
      ],
      "loop": [
       "睡觉-循环"
      ],
      "end": [
       "睡觉-起来"
      ]
     },
     "baifan": [
      "开心小跑",
      "侧身急躁跑",
      "期待开饭",
      "吃饭·碗饭",
      "吃饭团"
     ],
     "random": [
      {
       "name": "悠闲哼歌",
       "category": "小动作"
      },
      {
       "name": "超大伸懒腰",
       "category": "小动作"
      },
      {
       "name": "原地敲击桌面互动",
       "category": "小动作"
      },
      {
       "name": "原地重力下蹲压缩",
       "category": "小动作"
      },
      {
       "name": "哈欠连天",
       "category": "小动作"
      },
      {
       "name": "原地小憩沉眠",
       "category": "小动作"
      },
      {
       "name": "女仆屈膝礼仪",
       "category": "小动作"
      },
      {
       "name": "被吓一跳",
       "category": "小动作"
      },
      {
       "name": "小幅度原地360度旋转展示",
       "category": "小动作"
      },
      {
       "name": "偷吃零食被抓住",
       "category": "小动作"
      },
      {
       "name": "用鲸鱼尾巴拍打地面",
       "category": "小动作"
      },
      {
       "name": "打瞌睡被惊醒",
       "category": "小动作"
      },
      {
       "name": "照镜子",
       "category": "小动作"
      },
      {
       "name": "整体换装试色",
       "category": "小动作"
      },
      {
       "name": "轻快记录",
       "category": "小动作"
      },
      {
       "name": "写代码",
       "category": "小动作"
      },
      {
       "name": "摇扇纳凉",
       "category": "小动作"
      },
      {
       "name": "晨间刷牙",
       "category": "小动作"
      },
      {
       "name": "原地专心玩魔方",
       "category": "玩耍"
      },
      {
       "name": "原地蹲下玩玩具汽车",
       "category": "玩耍"
      },
      {
       "name": "鲸鱼吐泡泡特效",
       "category": "玩耍"
      },
      {
       "name": "原地跳跃抓碎头顶物品",
       "category": "玩耍"
      },
      {
       "name": "玩游戏气急败坏",
       "category": "玩耍"
      },
      {
       "name": "玩水枪",
       "category": "玩耍"
      },
      {
       "name": "小提琴演奏",
       "category": "玩耍"
      },
      {
       "name": "蓝鲸现世",
       "category": "玩耍"
      },
      {
       "name": "优雅女仆舞",
       "category": "玩耍"
      },
      {
       "name": "轻快摇摆舞",
       "category": "玩耍"
      },
      {
       "name": "可爱宅舞",
       "category": "玩耍"
      },
      {
       "name": "吹气球",
       "category": "玩耍"
      },
      {
       "name": "动物环绕",
       "category": "玩耍"
      },
      {
       "name": "放风筝",
       "category": "玩耍"
      },
      {
       "name": "拆礼物",
       "category": "玩耍"
      },
      {
       "name": "变鸽子",
       "category": "玩耍"
      },
      {
       "name": "扑克魔术",
       "category": "玩耍"
      },
      {
       "name": "抽陀螺",
       "category": "玩耍"
      },
      {
       "name": "吹笛子",
       "category": "玩耍"
      },
      {
       "name": "蝴蝶蜜蜂环绕头顶开花",
       "category": "玩耍"
      },
      {
       "name": "撸猫",
       "category": "玩耍"
      },
      {
       "name": "凭空生花",
       "category": "玩耍"
      },
      {
       "name": "骑木马",
       "category": "玩耍"
      },
      {
       "name": "三球抛接",
       "category": "玩耍"
      },
      {
       "name": "踢毽子",
       "category": "玩耍"
      },
      {
       "name": "下五子棋",
       "category": "玩耍"
      },
      {
       "name": "荡秋千",
       "category": "玩耍"
      },
      {
       "name": "吃白饭",
       "category": "吃什么"
      },
      {
       "name": "大口吃零食",
       "category": "吃什么"
      },
      {
       "name": "吃Token",
       "category": "吃什么"
      },
      {
       "name": "吃早餐",
       "category": "吃什么"
      },
      {
       "name": "吃午餐",
       "category": "吃什么"
      },
      {
       "name": "吃晚餐",
       "category": "吃什么"
      },
      {
       "name": "吃冰淇淋融化",
       "category": "吃什么"
      },
      {
       "name": "吃大闸蟹",
       "category": "吃什么"
      },
      {
       "name": "吃糖葫芦",
       "category": "吃什么"
      },
      {
       "name": "吃长寿面",
       "category": "吃什么"
      },
      {
       "name": "吃西瓜",
       "category": "吃什么"
      },
      {
       "name": "涮火锅",
       "category": "吃什么"
      },
      {
       "name": "被落叶淹没",
       "category": "时节"
      },
      {
       "name": "中秋赏月吃月饼",
       "category": "时节"
      },
      {
       "name": "堆雪人",
       "category": "时节"
      },
      {
       "name": "放烟花",
       "category": "时节"
      },
      {
       "name": "吃粽子",
       "category": "时节"
      },
      {
       "name": "吃年糕",
       "category": "时节"
      },
      {
       "name": "吃青团",
       "category": "时节"
      },
      {
       "name": "吃腊八粥",
       "category": "时节"
      },
      {
       "name": "吃重阳糕",
       "category": "时节"
      },
      {
       "name": "收红包",
       "category": "时节"
      },
      {
       "name": "写福字",
       "category": "时节"
      },
      {
       "name": "穿针乞巧",
       "category": "时节"
      },
      {
       "name": "舞狮头",
       "category": "时节"
      },
      {
       "name": "讨糖南瓜灯",
       "category": "时节"
      },
      {
       "name": "插茱萸赏菊",
       "category": "时节"
      },
      {
       "name": "放河灯",
       "category": "时节"
      },
      {
       "name": "萌化小幽灵",
       "category": "时节"
      },
      {
       "name": "装点圣诞树",
       "category": "时节"
      },
      {
       "name": "放孔明灯",
       "category": "时节"
      },
      {
       "name": "吃汤圆",
       "category": "时节"
      },
      {
       "name": "吃饺子",
       "category": "时节"
      },
      {
       "name": "是啊，吃什么",
       "category": "文字"
      },
      {
       "name": "深度思考碎碎念",
       "category": "文字"
      }
     ]
    }
   }
  };
  /* @@PETPACK-DATA-END@@ */

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

  /** v3.8 余额文案格式表（标签给 UI 用） */
  const BALANCE_STYLES = [
    { id: 'short', label: '简洁' },
    { id: 'detail', label: '详细' },
    { id: 'playful', label: '傲娇' },
  ];

  /** v3.8 余额格式 id（非法值回退 short） */
  function balanceStyleId() {
    const s = String(settings.balanceStyle || 'short');
    return BALANCE_STYLES.some(x => x.id === s) ? s : 'short';
  }

  /* v3.8 余额文案三种格式（放 core 便于离线自检；pet.client.js 只负责切换 UI） */
  function balanceLine(d) {
    const c = d.credits || {};
    const q = d.companyQuota || {};
    const style = balanceStyleId();
    const per = perYuanCredits();
    const yuan = (pts) => fmtMoney(Math.round((Number(pts) / per) * 100) / 100);
    const todayReal = d.realOk ? fmtCredits(d.realToday || 0) : '';
    const todayEst = fmtCredits(d.costCredits || 0);
    // 余额主体（三种来源统一成一句话）
    const shortBase = q.ok ? '还剩 ' + fmtCredits(q.remainPoints) + ' 分 ≈' + yuan(q.remainPoints)
      : (c.ok && c.unlimited) ? '账户不限额'
        : c.ok ? '还剩 ' + fmtCredits(c.remainCredits) + ' 分'
          : Number(settings.quota) > 0 ? '额度 ' + fmtMoney(Number(settings.quota))
            : '额度未知';

    if (style === 'short') {
      return shortBase + (todayReal ? ' · 今日 +' + todayReal + ' 分' : (d.apiOk ? '' : ''));
    }
    if (style === 'playful') {
      const tails = ['省着点用哦～', '别太浪！', '够你用到月底啦～', '记得摸摸我～', '本小姐算得可准了'];
      const tail = tails[(new Date().getDate() + (d.sessions || 0)) % tails.length];
      if (q.ok) {
        return '哼哼，' + shortBase + (todayReal ? '，今天已经花掉 ' + todayReal + ' 分' : '') +
          '。月度就 ' + fmtCredits(q.points) + ' 分' + (q.periodText ? '，' + q.periodText + '刷新' : '') + '。' + tail;
      }
      return '哼，' + shortBase + (todayReal ? '，今天花掉 ' + todayReal + ' 分' : '') + '。' + tail;
    }
    // detail：完整口径（但比旧版短很多）
    const parts = [];
    if (q.ok) {
      parts.push('剩余 ' + fmtCredits(q.remainPoints) + ' / ' + fmtCredits(q.points) + ' 分（已用 ' + fmtCredits(q.usedPoints) + '）');
      if (q.periodText) parts.push(q.periodText + '刷新');
    } else if (c.ok && c.unlimited) {
      parts.push('账户不限额');
    } else if (c.ok) {
      parts.push('剩余积分 ' + fmtCredits(c.remainCredits));
    } else if (Number(settings.quota) > 0) {
      parts.push('自填额度 ' + fmtMoney(Number(settings.quota)));
    }
    if (todayReal) parts.push('今日 +' + todayReal + ' 分');
    parts.push('估算 ' + todayEst + ' 分（' + (d.sessions || 0) + ' 个新会话·' + (d.valley ? '谷' : '峰') + '价·入 ' + fmtTok(d.prompt) + '（命中 ' + fmtTok(d.cacheHit) + '）·出 ' + fmtTok(d.output) + '·' + d.calls + ' 次' + (d.staleSessions ? '；' + d.staleSessions + ' 个跨天会话未计入' : '') + '）');
    return parts.join(' ｜ ');
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
    // v4.1：数字本地化朗读——合成音念不出阿拉伯数字串（会挤成一声），转成中文读法。
    // <8 位按位值读（67834 → 六万七千八百三十四），≥8 位逐位读（手机号/时间戳类），
    // 小数部分一律逐位（67.83 → 六十七点八三）。
    t = t.replace(/\d{1,16}(?:\.\d{1,8})?/g, function (m) { return numToZh(m); });
    t = t.replace(/\s*｜\s*/g, '｜');                            // 停顿标记两侧不留空格
    const max = clamp(Math.round(Number(settings.speechMaxChars) || 60), 4, 400);
    if (t.length > max) t = t.slice(0, max).replace(/[，,、；;：:。.!！?？｜\s]+$/, '') + '……';
    return t;
  }

  /* ---- v4.1 数字 → 中文读法（只服务朗读，不上屏） ---- */
  const ZH_DIGITS = '零一二三四五六七八九';
  /** 1~4 位整数段 → 中文（六千七百八十三；10~19 的「一十」省成「十」） */
  function numZhSeg(seg) {
    const units = ['', '十', '百', '千'];
    let out = '', zeroPending = false;
    for (let i = 0; i < seg.length; i++) {
      const d = seg.charCodeAt(i) - 48;
      const u = seg.length - 1 - i;
      if (d === 0) { if (out) zeroPending = true; }
      else {
        if (zeroPending) { out += '零'; zeroPending = false; }
        if (d === 1 && u === 1 && !out) out += '十';        // 10~19 读「十x」不读「一十x」
        else out += ZH_DIGITS[d] + units[u];
      }
    }
    return out || '零';
  }
  /** 按位值读：万/亿分组（67834 → 六万七千八百三十四；100005 → 十万零五） */
  function numZhValue(s) {
    const groups = [];
    for (let i = s.length; i > 0; i -= 4) groups.unshift(s.slice(Math.max(0, i - 4), i));
    const gu = ['', '万', '亿', '兆'];
    let out = '', prevZero = false;
    for (let i = 0; i < groups.length; i++) {
      const g = numZhSeg(groups[i]);
      const isTop = i === 0;
      if (g === '零') { prevZero = !isTop; continue; }
      if (prevZero || (!isTop && groups[i].charAt(0) === '0')) out += '零';   // 跨组连接零（10001 → 一万零一）
      out += g + gu[groups.length - 1 - i];
      prevZero = false;
    }
    return out || '零';
  }
  /** 入口：'67834' → 六万七千八百三十四；'67.83' → 六十七点八三；'13800001111' → 逐位 */
  function numToZh(m) {
    const parts = String(m).split('.');
    let int = parts[0].replace(/^0+(?=\d)/, '');
    let out;
    if (!int) out = '零';                                  // 纯 '0' 或 '0xx'
    else if (int.length >= 8) {                            // 长号码/时间戳：逐位读更自然
      out = '';
      for (let i = 0; i < int.length; i++) out += ZH_DIGITS[int.charCodeAt(i) - 48];
    } else out = numZhValue(int);
    if (parts.length > 1 && parts[1]) {
      out += '点';
      for (let i = 0; i < parts[1].length; i++) out += ZH_DIGITS[parts[1].charCodeAt(i) - 48];
    }
    return out;
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
    parts.push('【交付文件 · 重要】你这次如果产出了文件（图片、折线图、表格、文档、网页等），' +
      '请在回复的最后单独一行只写这一行：📎 加完整绝对路径（例：📎 C:\\Users\\JXKJ1\\Documents\\坚祥数字助理\\我的花费折线图_20261106-1119.png）。' +
      '桌宠会把这一行渲染成可复制的成果卡片，用户点一下就能拿到路径找到文件；一行一个文件，最多 3 个。' +
      '没有产出文件时不要写这一行。');
    if (balanceBlock) parts.push(balanceBlock);
    parts.push('【用户说】' + userText);
    return parts.join('\n\n');
  }

  /* ---- v2.1.3 人设指纹：按子对话分别跟踪「该人设已全量发送」状态（LS_PSTATE 见 core/config.js） ----
   * 指纹 = hash(生效人设 + 昵称)；时段是易变信息不进指纹。
   * 编辑人设/昵称变化 → 指纹变 → 下一条自动全量重发；换模型=新子对话=天然首条。 */
  // v2.2.2：人设指纹加入 PROMPT_VER——首轮人设段落（贴纸教学等）改版后，
  // 老子对话也会自动全量重发一次新说明，无需用户手动操作
  const PROMPT_VER = '20261119-deliv';
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

  /* v3.9.1：判断一个称呼明显是"从聊天里截错的句子"（不是人名） */
  const NICK_VIRTUAL = /[们嘛吧呢吗啊呀哦的了着过谁说想把让给和跟在有没不就都也还又很太建群聊你我他]/;
  const NICK_BAD_HEAD = /^[们的个建是说想把让给和跟在有没不就都也还又很太]/;
  function nicknameLooksWrong(nick) {
    const s = String(nick == null ? '' : nick).trim();
    if (!s) return false;
    if (s.length > 6) return true;                     // 人名很少超过 6 个字
    if (NICK_BAD_HEAD.test(s)) return true;            // 「们建个营销群嘛」这种就是以虚词开头
    const hits = (s.match(new RegExp(NICK_VIRTUAL.source, 'g')) || []).length;
    if (hits >= 2) return true;                        // 一个名字里有两个以上虚词 → 肯定是句子
    return false;
  }

  function extractNickname(text) {
    // v3.9：① 用户在设置里手动设过称呼 → 锁定，不再被聊天内容改掉
    //         ② 只认「我叫/我是/叫我/喊我」+ 2~6 字，且名字里不能有虚词/代词/动词
    //         （之前的 1~12 字太宽，"我是我们建个营销群嘛"这种会被截成一句垃圾当名字）
    if (settings.nicknameLock) return null;
    const m = String(text == null ? '' : text).match(/(?:我叫|我是|叫我|喊我)\s*([\u4e00-\u9fa5A-Za-z0-9_·]{2,6})/);
    if (!m || !m[1]) return null;
    const name = m[1];
    if (nicknameLooksWrong(name)) return null;
    const old = settings.nickname;
    settings.nickname = name; saveSettings();
    return old === name ? null : name;
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

  /* ================= v4.3 动作包（petpack）：一整套动作视频 =================
   * 素材与语义清单来自模型包整合（src/core/petpack.js，由 tools/import-petpack.mjs 生成）。
   * 渲染：两个 <video> 双缓冲——换动作时等新视频就绪才切前景，避免闪一下白；
   *       idle 循环播放，一次性动作（点击/随机表演/余额）播完自动回到 idle。
   * 触发：点击（clicks）、拖动（drag）、余额（balance 分档）、空闲（random 随机表演）。
   * 视频为 VP9-alpha webm（Chromium 内核原生支持，透明通道保留）。 */
  let packCur = '';        // 当前动作包 id
  let packGen = 0;         // 换源世代号（丢弃迟到的加载结果）
  let packVideos = null;   // [A, B] 两个 video
  let packFront = 0;       // 当前前景槽位
  let packCurrent = '';    // 当前动作名（避免连着重复）
  let packErrWarned = false;

  function packOf(id) { return petpackById(String(id == null ? '' : id).replace(/^pack:/, '')); }

  function ensurePackVideos() {
    if (packVideos && packVideos[0] && packVideos[0].isConnected) return packVideos;
    packVideos = [0, 1].map(() => {
      const v = document.createElement('video');
      v.className = 'pb2-vid';
      v.muted = true; v.playsInline = true; v.preload = 'auto';
      v.setAttribute('muted', ''); v.setAttribute('playsinline', '');
      petWrap.appendChild(v);
      return v;
    });
    packFront = 0;
    return packVideos;
  }

  /** 播一个动作：once=true 播完回 idle（默认），false = 循环 */
  function packPlay(name, once) {
    const pack = packOf(settings.skin) || packOf(packCur);
    if (!pack || !name) return false;
    const act = petpackActionOf(pack, name);
    if (!act) return false;
    const vs = ensurePackVideos();
    const gen = ++packGen;
    const back = vs[1 - packFront];
    const prevFront = vs[packFront];
    packCurrent = name;
    const fin = () => {
      if (gen !== packGen) return;                 // 已被更新的换源取代
      const p = back.play();
      if (p && p.catch) p.catch(() => { /* 未解锁自动播放时静默：用户一点就会出声/动 */ });
      back.classList.add('pb2-vid-front');
      if (prevFront !== back) prevFront.classList.remove('pb2-vid-front');
      packFront = 1 - packFront;
      if (once) {
        const onEnd = () => { back.removeEventListener('ended', onEnd); if (gen === packGen) packPlayIdle(); };
        back.addEventListener('ended', onEnd);
      }
    };
    if (back.dataset.act === name && back.readyState >= 2) { back.currentTime = 0; fin(); return true; }
    back.dataset.act = name;
    back.loop = !once;
    back.oncanplay = fin;
    back.onerror = () => {
      if (packErrWarned) return;
      packErrWarned = true;
      log('error', '动作素材加载失败：' + act.file);
      bubbleSay('动作视频没读出来（' + act.file + '）——素材可能没同步全，先临时穿回官方形象', 5600);
      settings.skin = 'fish'; saveSettings();
      setTimeout(() => applySkin(), 60);
    };
    back.src = petpackFileUrl(act.file);
    back.load();
    return true;
  }

  function packPlayIdle() {
    const pack = packOf(settings.skin) || packOf(packCur);
    if (!pack) return;
    const name = petpackPick(pack, 'idle', packCurrent) || (pack.actions[0] && pack.actions[0].name);
    if (name) packPlay(name, false);
  }

  /** 按角色播一个动作（once 默认 true）；角色池空则返回 false 不做任何事 */
  function packRole(role, opts) {
    if (skinMode !== 'pack') return false;
    const pack = packOf(settings.skin);
    if (!pack) return false;
    const name = petpackPick(pack, role, packCurrent);
    if (!name) return false;
    return packPlay(name, !(opts && opts.loop));
  }

  /** 余额档位动作（balance 池按「已用档位」索引；池空则退回任意一次点击动作） */
  function packBalanceTier(tier) {
    if (skinMode !== 'pack') return false;
    const pack = packOf(settings.skin);
    if (!pack) return false;
    const name = petpackPickTier(pack, 'balance', tier, packCurrent);
    if (!name) return false;
    return packPlay(name, true);
  }

  /** 空闲随机表演（categories 池；比 CSS 小动作丰富得多） */
  function packRandomShow() {
    if (skinMode !== 'pack') return false;
    const pack = packOf(settings.skin);
    if (!pack) return false;
    const name = petpackPickRandom(pack, '', packCurrent);
    if (!name) return false;
    return packPlay(name, true);
  }

  /** 拖动中/松手：拖动池循环播，松手回 idle */
  function packDrag(on) {
    if (skinMode !== 'pack') return;
    if (on) { if (!packRole('drag', { loop: true })) packPlayIdle(); }
    else {
      // 拖动池里能循环的就一直循环，松手回 idle
      packPlayIdle();
    }
  }

  function applySkin() {
    const s = settings.skin || 'fish';
    const sp = SPRITE_SKINS[s];   // v3.3：精灵图皮肤（内置官方 / 社区桌宠包，同一套网格规格）
    const pk = packOf(s);         // v4.3：动作包皮肤（id 形如 pack:dshpack）
    petWrap.classList.remove('pb2-skin-fish', 'pb2-skin-img', 'pb2-skin-codex', 'pb2-skin-anim', 'pb2-skin-pack');
    if (pk) {
      skinMode = 'pack';
      packCur = pk.id;
      packCurrent = '';
      packErrWarned = false;
      packGen++;                       // 丢弃在途的旧素材加载
      petWrap.classList.add('pb2-skin-pack');
      ensurePackVideos();
      packPlayIdle();
      const iv = packVideos && packVideos.find(v => v.videoWidth);   // 尺寸就绪后重算 wrap 比例
      if (!iv) setTimeout(() => { if (skinMode === 'pack') refreshLayout(); }, 400);
    } else if (sp) {
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
      let url = '', anim = false;
      if (im) { url = assetUrl(im.file); anim = !!im.anim; }
      else {
        const c = (settings.customSkins || []).find(x => x.id === s);
        if (c) { url = c.dataUrl; anim = customSkinAnim(c); }   // v4.1：上传的 GIF/动画 WebP 也走这条路
      }
      petWrap.classList.toggle('pb2-skin-anim', anim);   // 动图不叠呼吸动画（和大人 120 帧同款处理）
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

  // 偶尔挥手/跳跃；v4.1 图片皮肤（含上传的动图）改用 CSS 整体小动作；
  // v4.3 动作包皮肤直接用包里的「随机表演」池（80 个动作，比 CSS 小动作丰富得多）
  function scheduleIdleFun() {
    setTimeout(() => {
      if (!settings.hidden && !drag && (!transient || performance.now() >= transientUntil)) {
        if (skinMode === 'pack') packRandomShow();
        else if (skinMode === 'img') petIdleFun();
        else { transient = Math.random() < 0.5 ? 'waving' : 'jumping'; transientUntil = performance.now() + 1500; }
      }
      scheduleIdleFun();
    }, 18000 + Math.random() * 22000);
  }
  scheduleIdleFun();

  /** v4.1 图片皮肤的空闲小动作：随机挑一个 CSS 动作类挂到 petWrap，一会儿自动摘掉。
   *  挂在 petWrap 上（呼吸/果冻在 viewport/imgSkin 上），两层动画互不打架；拖动中不打扰。 */
  let idleFunTimer = null;
  function petIdleFun() {
    if (idleFunTimer) return;                       // 上一段还没跳完
    const cls = pickIdleFunClass();
    petWrap.classList.add(cls);
    idleFunTimer = setTimeout(() => {
      petWrap.classList.remove(cls);
      idleFunTimer = null;
    }, 1800);
  }

  /* ---- 位置：默认右下角，吸附 + 记忆 ---- */
  /** v3.6.1：静态图皮肤按图片自身比例定 wrap 尺寸（否则横图/竖图与交互区对不上，看着"位置偏了"）
   *  v4.3：动作包按视频实际比例（首帧就绪后即可拿到，之前用实测兜底比例） */
  function petAspect() {
    if (skinMode === 'pack') {
      const v = packVideos && packVideos.find(x => x && x.videoWidth);
      if (v) return clamp(v.videoHeight / v.videoWidth, 0.45, 2.2);
      return 0.835;   // 160px 宽 × (0.92×360)/(0.62×640) 的实测比例
    }
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
  /* v4.3：气泡里也挂成果卡片（对话产出的文件路径 → 紧凑卡片，气泡小、以复制路径为主） */
  function bubbleSay(text, ms, noDeliv) {
    showBubble(b => {
      const t = $new('span', 'pb2-bubble-text');
      renderRich(t, text);
      b.appendChild(t);
      if (!noDeliv) { try { renderDeliverables(b, text, delivFailHint); } catch (e) { /* 卡片失败不影响气泡 */ } }
    }, ms || 4200);
  }

  /* ---- 单击 / 双击（260ms 区分） / 拖动 / 长按 / 连戳 ---- */
  let clickTimer = null, pendingSingle = null;
  let pendingSpecialLine = '';   // v3.10.1：连戳/摸头等特殊台词，交给下一次单击在同一气泡里说
  let drag = null;
  let suppressClickUntil = 0;
  let pokeCount = 0, pokeTimer = null;     // 连戳计数（1.4s 窗口）
  let holdTimer = null;                    // 长按（未拖动）摸头

  petWrap.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    speechUnlock(); // v3.2：点桌宠就是用户手势——顺手解锁音频（之后自动播报才出声）
    sfx('tap');     // v3.3：点桌宠一声「啵」
    jellyPulse();   // v3.9：配合音效做一下果冻挤压（可在菜单里关）
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
    if (skinMode === 'pack' && !drag.packDragging) { drag.packDragging = true; packDrag(true); }   // v4.3：拖动动作
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
      if (skinMode === 'pack') packPlayIdle();   // v4.3：放下后回到待机动作
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

  /** 戳一下的即时动作反馈（不等待 260ms 判定，手感即时）；动作包皮肤走包里的「点击回应」池 */
  function pokeReaction() {
    if (skinMode === 'pack') { packRole('clicks'); return; }
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
    // v3.10.1：连戳台词不再自己 bubbleSay（那样会和 260ms 后的余额气泡"双弹/覆盖"），
    // 改为排队给下一次单击，由 onPetSingleClick 在一个气泡里一起说
    if (pokeCount === 3) pendingSpecialLine = '戳戳戳……戳的这么开心，是要发芽吗！ [bean:angry]';
    if (pokeCount === 5) { transient = 'failed'; transientUntil = performance.now() + 2000; pendingSpecialLine = '爆鱼预警！再戳本小姐就掀桌了！ [fish:hum]'; }
    if (pokeCount >= 8) { pokeCount = 0; transient = 'waiting'; transientUntil = performance.now() + 2600; pendingSpecialLine = '（装死中）…… fish 已离线 [bean:sleep]'; }
    // 260ms 等待可能的第二次点击（双击）
    if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; pendingSpecialLine = ''; onPetDoubleClick(); return; }
    clickTimer = setTimeout(() => { clickTimer = null; onPetSingleClick(); }, 260);
  }

  /* v3.9：互动形变（果冻挤压）——点一下桌宠像弹簧那样压一下，配合点击音效 */
  let jellyTimer = null;
  function jellyPulse() {
    if (settings.jellyOn === false) return;
    petWrap.classList.remove('pb2-jelly');
    // 强制回流，保证连续点击也能重新播动画
    void petWrap.offsetWidth;
    petWrap.classList.add('pb2-jelly');
    if (jellyTimer) clearTimeout(jellyTimer);
    jellyTimer = setTimeout(() => petWrap.classList.remove('pb2-jelly'), 460);
  }
  /** 桌宠大小档位（菜单里循环；设置面板里还有无级滑块） */
  const PET_SIZES = [
    { label: '小', size: 72 },
    { label: '中', size: 96 },
    { label: '大', size: 128 },
    { label: '特大', size: 168 },
  ];
  function petSizeLabel() {
    const cur = Number(settings.size) || 96;
    let best = PET_SIZES[1], bestD = Infinity;
    PET_SIZES.forEach(x => { const d = Math.abs(x.size - cur); if (d < bestD) { bestD = d; best = x; } });
    return best.label + '（' + cur + 'px）';
  }
  function cyclePetSize() {
    const cur = Number(settings.size) || 96;
    let i = PET_SIZES.findIndex(x => Math.abs(x.size - cur) < 6);
    if (i < 0) i = 1;
    settings.size = PET_SIZES[(i + 1) % PET_SIZES.length].size;
    saveSettings(); refreshLayout(); sfx('tap');
    bubbleSay('桌宠大小：' + petSizeLabel(), 2200);
  }

  /* ---- 单击：余额气泡 ---- */
  /** v3.8 三种余额文案格式（可切换）：
   *   short   简洁 —— 一行说清"还剩多少"
   *   detail  详细 —— 剩余/总额/已用/今日/刷新日
   *   playful 傲娇 —— 大肥鱼口吻，带一句嘴碎
   *  数据来源同前：① 内部通道额度（真实）② sk- 网关账单 ③ 自填额度 */

  function balanceStyleLabel() {
    const f = BALANCE_STYLES.find(x => x.id === balanceStyleId());
    return f ? f.label : '简洁';
  }
  function cycleBalanceStyle() {
    const ids = BALANCE_STYLES.map(x => x.id);
    const i = Math.max(0, ids.indexOf(balanceStyleId()));
    settings.balanceStyle = ids[(i + 1) % ids.length];
    saveSettings(); sfx('tap');
    bubbleSay('余额格式：' + balanceStyleLabel(), 2200);
    onPetSingleClick();   // 立刻用新格式给你看一遍
  }


  /* v3.10：被戳一戳的反应词（内置默认 8 条；用户可编辑、也可让 AI 按人设+聊天记录生成） */
  const POKE_DEFAULT = [
    '戳什么戳！', '又来？', '别戳啦～', '本小姐很忙的！',
    '手拿开啦', '咚！别戳头', '再戳要收费了哦', '哼哼，是想我了吧？',
  ];
  function pokeLines() {
    const list = Array.isArray(settings.pokeLines)
      ? settings.pokeLines.map(x => String(x == null ? '' : x).trim()).filter(Boolean)
      : [];
    return list.length ? list : POKE_DEFAULT;
  }
  function pickPokeLine() {
    const list = pokeLines();
    return String(list[Math.floor(Math.random() * list.length)] || POKE_DEFAULT[0]);
  }

  function onPetSingleClick() {
    // v3.10.1：连戳台词优先（同一气泡里说），否则随机一条反应词；后面统一跟（余额）
    const special = pendingSpecialLine;
    pendingSpecialLine = '';
    const head = special || pickPokeLine();
    showBubble(b => {
      // v4.1 修复：台词里的 [bean:sleep] 等贴纸标记要渲染成图（原来纯文本塞入，显示成方括号文字）
      const main = $new('span', 'pb2-bubble-text');
      renderRich(main, head);
      const cost = $new('span', 'pb2-bubble-cost', '（算账中…）');
      b.appendChild(main); b.appendChild(cost);
      todaySpend(true).then(d => {
        if (!d.apiOk) { cost.textContent = '（助手不在线，算不了账啦）'; return; }
        cost.textContent = '（' + balanceLine(d) + '）';
      });
    }, 8000);
    // v4.3：动作包皮肤按「已用档位」表演对应余额动作（0~5 档，与包内 events.balance 一一对应）
    if (skinMode === 'pack') {
      fetchCompanyQuota(false).then(q => {
        if (!q.ok || !q.points) { packRole('clicks'); return; }
        const p = clamp((q.usedPoints / q.points) * 100, 0, 100);
        packBalanceTier(p >= 100 ? 5 : Math.floor(p / 20));
      }).catch(() => { packRole('clicks'); });
    }
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
      { icon: 'speaker', label: '试听语音', act: () => { speechUnlock(); speechProbe('你好，我是坚祥数字助理！哼哼，记住了吗？'); } },
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
      { icon: 'talk', label: () => '互动形变：' + (settings.jellyOn !== false ? '开（果冻挤压）' : '关'), act: () => toggleJelly(), keepOpen: true },
      { icon: 'speaker', label: '试听音效', act: () => { speechUnlock(); ['tap', 'pop', 'drop', 'ok', 'err'].forEach((n, i) => setTimeout(() => sfx(n, { force: true }), i * 320)); } },
    ] },
    { icon: 'mask', label: '桌宠', sub: [
      { icon: 'mask', label: '修改模型…', act: openModelPicker },
      { icon: 'note', label: '角色设定…', act: openPersonaEditor },
      { icon: 'pin', label: () => '大小：' + petSizeLabel(), act: () => cyclePetSize(), keepOpen: true },
      { icon: 'pin', label: '位置重置', act: () => { settings.pos = null; saveSettings(); refreshLayout(); bubbleSay('回到窝啦～', 2200); } },
      { icon: 'chat', label: () => '余额格式：' + balanceStyleLabel(), act: () => cycleBalanceStyle(), keepOpen: true },
      { icon: 'note', label: '台词与开场白…', act: openLineEditor },
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

  /** 一键开关音效（菜单里用；改完给一声反馈：切到开时响一下） */
  function toggleJelly() {
    settings.jellyOn = settings.jellyOn === false;
    saveSettings();
    if (settings.jellyOn) { jellyPulse(); sfx('pop', { force: true }); bubbleSay('互动形变开啦，再点我一下试试～', 2400); }
    else bubbleSay('互动形变关掉了（音效还在）', 2200);
  }
  function toggleSfx() {
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
          clampMenuToViewport();   // v3.10.1：展开/收起后高度变了，重新夹进视口
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
    // v3.10.1：按**实测尺寸**夹进视口（原来硬编码 200×300，菜单展开子菜单后近 500 高，必然被边框切掉）
    clampMenuToViewport(e.clientX - 8, e.clientY - 8);
  });
  /** 把菜单整体挪进视口：右侧/下方放不下就往左/往上收；高度超视口时由 CSS 的 max-height 负责滚动 */
  function clampMenuToViewport(preferX, preferY) {
    if (menu.hidden) return;
    const r = menu.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const mw = Math.min(r.width, vw - 12);
    const mh = Math.min(r.height, vh - 12);
    let x = (preferX === undefined) ? (parseFloat(menu.style.left) || r.left) : preferX;
    let y = (preferY === undefined) ? (parseFloat(menu.style.top) || r.top) : preferY;
    x = Math.max(6, Math.min(x, vw - mw - 6));
    y = Math.max(6, Math.min(y, vh - mh - 6));
    menu.style.left = Math.round(x) + 'px';
    menu.style.top = Math.round(y) + 'px';
  }
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
      skins: list.map(c => ({ name: c.name, dataUrl: c.dataUrl, anim: customSkinAnim(c) === true ? true : undefined })),
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
          if (!customSkinStoreFits(settings.customSkins || [], s.dataUrl)) continue;   // v4.1：装不下的跳过并计数
          settings.customSkins = (settings.customSkins || []).concat([{
            id: 'custom:' + Date.now() + ':' + (added++),
            name: String(s.name || '导入的模型').slice(0, 24),
            dataUrl: s.dataUrl,
            anim: s.anim === true || undefined,   // v4.1：动图标记随包走；旧包没有就留给 customSkinAnim 现场判定
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

  /* ---- v4.2：zip 模型包 → 挑一张图当皮肤 ----
   * 网上下载的桌宠模型常是 zip（源码仓 zip / 素材打包）。流程：解析目录 → 列出图片（按大小排、
   * 只列前 80 张）→ 点一张当场解压 → 走与「直接传图」完全相同的校验（动图判定 / 2MB·4MB / 容量预检）。
   * 解析与解压都在浏览器本地完成（内置 DecompressionStream），零依赖、不联网；rar/7z 不支持（先转 zip）。 */
  const ZIP_PACK_MAX = 200 * 1024 * 1024;   // zip 本身上限（整个读进内存，防特大包拖死页面）
  function uploadFromZipPack(f) {
    if (f.size > ZIP_PACK_MAX) { sfx('err'); bubbleSay('zip 太大了（超过 200MB）：先解压出来，挑好图再传', 4600); return; }
    const rd = new FileReader();
    rd.onload = () => {
      let entries;
      try { entries = zipEntries(rd.result); }
      catch (e) { sfx('err'); bubbleSay('这个 zip 读不了：' + e.message, 4600); return; }
      const imgs = zipImageEntries(entries).sort((a, b) => b.size - a.size);
      if (!imgs.length) { sfx('err'); bubbleSay('包里没找到能当皮肤的图（png / gif / webp / jpg）', 4600); return; }
      log('info', 'zip 模型包解析：' + f.name + '，图片条目 ' + imgs.length + '/' + entries.length);
      openDialog('从 zip 里挑一张（共 ' + imgs.length + ' 张图）', zb => {
        zb.appendChild($new('div', 'pb2-hint', f.name.slice(0, 46) + ' · 点一张穿上看看，不合意关掉重挑。规则与直接传图相同：静态 ≤2MB、动图 ≤4MB'));
        const list = $new('div', 'pb2-zip-list');
        for (const e of imgs.slice(0, 80)) {
          const it = $new('div', 'pb2-zip-item');
          const isGif = /\.gif$/i.test(e.name);
          it.appendChild($new('span', 'pb2-zip-name', (e.name.split('/').pop() || e.name).slice(0, 40)));
          it.appendChild($new('span', 'pb2-zip-meta', Math.round(e.size / 1024) + ' KB' + (isGif ? ' · 动图' : '')));
          it.title = e.name;
          it.addEventListener('click', () => zipPickImage(rd.result, e, zb));
          list.appendChild(it);
        }
        zb.appendChild(list);
        if (imgs.length > 80) zb.appendChild($new('div', 'pb2-hint', '…只列最大的 80 张，要用的图不在里面就先解压 zip 再直接传图'));
      });
    };
    rd.readAsArrayBuffer(f);
  }

  /** zip 里点中一张：解压 → 校验 → 入库变身（与直接上传同一条路的下半段） */
  async function zipPickImage(buf, entry, zb) {
    let bytes;
    try { bytes = await zipExtract(buf, entry); }
    catch (e) { sfx('err'); bubbleSay('这张图解压失败：' + e.message, 4200); return; }
    const dataUrl = zipBytesToDataUrl(bytes, entry.name);
    const anim = imgAnimKind(dataUrl) !== '';
    if (bytes.length > (anim ? CUSTOM_ANIM_MAX : CUSTOM_STATIC_MAX)) {
      sfx('err');
      bubbleSay('这张' + (anim ? '动图' : '静态图') + '有 ' + Math.round(bytes.length / 1024) + ' KB，超过上限（动图 4MB / 静态 2MB），换一张或先压缩', 4600);
      return;
    }
    if (!customSkinStoreFits(settings.customSkins || [], dataUrl)) {
      sfx('err'); bubbleSay('本机存储放不下了（自定义模型约 10MB 上限）：删几个旧模型再挑', 4200);
      return;
    }
    const id = 'custom:' + Date.now();
    settings.customSkins = (settings.customSkins || []).concat([{
      id: id,
      name: (entry.name.split('/').pop() || 'zip 模型').slice(0, 24),
      dataUrl: dataUrl, anim: anim,
    }]);
    settings.skin = id; saveSettings(); applySkin(); refreshLayout(); closeDialog(); sfx('ok');
    bubbleSay(anim ? '会动的新衣服穿好啦～' : '新衣服穿好啦～', 2400);
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

  /** 开场白编辑（v3.8）：支持 {greet} 与 {nickname} 两个变量 */
  function openGreetingEditor() {
    openDialog('开场白', body => {
      body.appendChild($new('div', 'pb2-hint', '启动时桌宠说的第一句话。留空＝用默认那句。可用变量：{greet}（早上好/中午好…）、{nickname}（你的昵称）。'));
      const ta = $new('textarea');
      ta.rows = 4;
      ta.style.width = '100%';
      ta.style.boxSizing = 'border-box';
      ta.placeholder = '例：{greet}，{nickname}！大肥鱼上线了，戳我看余额～';
      ta.value = String(settings.greeting || '');
      body.appendChild(ta);
      const row = $new('div', 'pb2-row');
      const preset = $new('button', null, '用回默认'); preset.type = 'button';
      preset.addEventListener('click', () => { ta.value = ''; });
      const preview = $new('button', null, '试听这句'); preview.type = 'button';
      preview.addEventListener('click', () => {
        const save0 = settings.greeting;
        settings.greeting = ta.value;
        speechUnlock();
        bubbleSay(openLine(), 5000);
        speak(openLine());
        settings.greeting = save0;
      });
      row.appendChild(preset); row.appendChild(preview);
      body.appendChild(row);
      setTimeout(() => { try { ta.focus(); } catch (e) { /* 焦点无所谓 */ } }, 40);
    }, [
      { label: '取消' },
      { label: '保存', primary: true, onClick: () => {
        const ta = dialogMask && dialogMask.querySelector('textarea');
        settings.greeting = ta ? ta.value.trim() : '';
        saveSettings(); sfx('ok');
        bubbleSay(settings.greeting ? '开场白换好啦，下次启动就这么说～' : '开场白改回默认啦～', 2600);
      } },
    ]);
  }

  /** v3.10：让助手按「人设 + 最近聊天」生成一批台词（开场白 / 戳一戳反应词） */
  async function aiGenLines(kind, count) {
    const n = clamp(Math.round(Number(count) || 6), 3, 12);
    const what = kind === 'greeting' ? '开场白（桌宠启动时说的第一句话）'
      : '被戳一戳时的反应词（用户单击桌宠时说的那一句）';
    const ask = [
      '（这是插件给你的内部指令，别复述这段、也别解释）帮我写 ' + n + ' 条' + what + '。要求：',
      '① 语气贴合你对我的人设、也贴合我们最近聊天的感觉；',
      '② 每条不超过 16 个字，口语化、带点傲娇，不要旁白不要引号；',
      '③ **只输出一个 JSON 字符串数组**，例如 ["戳什么戳！","又来？"]，不要任何别的文字。',
    ].join('\n');
    const r = await sendViaAssistant(ask, '');
    const txt = String((r && r.text) || '');
    const m = txt.match(/\[[\s\S]*?\]/);
    if (!m) throw new Error('AI 没按格式回话：' + txt.slice(0, 60).replace(/\s+/g, ' '));
    let arr;
    try { arr = JSON.parse(m[0]); } catch (e) { throw new Error('AI 返回的不是合法 JSON'); }
    const out = (Array.isArray(arr) ? arr : [])
      .map(x => String(x == null ? '' : x).trim().replace(/^["'「]|["'」]$/g, ''))
      .filter(x => x && x.length <= 24);
    if (!out.length) throw new Error('AI 没生成出可用台词');
    return out.slice(0, n);
  }

  /** 台词编辑面板（v3.10：开场白 + 戳一戳反应词，都能 AI 生成与自动更新） */
  function openLineEditor() {
    openDialog('台词与开场白', body => {
      body.appendChild($new('h4', null, '开场白（启动时说的第一句）'));
      body.appendChild($new('div', 'pb2-hint', '支持变量 {greet}（早上好/中午好…）与 {nickname}（你的称呼）。留空＝用默认那句。'));
      const gInp = $new('input'); gInp.type = 'text';
      gInp.style.width = '100%'; gInp.style.boxSizing = 'border-box';
      gInp.placeholder = '例：{greet}，{nickname}！大肥鱼上线啦～';
      gInp.value = String(settings.greeting || '');
      body.appendChild(gInp);
      const gRow = $new('div', 'pb2-row');
      const gGen = $new('button', null, 'AI 生成开场白'); gGen.type = 'button';
      gGen.addEventListener('click', async () => {
        gGen.disabled = true; const old = gGen.textContent; gGen.textContent = '生成中…';
        try {
          const arr = await aiGenLines('greeting', 3);
          gInp.value = arr[0];
          settings.greeting = arr[0]; saveSettings();
          bubbleSay('开场白生成好啦：' + arr[0], 4200);
          if (arr.length > 1) log('info', '开场白候选：' + arr.join(' / '));
        } catch (e) { bubbleSay('生成失败：' + e.message, 5000); }
        finally { gGen.disabled = false; gGen.textContent = old; }
      });
      const gTry = $new('button', null, '试听'); gTry.type = 'button';
      gTry.addEventListener('click', () => {
        const save0 = settings.greeting; settings.greeting = gInp.value;
        speechUnlock(); bubbleSay(openLine(), 5000); speak(openLine());
        settings.greeting = save0;
      });
      gRow.appendChild(gGen); gRow.appendChild(gTry);
      body.appendChild(gRow);

      body.appendChild($new('h4', null, '被戳一戳的反应词（单击桌宠时随机说一条，后面自动跟（余额））'));
      const listBox = $new('div');
      body.appendChild(listBox);
      const renderList = () => {
        listBox.textContent = '';
        const list = pokeLines();
        list.forEach((line, i) => {
          const row = $new('div', 'pb2-row');
          const inp = $new('input'); inp.type = 'text'; inp.value = line;
          inp.style.flex = '1 1 auto';
          const del = $new('button', null, '删'); del.type = 'button';
          del.addEventListener('click', () => {
            const arr = pokeLines().slice(); arr.splice(i, 1);
            settings.pokeLines = arr; saveSettings(); sfx('tap'); renderList();
          });
          row.appendChild(inp); row.appendChild(del);
          inp.addEventListener('change', () => {
            const arr = pokeLines().slice(); arr[i] = inp.value.trim() || arr[i];
            settings.pokeLines = arr; saveSettings();
          });
          listBox.appendChild(row);
        });
        const addRow = $new('div', 'pb2-row');
        const add = $new('button', null, '+ 加一条'); add.type = 'button';
        add.addEventListener('click', () => {
          const arr = pokeLines().slice(); arr.push('哼哼～'); settings.pokeLines = arr; saveSettings(); renderList();
        });
        const reset = $new('button', null, '恢复内置默认'); reset.type = 'button';
        reset.addEventListener('click', () => { settings.pokeLines = []; saveSettings(); renderList(); bubbleSay('已恢复内置台词', 2200); });
        addRow.appendChild(add); addRow.appendChild(reset);
        listBox.appendChild(addRow);
      };
      renderList();
      const pRow = $new('div', 'pb2-row');
      const pGen = $new('button', null, 'AI 按人设+聊天记录生成'); pGen.type = 'button';
      pGen.addEventListener('click', async () => {
        pGen.disabled = true; const old = pGen.textContent; pGen.textContent = '生成中…';
        try {
          const arr = await aiGenLines('poke', 8);
          settings.pokeLines = arr; settings.pokeUpdatedAt = Date.now(); saveSettings();
          renderList();
          bubbleSay('新台词：' + arr.slice(0, 2).join(' / ') + '…', 4200);
        } catch (e) { bubbleSay('生成失败：' + e.message, 5000); }
        finally { pGen.disabled = false; pGen.textContent = old; }
      });
      pRow.appendChild(pGen);
      body.appendChild(pRow);

      body.appendChild($new('h4', null, '自动更新'));
      const autoSel = $new('select');
      [['0', '关闭（只手动更新）'], ['1', '每天自动更新一次'], ['7', '每周自动更新一次']].forEach(([v, l]) => {
        const op = $new('option', null, l); op.value = v;
        if (String(Number(settings.pokeAutoDays) || 0) === v) op.selected = true;
        autoSel.appendChild(op);
      });
      body.appendChild(autoSel);
      const lastTxt = Number(settings.pokeUpdatedAt)
        ? new Date(Number(settings.pokeUpdatedAt)).toLocaleString('zh-CN', { hour12: false })
        : '还没自动更新过';
      body.appendChild($new('div', 'pb2-hint', '上次 AI 更新：' + lastTxt + '（更新时用当前人设 + 最近聊天，替换掉反应词列表）'));
      openDialog._lineFields = { gInp, autoSel };
    }, [
      { label: '取消' },
      { label: '保存', primary: true, onClick: () => {
        const f = openDialog._lineFields || {};
        if (f.gInp) settings.greeting = f.gInp.value.trim();
        if (f.autoSel) settings.pokeAutoDays = Number(f.autoSel.value) || 0;
        saveSettings(); sfx('ok');
        bubbleSay('台词保存好啦～', 2400);
      } },
    ]);
  }

  /** 启动时按周期检查要不要让 AI 刷新台词（延后执行，别和启动问候抢） */
  function maybeAutoRefreshLines() {
    const days = Number(settings.pokeAutoDays) || 0;
    if (!days) return;
    const last = Number(settings.pokeUpdatedAt) || 0;
    if (last && Date.now() - last < days * 86400000) return;
    setTimeout(async () => {
      try {
        const arr = await aiGenLines('poke', 8);
        settings.pokeLines = arr; settings.pokeUpdatedAt = Date.now(); saveSettings();
        log('info', '台词已自动更新（' + days + ' 天周期）：' + arr.join(' / '));
      } catch (e) { log('info', '台词自动更新失败：' + e.message); }
    }, 15000);
  }

  /* ---- 模型选择器（BongoCat 式管理思路） ---- */
  function openModelPicker() {
    openDialog('修改桌宠模型', body => {
      const hidden = Array.isArray(settings.hiddenSkins) ? settings.hiddenSkins : [];
      const deleted = Array.isArray(settings.deletedSkins) ? settings.deletedSkins : [];
      body.appendChild($new('h4', null, '内置模型（可移除/彻底删除）'));
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
      }))).concat(petpackList().map(pk => ({   // v4.3：动作包（整套动作视频）
        id: 'pack:' + pk.id,
        name: pk.name,
        desc: '动作包 · ' + pk.actions.length + ' 个动作：点击/拖动/余额/随机表演都会动' +
          '（来自 ' + pk.source + '，' + Math.round(pk.outTotalKB / 1024 * 10) / 10 + 'MB）',
        thumb: assetUrl(pk.thumb || 'pet-bongo.png'),
        contain: true,
      })));
      const builtin = allBuiltin.filter(m => hidden.indexOf(m.id) < 0 && deleted.indexOf(m.id) < 0);
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
        // v3.9：彻底删除（永久从列表消失；素材文件仍在本机插件目录，面板里会告知文件名）
        const wipe = $new('button', 'pb2-model-act pb2-model-del', '彻底删除');
        wipe.type = 'button';
        wipe.title = '永久移除该模型（不再出现在恢复列表）';
        wipe.addEventListener('click', ev => {
          ev.stopPropagation();
          const file = SPRITE_SKINS[m.id] ? SPRITE_SKINS[m.id].file : (IMAGE_SKINS[m.id] ? IMAGE_SKINS[m.id].file : '');
          openDialog('彻底删除「' + m.name + '」？', b2 => {
            b2.appendChild($new('div', 'pb2-hint',
              '删除后这个模型**永久**从列表消失（不会出现在「恢复已移除」里）。' +
              (file ? '素材文件 ' + file + ' 仍在插件目录（…\\插件兼容层\\pet-buddy\\），想连文件一起清掉就在文件夹里删它。' : '') +
              '要暂时收起来的话，用「移除」就够了。'));
          }, [
            { label: '算了' },
            { label: '确认彻底删除', primary: true, onClick: () => {
              const list = Array.isArray(settings.deletedSkins) ? settings.deletedSkins.slice() : [];
              if (list.indexOf(m.id) < 0) list.push(m.id);
              settings.deletedSkins = list;
              settings.hiddenSkins = (settings.hiddenSkins || []).filter(x => x !== m.id);
              if (settings.skin === m.id) { settings.skin = 'fish'; applySkin(); refreshLayout(); }
              saveSettings(); sfx('err');
              bubbleSay('「' + m.name + '」已彻底删除' + (file ? '（素材 ' + file + ' 可手动删）' : ''), 4200);
              setTimeout(() => openModelPicker(), 60);
            } },
          ]);
        });
        acts.appendChild(wipe);
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
      body.appendChild($new('h4', null, '自定义模型（上传图片或 zip 包 · 可改名/导出/删除）'));
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
      const file = $new('input'); file.type = 'file'; file.accept = 'image/*,.zip,application/zip';
      file.addEventListener('change', () => {
        const f = file.files && file.files[0];
        if (!f) return;
        /* v4.2：zip 模型包（网上下载的常是这个形式）→ 解出图片清单让你挑一张 */
        if (/\.zip$/i.test(f.name) || f.type === 'application/zip' || f.type === 'application/x-zip-compressed') {
          uploadFromZipPack(f);
          return;
        }
        // v4.1：上限按静态/动图分档（读出内容后再判）；动图（GIF/动画 WebP）放宽到 4MB
        if (f.size > CUSTOM_ANIM_MAX) {
          body.appendChild($new('div', 'pb2-hint', '图片超过 ' + Math.round(CUSTOM_ANIM_MAX / 1024 / 1024) + 'MB，请压缩后再上传'));
          return;
        }
        const rd = new FileReader();
        rd.onload = () => {
          const dataUrl = String(rd.result);
          const anim = imgAnimKind(dataUrl) !== '';
          if (!anim && f.size > CUSTOM_STATIC_MAX) {
            body.appendChild($new('div', 'pb2-hint', '静态图超过 2MB，请压缩后再上传（动图 GIF/动画 WebP 可到 4MB）'));
            return;
          }
          // localStorage 配额预检（约 10MB 上限）：存不下就明说，绝不静默丢
          if (!customSkinStoreFits(settings.customSkins || [], dataUrl)) {
            body.appendChild($new('div', 'pb2-hint', '本机存储放不下了（自定义模型存在 localStorage，上限约 10MB）：删几个旧模型，或换张小一点的图'));
            return;
          }
          const id = 'custom:' + Date.now();
          settings.customSkins = (settings.customSkins || []).concat([{ id, name: f.name, dataUrl: dataUrl, anim: anim }]);
          settings.skin = id; saveSettings(); applySkin(); refreshLayout(); closeDialog();
          bubbleSay(anim ? '会动的新衣服穿好啦～' : '新衣服穿好啦～', 2400);
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
          info.appendChild($new('div', 'pb2-model-desc', customSkinAnim(c) ? '自定义动图（GIF/动画 WebP）' : '自定义上传'));
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
      body.appendChild($new('label', null, '桌宠 · 我的称呼（它这么叫你；留空=让它自己猜）'));
      const nickRow = $new('div', 'pb2-row');
      const nickInp = $new('input'); nickInp.type = 'text';
      nickInp.placeholder = '例如：阳哥';
      nickInp.value = String(settings.nickname || '');
      nickInp.style.flex = '1 1 auto';
      const nickClear = $new('button', null, '清空'); nickClear.type = 'button';
      nickClear.title = '清掉称呼，并允许它以后自己从聊天里认';
      nickClear.addEventListener('click', () => {
        nickInp.value = '';
        settings.nickname = ''; settings.nicknameLock = false;
        saveSettings(); sfx('tap');
        bubbleSay('称呼清空啦，以后我重新认～', 2600);
      });
      nickRow.appendChild(nickInp); nickRow.appendChild(nickClear);
      body.appendChild(nickRow);
      body.appendChild($new('label', null, '桌宠 · 大小（40–200 px，桌宠显示宽度）'));
      const sizeRange = $new('input'); sizeRange.type = 'range';
      sizeRange.min = '40'; sizeRange.max = '200'; sizeRange.step = '4';
      sizeRange.value = String(clamp(Number(settings.size) || 96, 40, 200));
      body.appendChild(sizeRange);
      const sizeHint = $new('div', 'pb2-hint', '当前：' + (Number(settings.size) || 96) + ' px');
      sizeRange.addEventListener('input', () => { sizeHint.textContent = '当前：' + sizeRange.value + ' px'; });
      body.appendChild(sizeHint);
      body.appendChild($new('label', null, '桌宠 · 互动形变（点桌宠时像弹簧压一下）'));
      const jellySel = $new('select');
      [['1', '开启（果冻挤压）'], ['0', '关闭']].forEach(([v, l]) => {
        const op = $new('option', null, l); op.value = v;
        if ((settings.jellyOn !== false ? '1' : '0') === v) op.selected = true;
        jellySel.appendChild(op);
      });
      body.appendChild(jellySel);
      body.appendChild($new('label', null, '桌宠 · 余额气泡格式（点一下桌宠时怎么念账）'));
      const balStyleSel = $new('select');
      [['short', '简洁：还剩 X 分（约 Y 元）· 今日 +N 分'],
       ['detail', '详细：剩余/总额/已用 + 今日 + 估算明细'],
       ['playful', '傲娇：大肥鱼口吻，带一句嘴碎']].forEach(([v, l]) => {
        const op = $new('option', null, l); op.value = v;
        if (balanceStyleId() === v) op.selected = true;
        balStyleSel.appendChild(op);
      });
      body.appendChild(balStyleSel);
      body.appendChild($new('label', null, '桌宠 · 开场白（启动第一句；{greet} {nickname} 可用）'));
      const greetingInp = $new('input'); greetingInp.type = 'text';
      greetingInp.placeholder = '留空＝默认';
      greetingInp.value = String(settings.greeting || '');
      body.appendChild(greetingInp);
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
        settings.balanceStyle = balStyleSel.value;
        settings.greeting = greetingInp.value.trim();
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
      openDialog._fields = { ch, mdl, quota, py, gb, gk, gm, mon, spOn, spVoice, spVol, spStep, spMax, spFollow, ttsVoiceSel, ttsRateInp, balStyleSel, greetingInp, sfxOnSel, sfxVol };
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
          settings.nickname = String(f.nickInp.value || '').trim();
          settings.nicknameLock = !!settings.nickname;
          settings.size = clamp(Number(f.sizeRange.value) || 96, 40, 200);
          settings.jellyOn = f.jellySel.value === '1';
          settings.balanceStyle = f.balStyleSel.value;
          settings.greeting = f.greetingInp.value.trim();
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

  /* v4.3 成果卡片：识别与渲染都在 core/deliver.js（独立聊天窗口共用同一份）；
   * 这里只提供桌宠侧的失败提示（打不开本地文件时弹个气泡说明怎么用）。 */
  function delivFailHint() {
    bubbleSay('这一页不允许直接打开本地文件——路径已复制，粘到资源管理器地址栏就能找到它', 3800);
  }

  function chatpAdd(kind, text) {
    const row = $new('div', 'pb2-chatp-msg pb2-' + kind);
    if (kind === 'pet' || kind === 'me') { try { renderRich(row, text); } catch (e) { row.textContent = text; } }
    else row.textContent = text;
    if (kind === 'pet') renderDeliverables(row, text, delivFailHint);   // v4.3：产出文件 → 成果卡片（可复制路径）
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
    chatp.appendChild(head);    chatpMsgs = $new('div', 'pb2-chatp-msgs');
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
    /* v3.9：标题栏可拖动（记住位置，下次打开还在原处） */
    const savedPos = settings.chatpPos || null;
    if (savedPos && savedPos.left != null) {
      chatp.style.right = 'auto'; chatp.style.bottom = 'auto';
      chatp.style.left = savedPos.left + 'px'; chatp.style.top = savedPos.top + 'px';
    } else {
      /* v4.1 修复：默认位置不再硬编码 bottom:150px——桌宠大小一变就悬空一截或压住桌宠头顶。
       * 改成贴着桌宠头顶 8px（桌宠调大调小都跟着）；桌宠隐藏/量不到时回退 150px。 */
      const pr = petWrap.getBoundingClientRect();
      const petTop = pr.top || 0;
      const follow = !settings.hidden && petTop > 0
        ? clamp(Math.round(window.innerHeight - petTop) + 8, 8, Math.max(60, window.innerHeight - 140))
        : 150;
      chatp.style.bottom = follow + 'px';
    }
    let dragging = false, dragDx = 0, dragDy = 0;
    head.addEventListener('pointerdown', ev => {
      if (ev.target === close) return;
      dragging = true;
      const r = chatp.getBoundingClientRect();
      dragDx = ev.clientX - r.left; dragDy = ev.clientY - r.top;
      chatp.style.right = 'auto'; chatp.style.bottom = 'auto';
      chatp.style.left = r.left + 'px'; chatp.style.top = r.top + 'px';
      try { head.setPointerCapture(ev.pointerId); } catch (e) { /* 老内核 */ }
    });
    head.addEventListener('pointermove', ev => {
      if (!dragging) return;
      const w = chatp.offsetWidth, h = chatp.offsetHeight;
      const x = clamp(ev.clientX - dragDx, 4, Math.max(4, window.innerWidth - w - 4));
      const y = clamp(ev.clientY - dragDy, 4, Math.max(4, window.innerHeight - h - 4));
      chatp.style.left = x + 'px'; chatp.style.top = y + 'px';
    });
    const endDrag = () => {
      if (!dragging) return;
      dragging = false;
      settings.chatpPos = { left: Math.round(parseFloat(chatp.style.left) || 0), top: Math.round(parseFloat(chatp.style.top) || 0) };
      saveSettings(); sfx('tap');
    };
    head.addEventListener('pointerup', endDrag);
    head.addEventListener('pointercancel', endDrag);
    document.body.appendChild(chatp);
    chatpAdd('sys', '（试试问我余额还剩多少～）');
    setTimeout(() => { try { chatpInput.focus(); } catch (e) { /* 同上 */ } }, 60);
  }
  function openChatWindow() {
    window.open(assetDir() + 'chat.html', 'pb2-chat', 'width=470,height=720');
  }

  /* ================= 启动问候（v3.8：可在设置里自定义） ================= */  /** 开场白：自定义优先，支持 {greet} 时段问候、{nickname} 昵称两个变量 */
  function openLine() {
    const greet = periodGreet();
    const nick = settings.nickname || '';
    const custom = String(settings.greeting || '').trim();
    if (custom) {
      return custom
        .replace(/\{greet\}/g, greet)
        .replace(/\{nickname\}/g, nick)
        .replace(/[，,]\s*([！!。～~…])/g, '$1')   // 变量为空留下的「，！」
        .replace(/[，,]{2,}/g, '，')
        .replace(/^[，,、\s！!。～~]+/, '')
        .replace(/[{}]/g, '')
        .trim();
    }
    return greet + (nick ? '，' + nick : '') + '！大肥鱼在岗，戳我看账，双击聊天～';
  }
  setTimeout(() => {
    if (settings.hidden) return;
    bubbleSay(openLine(), 6000);
  }, 900);
  /* v3.9.1：把以前截错的称呼清掉（老版本把「我们建个营销群嘛」这类句子当成了名字，
     已经写进 localStorage，光修正则不会自动消失） */
  (function cleanStaleNickname() {
    if (!settings.nickname) return;
    if (!nicknameLooksWrong(settings.nickname)) return;
    const bad = settings.nickname;
    settings.nickname = '';
    settings.nicknameLock = false;
    saveSettings();
    log('info', '清掉了明显不对的称呼：' + bad);
    setTimeout(() => {
      bubbleSay('之前把称呼记岔了（记成了「' + bad + '」），已经清掉～在「聊天设置 → 我的称呼」里告诉我你叫啥吧', 8000);
    }, 1600);
  })();
  maybeAutoRefreshLines();   // v3.10：按周期（每天/每周）让 AI 刷新戳一戳台词

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
      cycleSpeechStyle, cycleSpeechVoice, cycleSpeechSpeed, speechStyleLabel, cyclePetSize, petSizeLabel, jellyPulse, toggleJelly,
      openLineEditor, aiGenLines, pokeLines, pickPokeLine, maybeAutoRefreshLines, POKE_DEFAULT,
      synthPaced, speechSegments, pauseOf, fetchTtsVoices, ttsVoiceLabel, cycleTtsVoice, ttsVoiceList,
      els2: { viewport, sprite, paws, pawL, pawR, keycap },
      isValley, priceTier, buildPrompt, extractNickname,
      personaFingerprint, loadPState, needPersonaFull,
      sendViaMock,
    },
  });
})();
