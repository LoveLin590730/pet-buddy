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
  let ASSET_SKIN_DEFAULT = ASSET_DIR + 'pet-deepseek.webp'; // 内置女仆皮肤
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

  /** 把探测到的可用前缀应用到所有素材常量上 */
  function applyAssetBase(base) {
    if (!base || base === ASSET_DIR_RESOLVED) return false;
    ASSET_DIR_RESOLVED = base;
    ASSET_SPRITE = base + 'feiyu-spritesheet.png';
    ASSET_SPRITE_CODEX = base + 'pet-whale-codex.webp';
    ASSET_SKIN_DEFAULT = base + 'pet-deepseek.webp';
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
