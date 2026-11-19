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
    const done = () => { if (btn) { btn.textContent = '已复制'; setTimeout(() => { if (btn.textContent === '已复制') btn.textContent = '复制'; }, 1500); } };
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

  /* ---- 卡片（v4.4 打开/定位；v4.6 加真预览 + 窄面板布局）----
   * 打开/定位/预览三个动作都由宿主端注入（act.open / act.reveal / act.preview）：
   *   open    → POST /api/sessions/{id}/delivery/open   （系统默认程序打开）
   *   reveal  → POST /api/sessions/{id}/delivery/reveal （资源管理器定位）
   *   preview → GET  /api/md/{id}/{path}                （取文件字节 → blob URL 当缩略图）
   * 任一步拿不到就退回「类型图标 + 复制路径」，不假装完成。 */
  const DELIV_PREVIEWABLE = { image: 1, media: 1 };
  function makeDeliverCard(f, act) {
    const a = act || {};
    const card = document.createElement('div');
    card.className = 'pb2-deliv' + (DELIV_PREVIEWABLE[f.kind] && a.preview ? ' pb2-deliv-haspv' : '');
    card.title = f.path;
    // 缩略图区（图片/音视频：真预览；其余：类型图标）
    const thumb = document.createElement('div');
    thumb.className = 'pb2-deliv-thumb pb2-deliv-ico';
    thumb.innerHTML = DELIVER_SVG[f.kind] || DELIVER_SVG.other;   // 自家常量 SVG，不含用户数据
    card.appendChild(thumb);
    const mid = document.createElement('div');
    mid.className = 'pb2-deliv-mid';
    const nm = document.createElement('div');
    nm.className = 'pb2-deliv-name'; nm.textContent = f.name; nm.title = f.path;
    const pt = document.createElement('div');
    pt.className = 'pb2-deliv-path'; pt.textContent = f.path; pt.title = f.path;
    mid.appendChild(nm); mid.appendChild(pt);
    const acts = document.createElement('div');
    acts.className = 'pb2-deliv-acts';
    const mk = (cls, label, title, fn) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'pb2-deliv-btn ' + cls; b.textContent = label; b.title = title;
      b.addEventListener('click', (ev) => { ev.stopPropagation(); fn(); });
      acts.appendChild(b);
      return b;
    };
    /** 打开动作的兜底：宿主打不开就复制路径并说明（绝不静默失败） */
    const fallback = (label) => {
      copyPlainText(f.path, null, null);
      if (a.fail) a.fail('没法直接' + label + '（宿主接口不可用）——路径已经复制好了，粘到资源管理器地址栏即可');
    };
    /** 调一个宿主动作（open/reveal），失败或异常都走兜底文案（v4.18：三处重复合一） */
    const runAct = (fn, label) => {
      if (!fn) return fallback(label);
      try { Promise.resolve(fn(f.path)).catch(() => fallback(label)); }
      catch (e) { fallback(label); }
    };
    mk('pb2-deliv-open', '打开', '打开文件（用系统默认程序）', () => runAct(a.open, '打开文件'));
    mk('pb2-deliv-reveal', '定位', '打开文件夹位置（在资源管理器里选中）', () => runAct(a.reveal, '定位文件'));
    mk('pb2-deliv-copy', '复制', '复制完整路径', () => copyPlainText(f.path, null, null));
    mid.appendChild(acts);
    card.appendChild(mid);
    card.addEventListener('click', () => runAct(a.open, '打开文件'));
    // 异步补缩略图（失败就保持图标，不打扰）
    if (DELIV_PREVIEWABLE[f.kind] && a.preview) {
      try {
        Promise.resolve(a.preview(f.path)).then((res) => {
          const url = res && res.url ? res.url : res;
          if (!url) return;
          let el;
          if (f.kind === 'media' && /\.(mp4|webm|mov|mkv|m4v)$/i.test(f.name)) {
            el = document.createElement('video');
            el.muted = true; el.preload = 'metadata'; el.playsInline = true;
            el.setAttribute('muted', ''); el.setAttribute('playsinline', '');
          } else {
            el = document.createElement('img');
            el.alt = '';
          }
          el.className = 'pb2-deliv-pv';
          el.src = url;
          const show = () => { thumb.textContent = ''; thumb.appendChild(el); };
          el.addEventListener('load' in el ? 'load' : 'loadeddata', show, { once: true });
          if (el.tagName === 'VIDEO') el.addEventListener('loadedmetadata', show, { once: true });
        }).catch(() => { /* 预览拿不到就算了 */ });
      } catch (e) { /* 同上 */ }
    }
    return card;
  }

  /** 把文本里的成果文件渲染成卡片追加到 host；返回识别到的文件数（0 = 没动 DOM）。
   *  act（可选）= { open(path), reveal(path), preview(path), fail(msg) }：由宿主端注入。
   *  单条消息最多 3 张（同一路径去重），免得长回复把面板刷满卡片（v4.6）。 */
  function renderDeliverables(host, text, act) {
    const files = extractFilePaths(text);
    if (!files.length || !host) return 0;
    const seen = {};
    const picked = [];
    for (const f of files) {
      const k = f.path.toLowerCase();
      if (seen[k]) continue;
      seen[k] = 1;
      picked.push(f);
      if (picked.length >= 3) break;
    }
    const box = document.createElement('div');
    box.className = 'pb2-deliv-box';
    for (const f of picked) box.appendChild(makeDeliverCard(f, act));
    host.appendChild(box);
    return picked.length;
  }
