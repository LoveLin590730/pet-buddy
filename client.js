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

  /* pb:core:begin（由 build.mjs 从 src/core/* 注入，勿手改） */
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
const PB_VERSION = '3.1.0';

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

  /* ---- 素材位置（v3.1.0 实测：宿主只服务插件根级文件，素材必须平铺） ----
   * 宿主对 /_plugins/<id>/ 只服务**根级文件**：根级新建文件立刻 200，而 assets/x.png、
   * assets/sprites/x.png、/./assets/x.png、assets%2Fx.png 全部 404 —— 子目录用不了。
   * 所以素材平铺在插件根目录，按前缀分组：feiyu-*（桌宠精灵图）、st-*（40 张贴纸）、
   * pet-deepseek.webp（内置女仆皮肤）、icon.png（插件图标）；清单见 assets.manifest.json。
   * 下面三个常量是"素材位置"的唯一开关：将来宿主支持子目录，改这三行 + 搬文件即可。 */
  const ASSET_SPRITE = ASSET_DIR + 'feiyu-spritesheet.png';   // 官方精灵图
  const ASSET_SKIN_DEFAULT = ASSET_DIR + 'pet-deepseek.webp'; // 内置女仆皮肤
  const ASSET_STICKER = ASSET_DIR;                            // 贴纸前缀（st-*.webp）

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
  function applySkin() {
    const s = settings.skin;
    petWrap.classList.remove('pb2-skin-fish', 'pb2-skin-img');
    if (s === 'fish' || !s) {
      skinMode = 'fish';
      petWrap.classList.add('pb2-skin-fish');
      lastPaint = ''; // 强制下一帧重画（clip-path 已由 viewport 承担）
    } else {
      skinMode = 'img';
      petWrap.classList.add('pb2-skin-img');
      let url = '';
      if (s === 'maid') url = ASSET_SKIN_DEFAULT;
      else {
        const c = (settings.customSkins || []).find(x => x.id === s);
        if (c) url = c.dataUrl;
      }
      imgSkin.src = url || ASSET_SKIN_DEFAULT;
    }
    applyMonitor();
  }
  applySkin();

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
  function petSize() { return { w: settings.size || 96, h: (settings.size || 96) * SPRITE.CH / SPRITE.CW }; }
  function placeDefault() {
    const s = petSize();
    return { left: window.innerWidth - s.w - 18, bottom: 14 };
  }
  function applyPos(pos) {
    const s = petSize();
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
        bubbleSay('……让本小姐想想', 20000);
        chatSend(text).then(r => {
          bubbleSay(r.text, Math.max(6000, Math.min(20000, r.text.length * 260)));
        }).catch(err => bubbleSay('出错了：' + err.message, 5000));
      };
      send.addEventListener('click', doSend);
      cancel.addEventListener('click', () => { bubble.hidden = true; });
      input.addEventListener('keydown', ev => {
        if (ev.key === 'Enter') { ev.preventDefault(); doSend(); }
        if (ev.key === 'Escape') bubble.hidden = true;
      });
    }, 0, true);
  }

  /* ================= BongoCat 式鼠标 / 键盘监控 =================
     女仆 / 自定义皮肤开启监控后：
     · 鼠标在页面内移动 → 双爪整体转向鼠标方向
     · 按下鼠标左/右键 → 对应爪子按下
     · 敲键盘（非输入框时）→ 头顶弹出键帽徽章 + 爪子按下弹跳
     说明：浏览器安全模型限制，键盘/鼠标监听只在助手页面聚焦时生效。 */
  function applyMonitor() {
    const on = settings.monitor !== false && skinMode === 'img';
    petWrap.classList.toggle('pb2-monitor-on', on);
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

  /* ---- 右键菜单 ---- */
  const MENU_ITEMS = [
    { icon: '💬', label: '窗口化聊天', act: openChatWindow },
    { icon: '🎭', label: '修改桌宠模型', act: openModelPicker },
    { icon: '📝', label: '角色设定', act: openPersonaEditor },
    { icon: '⚙️', label: '聊天设置', act: openChatSettings },
    { icon: '🧠', label: '查看思考过程', act: openLogViewer },
    { sep: true },
    { icon: '👁', label: '隐藏桌宠', act: () => { settings.hidden = true; saveSettings(); applyHidden(); } },
    { icon: '📍', label: '位置重置', act: () => { settings.pos = null; saveSettings(); refreshLayout(); bubbleSay('回到窝啦～', 2200); } },
  ];
  function buildMenu() {
    menu.textContent = '';
    for (const it of MENU_ITEMS) {
      if (it.sep) { menu.appendChild($new('div', 'pb2-msep')); continue; }
      const row = $new('div', 'pb2-mi');
      row.appendChild($new('span', null, it.icon));
      row.appendChild($new('span', null, it.label));
      row.addEventListener('click', () => { menu.hidden = true; it.act(); });
      menu.appendChild(row);
    }
  }
  petWrap.addEventListener('contextmenu', e => {
    e.preventDefault(); e.stopPropagation();
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

  /* ---- 模型选择器（BongoCat 式管理思路） ---- */
  function openModelPicker() {
    openDialog('修改桌宠模型', body => {
      body.appendChild($new('h4', null, '内置模型'));
      const grid = $new('div', 'pb2-model-grid');
      const builtin = [
        { id: 'fish', name: '大肥鱼·鲸鲸娘', desc: 'ds-pet 官方 v2 精灵图 · 全动作动画', thumb: ASSET_SPRITE, bgPos: '-192px -208px' },
        { id: 'maid', name: 'DeepSeek 女仆', desc: '内置皮肤 pet-deepseek.webp · 呼吸动画 · BongoCat 式鼠标/键盘监控', thumb: ASSET_SKIN_DEFAULT },
      ];
      for (const m of builtin) {
        const card = $new('div', 'pb2-model-card' + (settings.skin === m.id ? ' pb2-selected' : ''));
        const th = $new('div', 'pb2-model-thumb');
        th.style.backgroundImage = 'url("' + m.thumb + '")';
        if (m.bgPos) { th.style.backgroundSize = '1536px 2288px'; th.style.backgroundPosition = m.bgPos; }
        const info = $new('div');
        info.appendChild($new('div', 'pb2-model-name', m.name));
        info.appendChild($new('div', 'pb2-model-desc', m.desc));
        card.appendChild(th); card.appendChild(info);
        card.addEventListener('click', () => { settings.skin = m.id; saveSettings(); applySkin(); refreshLayout(); closeDialog(); bubbleSay('变身！' + m.name + '登场～', 2600); });
        grid.appendChild(card);
      }
      body.appendChild(grid);
      body.appendChild($new('h4', null, '自定义模型（上传图片）'));
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
          const del = $new('button', 'pb2-model-del', '删除');
          del.addEventListener('click', ev => {
            ev.stopPropagation();
            settings.customSkins = settings.customSkins.filter(x => x.id !== c.id);
            if (settings.skin === c.id) settings.skin = 'fish';
            saveSettings(); applySkin(); refreshLayout(); openModelPicker();
          });
          card.appendChild(th); card.appendChild(info); card.appendChild(del);
          card.addEventListener('click', () => { settings.skin = c.id; saveSettings(); applySkin(); refreshLayout(); closeDialog(); });
          grid2.appendChild(card);
        }
        body.appendChild(grid2);
      }
      body.appendChild($new('div', 'pb2-hint', '模型管理思路参考 BongoCat：内置 + 上传 + 可删除。上传图片仅存浏览器 localStorage。'));
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
      body.appendChild($new('div', 'pb2-hint', '通道提示：模型调用失败（余额不足/通道停用/断连）会即时识别并自动回落模拟模式，具体原因会显示在回复开头；通道恢复后助手聊天自动可用。积分制：1000 分 = 1 元。余额来源：① 助手额度（公司内部通道的月度剩余/总额，默认走这条，不需要填令牌）；② sk- 开头的网关 API Key（读网关账单：订阅额度 − 累计用量）；③ 本页自填额度。jxai-姓名-设备号 是公司内部通道的身份牌，只用来认人（可一键当昵称），不是网关 Key。'));
      openDialog._fields = { ch, mdl, quota, py, gb, gk, gm, mon };
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
   * v3.1.0：不再硬编码 '/_plugins/pet-buddy/chat.html'——用素材目录推导（与该页同目录），
   * 插件改名 / 换宿主 / 被人拿去装到自己宿主里都仍然找得到。 */
  function openChatWindow() {
    window.open(ASSET_DIR + 'chat.html', 'pb2-chat', 'width=470,height=720');
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
    _test: {
      singleClick: onPetSingleClick,
      doubleClick: onPetDoubleClick,
      applySkin, refreshLayout, applyHidden, applyMonitor,
      pokeReaction, handleClickCandidate,
      renderRich, stickerEl, normSticker,
      els2: { viewport, sprite, paws, pawL, pawR, keycap },
      isValley, priceTier, buildPrompt, extractNickname,
      personaFingerprint, loadPState, needPersonaFull,
      sendViaMock,
    },
  });
})();
