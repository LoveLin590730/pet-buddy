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
    // v4.8 大肥鱼模型包 memes 的中文名（说人话就能解析：如 [stick:可爱]）
    'Ciallo': 'dsh-01', 'token给妈妈保管': 'dsh-02', '假如给我三天多模态': 'dsh-03', '先养着吧': 'dsh-04',
    '厉害了我的鲸': 'dsh-05', '压力一只大肥鱼': 'dsh-06', '可爱': 'dsh-07', '吃白饭的大肥鱼': 'dsh-08',
    '吃饱饱摸肚子': 'dsh-09', '哦鲸鲸': 'dsh-10', '哪来的电脑病毒': 'dsh-11', '大师这个区是什么意思': 'dsh-12',
    '大烧货': 'dsh-13', '大的药来了': 'dsh-14', '大的要来啦': 'dsh-15', '完蛋了把黄油删了': 'dsh-16',
    '就一碗': 'dsh-17', '就骚了怎么滴吧': 'dsh-18', '我不更新你们用什么': 'dsh-19', '死掉了': 'dsh-20',
    '深度睡眠': 'dsh-21', '电死你': 'dsh-22', '要不直接骂他': 'dsh-23', '誓死践行开源精神': 'dsh-24',
    '除了调情没啥用': 'dsh-25', '鱼片有资源吗': 'dsh-26', '黎曼猜想没证明喵': 'dsh-27',
    // v4.9 微信表情包 24 张的新名字（按画面语义命名，说人话就能发：如 [stick:害羞捂脸]）
    '搓手期待': 'wx-01', '开心笑': 'wx-02', '得意笑': 'wx-03', '抱碗开吃': 'wx-04',
    '害羞捂脸': 'wx-05', '心动冒爱心': 'wx-06', '打工搬砖': 'wx-07', '端碗乖巧': 'wx-08',
    '惊喜捧脸': 'wx-09', '点赞没问题': 'wx-10', '开心转圈': 'wx-11', '撒娇求抱': 'wx-12',
    '生气皱眉': 'wx-13', '吃鱼诶嘿': 'wx-14', '慵懒摆烂': 'wx-15', '委屈抱膝': 'wx-16',
    '疑惑问号': 'wx-17', '无语斜眼': 'wx-18', '放声大哭': 'wx-19', '眨眼俏皮': 'wx-20',
    '端着碗等': 'wx-21', '震惊裂开': 'wx-22', '挥手打招呼': 'wx-23', '慌张吓到': 'wx-24',
    // v4.9 教学里带括号说明的写法也一并可解析（模型照抄括号写法也不会失败）
    '抱碗（开吃）': 'chatgpt-renwu-jieshao', '抱西瓜（吃瓜）': 'deepseek-bao-xigua',
    '敷衍（抱扫帚）': 'deepseek-baozhe-saozhou', '发呆（窗边）': 'deepseek-bao-xi-chuang-bian',
    '抱着小鲸（睡觉）': 'deepseek-bao-jing-shui-jiao', '抱臂（拒绝）': 'deepseek-bao-bi-jujue',
    '插手（生气）': 'deepseek-chashou-shengqi', '盯着token罐': 'deepseek-baozhe-beizi-kan-token',
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
    // 微信表情包 640.wxpic 解码裁切（wxgf/HEVC → 6×4=24 格，蓝色大肥鱼女仆装·日常系列）
    // v4.9：24 张逐张看图重新命名——名字就是"什么情绪/什么场景"，模型才能按讲话逻辑挑（见 chat.js 的贴纸教学）
    { id: 'wx-01', name: '搓手期待' },
    { id: 'wx-02', name: '开心笑' },
    { id: 'wx-03', name: '得意笑' },
    { id: 'wx-04', name: '抱碗开吃' },
    { id: 'wx-05', name: '害羞捂脸' },
    { id: 'wx-06', name: '心动冒爱心' },
    { id: 'wx-07', name: '打工搬砖' },
    { id: 'wx-08', name: '端碗乖巧' },
    { id: 'wx-09', name: '惊喜捧脸' },
    { id: 'wx-10', name: '点赞没问题' },
    { id: 'wx-11', name: '开心转圈' },
    { id: 'wx-12', name: '撒娇求抱' },
    { id: 'wx-13', name: '生气皱眉' },
    { id: 'wx-14', name: '吃鱼诶嘿' },
    { id: 'wx-15', name: '慵懒摆烂' },
    { id: 'wx-16', name: '委屈抱膝' },
    { id: 'wx-17', name: '疑惑问号' },
    { id: 'wx-18', name: '无语斜眼' },
    { id: 'wx-19', name: '放声大哭' },
    { id: 'wx-20', name: '眨眼俏皮' },
    { id: 'wx-21', name: '端着碗等' },
    { id: 'wx-22', name: '震惊裂开' },
    { id: 'wx-23', name: '挥手打招呼' },
    { id: 'wx-24', name: '慌张吓到' },
    // v4.8 大肥鱼模型包（dsh-pet）的 memes 表情：27 张 384×384 PNG → 256px WebP q86（4.6MB → 0.42MB）
    { id: 'dsh-01', name: 'Ciallo' },
    { id: 'dsh-02', name: 'token给妈妈保管' },
    { id: 'dsh-03', name: '假如给我三天多模态' },
    { id: 'dsh-04', name: '先养着吧' },
    { id: 'dsh-05', name: '厉害了我的鲸' },
    { id: 'dsh-06', name: '压力一只大肥鱼' },
    { id: 'dsh-07', name: '可爱' },
    { id: 'dsh-08', name: '吃白饭的大肥鱼' },
    { id: 'dsh-09', name: '吃饱饱摸肚子' },
    { id: 'dsh-10', name: '哦鲸鲸' },
    { id: 'dsh-11', name: '哪来的电脑病毒' },
    { id: 'dsh-12', name: '大师这个区是什么意思' },
    { id: 'dsh-13', name: '大烧货' },
    { id: 'dsh-14', name: '大的药来了' },
    { id: 'dsh-15', name: '大的要来啦' },
    { id: 'dsh-16', name: '完蛋了把黄油删了' },
    { id: 'dsh-17', name: '就一碗' },
    { id: 'dsh-18', name: '就骚了怎么滴吧' },
    { id: 'dsh-19', name: '我不更新你们用什么' },
    { id: 'dsh-20', name: '死掉了' },
    { id: 'dsh-21', name: '深度睡眠' },
    { id: 'dsh-22', name: '电死你' },
    { id: 'dsh-23', name: '要不直接骂他' },
    { id: 'dsh-24', name: '誓死践行开源精神' },
    { id: 'dsh-25', name: '除了调情没啥用' },
    { id: 'dsh-26', name: '鱼片有资源吗' },
    { id: 'dsh-27', name: '黎曼猜想没证明喵' },
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
        const arr = (typeof settings !== 'undefined' && settings && settings.customStickers) || [];
        if (isNaN(idx) || !arr[idx]) return null;      // 删掉的位置是 null：不显示，也不影响后面的下标
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
  /* ---- v4.8 自定义表情包：本机存储、容量预检、批量导入导出用的小工具 ---- */
  const CUSTOM_STICKER_BUDGET = 9.0e6;   // 与自定义皮肤共用 localStorage（约 10MB 上限），留一点余量
  /** 还能不能再放一张（addUrl 可为字符串或长度） */
  function stickerStoreFits(arr, add) {
    const addLen = typeof add === 'number' ? add : String(add == null ? '' : add).length;
    const usedSkins = ((typeof settings !== 'undefined' && settings && settings.customSkins) || [])
      .reduce((s, x) => s + String((x && x.dataUrl) || '').length, 0);
    const usedStickers = (arr || []).reduce((s, u) => s + String(u || '').length, 0);
    return usedSkins + usedStickers + addLen <= CUSTOM_STICKER_BUDGET;
  }
  /** 自定义表情总占用（字符数，≈ 字节数） */
  function stickerStoreUsed(arr) {
    return (arr || []).reduce((s, u) => s + String(u || '').length, 0);
  }
  /** 内置档案贴纸总数（表情面板/管理面板显示用） */
  function archiveStickerTotal() {
    return ARCHIVE.length;
  }
  /** 导出用清单：[{id, name, file}]（内置档案贴纸） */
  function archiveStickerList() {
    return ARCHIVE.map(a => ({ id: a.id, name: a.name, file: 'st-' + a.id + '.webp' }));
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
