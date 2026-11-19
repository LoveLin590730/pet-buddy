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
    speechUnlock(); // v3.2：点桌宠就是用户手势——顺手解锁音频（之后自动播报才出声）
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
        speechUnlock(); // 用户手势里解锁音频：之后桌宠的自动播报才出得了声
        bubbleSay('……让本小姐想想', 20000);
        chatSend(text).then(r => {
          bubbleSay(r.text, Math.max(6000, Math.min(20000, r.text.length * 260)));
          speakReply(r.text); // v3.2：问答闲聊互动 → 桌宠开口说话
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
    }).catch(err => bubbleSay('出错了：' + err.message, 5000));
  }

  /** 菜单点「语音闲聊」：不摸键盘也能说一轮（静音 2 秒自动收尾并发送） */
  function voiceChatByButton() {
    if (viPhase() !== 'idle') { bubbleSay('还在处理上一句呢，等一下下…', 2600); return; }
    speechUnlock(); // 点了菜单 = 用户手势
    viStart().then(r => { if (!r.ok) bubbleSay('语音这边不行：' + r.reason, 6000); });
  }

  viOn((phase, info) => {   // 状态 → 气泡与动作
    if (phase === 'recording') {
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
    if (r.ok) sendVoiceChat(r.text);
    else if (r.message) bubbleSay(r.message, 5200);
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
    { icon: '🎙', label: '语音闲聊（或按住 ' + VI_HOTKEY_LABEL + '）', act: () => voiceChatByButton() },
    { icon: '🔊', label: '试听声音', act: () => { speechProbe('哼哼，本小姐的声音，好听吧？'); } },
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
      body.appendChild($new('label', null, '声音 · 语音播报（聊天回复念出来）'));
      const spOn = $new('select');
      [['1', '开启'], ['0', '关闭（不说话）']].forEach(([v, l]) => {
        const op = $new('option', null, l); op.value = v;
        if ((settings.speechOn !== false ? '1' : '0') === v) op.selected = true;
        spOn.appendChild(op);
      });
      body.appendChild(spOn);
      body.appendChild($new('label', null, '声音 · 声线'));
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
      const probe = $new('button', null, '试听一句'); probe.type = 'button';
      probe.addEventListener('click', () => { // 先落盘当前值再试听，听到的即保存后的效果
        settings.speechOn = spOn.value === '1';
        settings.speechVoice = spVoice.value;
        settings.speechVolume = Number(spVol.value);
        settings.speechStep = Number(spStep.value) || 0.13;
        settings.speechMaxChars = Number(spMax.value) || 60;
        speechApplyVolume(); saveSettings();
        speechProbe('哼哼，本小姐的声线，就是这个味道吧？');
      });
      body.appendChild(probe);
      body.appendChild($new('div', 'pb2-hint', '语音闲聊：按住「' + VI_HOTKEY_LABEL + '」说话，松开就发给我（助手窗口要在前台）；也可以点右键菜单「语音闲聊」，说完静音 2 秒自动收尾。听写用宿主「语音」组件的本地离线模型（在 设置 → 语音 里开关）。左 Alt 是助手自带的语音听写，本插件不占用。浏览器策略：没有任何用户手势时不会自动出声，点一下桌宠即可解锁。'));
      body.appendChild($new('div', 'pb2-hint', '通道提示：模型调用失败（余额不足/通道停用/断连）会即时识别并自动回落模拟模式，具体原因会显示在回复开头；通道恢复后助手聊天自动可用。积分制：1000 分 = 1 元。余额来源：① 助手额度（公司内部通道的月度剩余/总额，默认走这条，不需要填令牌）；② sk- 开头的网关 API Key（读网关账单：订阅额度 − 累计用量）；③ 本页自填额度。jxai-姓名-设备号 是公司内部通道的身份牌，只用来认人（可一键当昵称），不是网关 Key。'));
      openDialog._fields = { ch, mdl, quota, py, gb, gk, gm, mon, spOn, spVoice, spVol, spStep, spMax };
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
          speechApplyVolume();
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
    speech: speak,
    speechProbe,
    speechClean,
    speechState,
    voice: { start: viStart, stop: viStop, cancel: viCancel, phase: viPhase, lastError: viLastError, label: VI_HOTKEY_LABEL },
    _test: {
      singleClick: onPetSingleClick,
      doubleClick: onPetDoubleClick,
      applySkin, refreshLayout, applyHidden, applyMonitor,
      pokeReaction, handleClickCandidate,
      renderRich, stickerEl, normSticker,
      sendVoiceChat, voiceChatByButton, speakReply,
      speechUnlock, speechStop, speechApplyVolume,
      els2: { viewport, sprite, paws, pawL, pawR, keycap },
      isValley, priceTier, buildPrompt, extractNickname,
      personaFingerprint, loadPState, needPersonaFull,
      sendViaMock,
    },
  });
})();
