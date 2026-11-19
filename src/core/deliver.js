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
