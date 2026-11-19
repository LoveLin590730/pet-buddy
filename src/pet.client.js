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

  /* pb:core:begin（由 build.mjs 注入 src/core/*，勿手改） */
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
