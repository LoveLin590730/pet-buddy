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

  /* ================= v4.7 自行移动（散步）：桌宠自己走两步 =================
   * 时间：walkNextDelay(基准, 随机) 得下次出发间隔（含抖动）；走完自动排下一次。
   * 模式：stroll 走走停停（水平，1~3 段）/ roam 逛桌面（随机位置，一段到位）/ off 不动。
   * 方法：walkPlan() 算出目标点与时长 → requestAnimationFrame 逐帧 applyPos 平移桌宠
   *       （源码在 core/petwalk.js，纯逻辑、可自检）；同时播「原地踏步」类动作凑出走动感：
   *       动作包皮肤播 moves 池（螃蟹走路/原地漂浮踏步/原地左转奔跑）；
   *       精灵图皮肤切 running-left/right 帧；图片皮肤挂 .pb2-walking 轻微起伏。
   * 朝向：素材默认朝左，向右走时给画面加 .pb2-face-right（镜像 scaleX(-1)）。
   * 打断：拖动/点击/隐藏→立刻停下（不打断用户）。 */
  let walkTimer = null, walkRaf = null, walkSegLeft = 0, walkBusy = false, walkStopped = false;

  function walkActive() {
    return settings.walkOn !== false && walkModeOf(settings.walkMode) !== 'off' && !settings.hidden;
  }
  function walkPos() {
    const p = settings.pos;
    if (p && p.left != null) return { left: p.left, bottom: p.bottom };
    const r = petWrap.getBoundingClientRect();
    return { left: Math.round(r.left), bottom: Math.round(window.innerHeight - r.bottom) };
  }
  function walkSchedule() {
    clearTimeout(walkTimer); walkTimer = null;
    if (!walkActive()) return;
    const sec = walkNextDelay(settings.walkEverySec, Math.random());
    walkTimer = setTimeout(() => { walkGo(); walkSchedule(); }, sec * 1000);
  }
  /** 出发：挑段数 → 走第一段 */
  function walkGo() {
    if (!walkActive() || drag || walkBusy || dialogMask) return;              // 正忙/面板开着就不动
    if (transient && performance.now() < transientUntil) return;             // 正在播点击反应
    walkBusy = true; walkStopped = false;
    walkSegLeft = walkSegCount(settings.walkMode, Math.random());
    log('info', '散步出发：模式=' + settings.walkMode + ' 段数=' + walkSegLeft);
    walkSeg();
  }
  /** 走一段 */
  function walkStepSeg() {
    if (walkStopped) return;
    if (walkSegLeft <= 0) { walkFinish(); return; }
    walkSegLeft--;
    const plan = walkPlan({ w: window.innerWidth, h: window.innerHeight }, petSize(), walkPos(),
      settings.walkMode, settings.walkSpeed, Math.random());
    if (!plan) { walkFinish(); return; }
    walkFace(plan.dir);
    /* v5.4 起步节奏（用户要求）：
     *   ① 先原地踏步 warmupMs（动作有前摇；"左转/奔跑"类 1s，普通行走 0.5s）；
     *   ② 然后位移起步，用 WALK_ACCEL_MS（1 秒）把速度从 0 平滑加到正常；
     *   ③ 中段匀速跑，最后 WALK_DECEL_MS 收住停下。 */
    const warmupMs = Math.max(WALK_WARMUP_MS, Number(walkAnimStart()) || WALK_WARMUP_MS);
    const a = (WALK_ACCEL_MS / Math.max(1, plan.durMs));      // 加速段占比
    const b = (WALK_DECEL_MS / Math.max(1, plan.durMs));      // 减速段占比
    log('info', '散步起步：动作=' + (walkMoveName || '（非动作包）') + ' 原地=' + warmupMs + 'ms 加速=' + WALK_ACCEL_MS + 'ms 段时长=' + Math.round(plan.durMs) + 'ms');
    const t0 = performance.now() + warmupMs;
    const tick = (now) => {
      if (walkStopped) return;
      const t = clamp((now - t0) / plan.durMs, 0, 1);
      if (t <= 0) { walkRaf = requestAnimationFrame(tick); return; }   // 前摇期：原地踏步
      const p = walkPosAt(plan.from, plan.to, t, a, b);
      settings.pos = { left: Math.round(p.left), bottom: Math.round(p.bottom) };
      applyPos(settings.pos);
      if (t < 1) walkRaf = requestAnimationFrame(tick);
      else {
        saveSettings();
        if (walkSegLeft > 0 && walkRnd(Math.random(), 5) > 0.12) {
          setTimeout(() => { if (!walkStopped) walkStepSeg(); }, walkPauseMs(settings.walkMode, Math.random()));
        } else walkFinish();
      }
    };
    walkRaf = requestAnimationFrame(tick);
  }
  const walkSeg = walkStepSeg;   // 语义别名（walkGo 里叫得顺口）
  function walkFinish() {
    walkBusy = false; walkStopped = false; walkSegLeft = 0;
    walkAnimStop(); walkFace('');
    saveSettings();
  }
  /** 立刻停下（拖拽/点击/隐藏/换皮肤时调用） */
  function walkHalt() {
    if (!walkBusy && !walkRaf && !walkSegLeft) return;
    walkStopped = true; walkBusy = false; walkSegLeft = 0;
    if (walkRaf) { cancelAnimationFrame(walkRaf); walkRaf = null; }
    walkAnimStop(); walkFace('');
  }
  /** 朝向：素材朝左，向右走镜像（精灵图有自己的左右帧，不用镜像） */
  function walkFace(dir) {
    petWrap.classList.toggle('pb2-face-right', dir === 'right');
  }
  /** v5.4：挑一个"行走"动作播，并返回它的原地前摇时长（毫秒）。
   *  动作包皮肤走 moves 池（三个原地动作各有节奏）；其他皮肤用默认 0.5s。 */
  let walkMoveIdx = 0, walkMoveName = '';
  function walkAnimStart() {
    if (skinMode === 'pack') {
      const pack = packOf(settings.skin) || packOf(packCur);
      const pool = petpackRolePool(pack, 'moves');
      if (pool.length) {
        walkMoveIdx = Math.min(walkMoveIdx, pool.length - 1);
        walkMoveName = pool[walkMoveIdx] || '';
        packPlay(walkMoveName, true);
        walkMoveIdx = (walkMoveIdx + 1) % pool.length;   // 下次换一个（三个动作轮着用）
      } else { packRole('moves', { loop: true }); walkMoveName = ''; }
      return walkWarmupFor(walkMoveName, walkMoveIdx, pool.length);
    }
    if (skinMode === 'sprite') { transient = 'running-right'; transientUntil = Infinity; return WALK_WARMUP_MS; }
    petWrap.classList.add('pb2-walking');
    return WALK_WARMUP_MS;
  }
  function walkAnimStop() {
    if (skinMode === 'pack') { packPlayIdle(); return; }
    if (skinMode === 'sprite') { if (transientUntil === Infinity) { transientUntil = 0; transient = 'waving'; } return; }
    petWrap.classList.remove('pb2-walking');
  }
  walkSchedule();   // 首次排程（之后每次都自我续排；walkActive() 关掉时自动不排）

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
    try { chatpFollowPet(); } catch (e) { /* 面板还没建 */ }   // v4.6：桌宠动了，面板跟着贴头顶
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
      if (!noDeliv) { try { renderDeliverables(b, text, DELIV_ACT); } catch (e) { /* 卡片失败不影响气泡 */ } }
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
    walkHalt();   // v4.7：用户上手了，散步立刻停
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
      try { chatpFollowPet(); } catch (e) { /* 面板还没建 */ }   // v4.6：桌宠挪了位置，面板跟着走
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
    walkHalt();   // v4.7：被戳了就停下（正走着也先停）
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

  /* ---- 双击：就地输入框（通用设置里可关；关掉时双击不开输入框） ---- */
  function onPetDoubleClick() {
    if (settings.quickChat === false) { bubbleSay('（双击输入框关掉了，用右键「气泡聊天」吧～）', 2600); return; }
    showBubble(b => {
      const input = $new('input', 'pb2-bubble-in');
      input.type = 'text'; input.maxLength = 500;
      input.placeholder = '跟大肥鱼说点什么…';
      const row = $new('div', 'pb2-bubble-send');
      const send = $new('button', 'pb2-mini pb2-mini-primary', '发送');
      const cancel = $new('button', 'pb2-mini', '取消');
      row.appendChild(cancel); row.appendChild(send);
      b.appendChild(input); b.appendChild(row);
      setTimeout(() => input.focus(), 30);
      const doSend = () => {
        const text = input.value.trim();
        if (!text) return;
        speechUnlock(); // 用户手势里解锁音频：之后桌宠的自动播报才出得了声
        bubbleSay('……让本小姐想想', 20000);
        chatpEcho('me', text);   // v4.5：同步进气泡聊天（面板开着就立刻出现；没开则之后打开时补上）
        chatSend(text).then(r => {
          bubbleSay(r.text, Math.max(6000, Math.min(20000, r.text.length * 260)));
          speakReply(r.text); // v3.2：问答闲聊互动 → 桌宠开口说话
          chatpSync();        // 把这一问一答补进面板（与面板内发送共用同一份会话记录）
        }).catch(err => { sfx('err'); bubbleSay('出错了：' + err.message, 5000); chatpSync(); });
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

  /* ---- 右键菜单（v3.6：分栏整理 —— 聊天 / bibo语音 / bibo音效 / 桌宠 / 设置）
   *      v4.16：桌宠那栏精简——"设置类"全收进「桌宠设置…」弹窗（菜单只留常用动作） ---- */
  const MENU_ITEMS = [
    { icon: 'chat', label: '气泡聊天', act: openChatPanel },
    { icon: 'speaker', label: 'bibo语音', sub: [
      { icon: 'speaker', label: '试听语音', act: () => { bubbleSay('试听中…（说完这句会停）', 2600); speechUnlock(); speechProbe(probeText()); } },
      { icon: 'note', label: '试听文本…', act: openProbeTextEditor },
      { icon: 'mic', label: '语音闲聊（按住 ' + VI_HOTKEY_LABEL + '）', act: () => voiceChatByButton() },
      { icon: 'book', label: '常用语…', act: openPhraseBook },
      { icon: 'gear', label: '声音设置…', act: openSoundSettings },
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
      { icon: 'gear', label: '声音设置…', act: openSoundSettings },
    ] },
    { icon: 'mask', label: '桌宠', sub: [
      { icon: 'mask', label: '修改模型…', act: openModelPicker },
      { icon: 'gear', label: '桌宠设置…', act: openPetSettings },
      { icon: 'note', label: '角色设定…', act: openPersonaEditor },
      { icon: 'note', label: '台词与开场白…', act: openLineEditor },
      { icon: 'pin', label: () => '大小：' + petSizeLabel(), act: () => cyclePetSize(), keepOpen: true },
      { icon: 'pin', label: () => '自行移动：' + (settings.walkOn !== false ? walkModeLabel(settings.walkMode) : '关'), act: () => cycleWalkMode(), keepOpen: true },
      { icon: 'pin', label: () => '位置重置', act: () => { settings.pos = null; saveSettings(); refreshLayout(); bubbleSay('回到窝啦～', 2200); } },
      { icon: 'eyeoff', label: '隐藏桌宠', act: () => { settings.hidden = true; saveSettings(); applyHidden(); } },
    ] },
    { icon: 'gear', label: '设置', sub: [
      { icon: 'gear', label: '通用设置…', act: openGeneralSettings },
      { icon: 'chat', label: '聊天设置…', act: openChatSettings },
      { icon: 'speaker', label: '声音设置…', act: openSoundSettings },
      { icon: 'mask', label: '桌宠设置…', act: openPetSettings },
      { icon: 'chat', label: '独立聊天窗口…', act: openChatWindow },
      { icon: 'mask', label: '表情包管理…', act: openStickerManager },
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
            if (!s.keepOpen) closeMenuFully();
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
          } else { closeMenuFully(); it.act(); }
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
  /** v4.16：彻底收起菜单——根菜单隐藏 + 把展开过的子菜单收起。
   *  之前只设 menu.hidden，若某项动作里有异步/渲染副作用（例如试听要起音频），
   *  偶发出现"点了菜单还挂在那儿"；现在点任何非切换类项都先跑这一步。 */
  function closeMenuFully() {
    if (!menu) return;
    menu.hidden = true;
    menu.querySelectorAll('.pb2-mi.pb2-sub-open').forEach(r => {
      r.classList.remove('pb2-sub-open');
      const a = r.querySelector('.pb2-marrow');
      if (a) a.textContent = '▾';
    });
  }

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
  document.addEventListener('pointerdown', e => { if (!menu.hidden && !menu.contains(e.target)) closeMenuFully(); }, true);
  restoreDot.addEventListener('click', () => { settings.hidden = false; saveSettings(); applyHidden(); refreshLayout(); });

  function applyHidden() { root.classList.toggle('pb2-hidden-mode', !!settings.hidden); walkHalt(); }
  applyHidden();

  /* ================= 弹窗基建 ================= */
  let dialogMask = null;
  /* ---- v4.15 弹窗栈：二级弹窗能回退上一级 ----
   * 之前点「角色设定…」这种入口进二级弹窗后，只能一路关掉再重开（用户反馈）。
   * 现在 openDialog 打开前会把"当前弹窗的标题/构建函数/按钮"压栈，新弹窗左下角出现「← 返回」，
   * 点它就把当前弹窗换回上一级（栈内信息重建，状态照旧）。整条链关掉时清空栈。 */
  const dialogStack = [];
  let dialogTop = null;      // 当前弹窗的构建信息 {title, bodyBuilder, footButtons}
  function openDialog(title, bodyBuilder, footButtons) {
    if (dialogMask && dialogTop) dialogStack.push(dialogTop);   // 有上一级 → 记住它
    closeTopOnly();
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
    if (dialogStack.length) {                     // 有上一级 → 左下角给「← 返回」
      const back = $new('button', 'pb2-mini pb2-dback', '← 返回');
      back.type = 'button';
      back.title = '回到上一级设置';
      back.addEventListener('click', () => {
        const prev = dialogStack.pop();
        if (!prev) return;
        closeTopOnly();
        openDialogNoPush(prev.title, prev.bodyBuilder, prev.footButtons);
      });
      foot.appendChild(back);
      foot.appendChild($new('span', 'pb2-dfoot-sp'));
    }
    (footButtons || [{ label: '关闭' }]).forEach(cfg => {
      const btn = $new('button', cfg.primary ? 'pb2-primary' : 'pb2-mini', cfg.label);
      btn.addEventListener('click', () => {
        if (btn.disabled) return;                     // v4.17 防连点：快速双击不会跑两遍保存
        if (cfg.onClick && cfg.onClick() === false) return;
        btn.disabled = true;                          // 关窗前先锁住（弹窗马上就销毁了）
        closeDialog();
      });
      foot.appendChild(btn);
    });
    dlg.appendChild(tt); dlg.appendChild(body); dlg.appendChild(foot);
    dialogMask.appendChild(dlg);
    root.appendChild(dialogMask);
    dialogTop = { title: title, bodyBuilder: bodyBuilder, footButtons: footButtons };
  }
  /** 只移除当前弹窗 DOM（栈保留，供返回时重建上一级） */
  function closeTopOnly() {
    if (dialogMask) { dialogMask.remove(); dialogMask = null; }
    dialogTop = null;
  }
  /** 重建某个弹窗但不影响既有栈（返回上一级时用；调用前当前弹窗已被移除，
   *  openDialog 里"有 dialogMask 才压栈"的条件自然不成立） */
  function openDialogNoPush(title, bodyBuilder, footButtons) {
    openDialog(title, bodyBuilder, footButtons);
  }
  /** 全部关掉（✕ / 遮罩 / 底部按钮）→ 栈清空 */
  function closeDialog() {
    closeTopOnly();
    dialogStack.length = 0;
  }

  /* ---- v4.8 试听文本（试听语音说什么，自己写） ---- */
  const PROBE_DEFAULT = '你好，我是坚祥数字助理！哼哼，记住了吗？';
  function probeText() {
    const t = String(settings.speechProbeText == null ? PROBE_DEFAULT : settings.speechProbeText).trim();
    return t || PROBE_DEFAULT;
  }
  function openProbeTextEditor() {
    let commit = null;      // 本弹窗的"保存"动作（作用域干净，多次开也不串）
    openDialog('试听文本', body => {
      body.appendChild($new('h4', null, '试听时说这一句'));
      body.appendChild($new('div', 'pb2-hint',
        '点「试听语音」时念的就是这段。写点带数字/标点的句子更能听出效果（数字会念成中文，标点会停顿）。'));
      const inp = $new('textarea', 'pb2-input pb2-textarea');
      inp.value = probeText();
      inp.rows = 3;
      inp.placeholder = PROBE_DEFAULT;
      body.appendChild(inp);
      const row = $new('div', 'pb2-chiprow');
      row.appendChild(chipBtn('试听这句', false, () => { settings.speechProbeText = inp.value; saveSettings(); speechUnlock(); speechProbe(probeText()); }));
      row.appendChild(chipBtn('恢复默认', false, () => { inp.value = PROBE_DEFAULT; }));
      body.appendChild(row);
      body.appendChild($new('div', 'pb2-hint', '留空 = 用默认那句。'));
      /* 回车（不按 Shift）保存 */
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); settings.speechProbeText = inp.value; saveSettings(); speechUnlock(); speechProbe(probeText()); closeDialog(); }
      });
      setTimeout(() => { try { inp.focus(); inp.select(); } catch (e) { /* 无妨 */ } }, 60);
      /* 「保存」由底部按钮负责：这里把值挂到 dialog 的确定动作上 */
      commit = () => { settings.speechProbeText = inp.value; saveSettings(); };   // v4.17：改成局部，别挂模块级
    }, [{ label: '取消' }, { label: '保存并试听', primary: true, onClick: () => { if (commit) commit(); speechUnlock(); speechProbe(probeText()); } }]);
  }

  /** 小 chip 按钮（弹窗里常见：一个圆角小按钮） */
  function chipBtn(label, on, fn) {
    const b = $new('button', 'pb2-chip' + (on ? ' pb2-chip-on' : ''), label);
    b.addEventListener('click', fn);
    return b;
  }

  /** v5.1 统一的文件选择行：隐藏原生控件，用按钮触发，右侧显示选中的文件名。
   *  原生 input[type=file] 那个灰色小方块和整体风格太不搭，所有选文件的地方都走这里。 */
  function fileField(host, opts) {
    const o = opts || {};
    const row = $new('div', 'pb2-filerow');
    const inp = $new('input');
    inp.type = 'file';
    if (o.accept) inp.accept = o.accept;
    if (o.multiple) inp.multiple = true;
    inp.style.display = 'none';
    const btn = chipBtn(o.label || '选择文件…', false, () => inp.click());
    const nameEl = $new('span', 'pb2-filename', '未选择文件');
    inp.addEventListener('change', () => {
      const fs = Array.from(inp.files || []);
      nameEl.textContent = !fs.length ? '未选择文件' : (fs.length === 1 ? fs[0].name : fs.length + ' 个文件');
      nameEl.title = fs.map(f => f.name).join('\n');
      if (o.onPick) {
        try { o.onPick(fs); }
        catch (e) { log('err', '文件选择回调出错：' + (e && e.message ? e.message : e)); }
      }
      inp.value = '';                     // 允许再次选同一个文件
    });
    row.appendChild(btn); row.appendChild(nameEl); row.appendChild(inp);
    if (o.hint) host.appendChild($new('div', 'pb2-hint', o.hint));
    host.appendChild(row);
    return { row: row, input: inp, name: nameEl, btn: btn };
  }

  /* ================= v4.8 表情包管理（设置里独立入口：批量导入/导出） =================
   * 内置：档案馆 16 + 微信 24 + 大肥鱼模型包 27 = 67 张（只读，随插件走）
   * 自定义：存本机 localStorage（settings.customStickers，元素是 dataUrl，用 custom:<下标> 引用，
   *        删除时把该位清成 null 以保持下标稳定——历史消息里的贴纸不会错位）
   * 导入：多选图片 或 一个 zip（复用 zipread.js）；大图用 canvas 缩到 256px 再存
   * 导出：打包成 zip 下载（内置 + 自定义／只自定义），zip 由 core/zipwrite.js 生成（零依赖） */
  function stickerMarkOf(kind, id) { return '[stick:' + kind + ':' + id + ']'; }
  function copyMark(mark) {
    try {
      const ta = $new('textarea');
      ta.value = mark;
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
      bubbleSay('标记已复制：' + mark + '（粘到聊天里就能用）', 3600);
    } catch (e) { bubbleSay('复制失败，请手动记下：' + mark, 3600); }
  }
  /** 大图缩到 maxPx 的 webp dataUrl（浏览器 canvas）；失败就原样返回 */
  function shrinkImageDataUrl(dataUrl, maxPx) {
    return new Promise(resolve => {
      try {
        const im = new Image();
        im.onload = () => {
          const w = im.naturalWidth, h = im.naturalHeight;
          if (!w || !h || (w <= maxPx && h <= maxPx && dataUrl.length < 300 * 1024)) { resolve(dataUrl); return; }
          const k = Math.min(1, maxPx / Math.max(w, h));
          const cv = document.createElement('canvas');
          cv.width = Math.max(1, Math.round(w * k)); cv.height = Math.max(1, Math.round(h * k));
          const cx = cv.getContext('2d');
          cx.drawImage(im, 0, 0, cv.width, cv.height);
          const out = cv.toDataURL('image/webp', 0.86);
          resolve(out && out.length < dataUrl.length ? out : dataUrl);
        };
        im.onerror = () => resolve(dataUrl);
        im.src = dataUrl;
      } catch (e) { resolve(dataUrl); }
    });
  }
  /** dataUrl ↔ Uint8Array（导出 zip 用） */
  function dataUrlToBytes(u) {
    const s = String(u || '');
    const i = s.indexOf(',');
    if (i < 0) return new Uint8Array(0);
    const b64 = s.slice(i + 1);
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let k = 0; k < bin.length; k++) out[k] = bin.charCodeAt(0) & 255;
    return out;
  }
  function bytesToDataUrl(bytes, name) {
    const mime = /\.(gif)$/i.test(name) ? 'image/gif' : /\.(jpe?g)$/i.test(name) ? 'image/jpeg'
      : /\.(webp)$/i.test(name) ? 'image/webp' : 'image/png';
    let s = '';
    const CH = 32768;
    for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return 'data:' + mime + ';base64,' + btoa(s);
  }
  function stickerSave() { saveSettings(); }

  function openStickerManager() {
    openDialog('表情包管理', body => {
      const list = () => (settings.customStickers || []);
      const info = $new('div', 'pb2-hint', '');
      function refreshInfo() {
        const used = stickerStoreUsed(list());
        info.textContent = '内置 ' + archiveStickerTotal() + ' 张（档案馆 + 微信 + 大肥鱼模型包）｜自定义 ' +
          list().filter(Boolean).length + ' 张，占 ' + (used / 1024).toFixed(0) + ' KB（与自定义皮肤共用约 10MB 上限）';
      }
      refreshInfo();
      body.appendChild(info);
      /* 工具行：批量导入 / 导出 */
      const tools = $new('div', 'pb2-chiprow');
      const file = $new('input');
      file.type = 'file';
      file.multiple = true;
      file.accept = 'image/*,.zip,application/zip';
      file.style.display = 'none';
      file.addEventListener('change', () => { importStickers(Array.from(file.files || []), refreshAll); file.value = ''; });
      const btnImp = chipBtn('批量导入（图片或 zip）', false, () => file.click());
      const btnExpAll = chipBtn('导出全部（zip）', false, () => exportStickers(true));
      const btnExpMine = chipBtn('只导出自定义', false, () => exportStickers(false));
      tools.appendChild(btnImp); tools.appendChild(btnExpAll); tools.appendChild(btnExpMine); tools.appendChild(file);
      body.appendChild(tools);
      body.appendChild($new('div', 'pb2-hint', '点任意表情可复制它的标记（如 [stick:archive:dsh-07] 或 [stick:custom:0]），粘到聊天里就能发。'));
      /* 自定义 */
      const h4c = $new('h4', null, '自定义表情');
      body.appendChild(h4c);
      const gridC = $new('div', 'pb2-stk-grid');
      body.appendChild(gridC);
      /* 内置 */
      body.appendChild($new('h4', null, '内置表情（' + archiveStickerTotal() + ' 张）'));
      const gridB = $new('div', 'pb2-stk-grid pb2-stk-grid-big');
      for (const a of archiveStickerList()) {
        const cell = $new('div', 'pb2-stk-cell');
        const im = $new('img');
        im.src = assetUrl(a.file); im.alt = a.name; im.title = a.name + '（' + stickerMarkOf('archive', a.id) + '）';
        cell.appendChild(im);
        cell.addEventListener('click', () => copyMark(stickerMarkOf('archive', a.id)));
        gridB.appendChild(cell);
      }
      body.appendChild(gridB);
      /** 重画自定义网格（增删后刷新，不用整个弹窗重开） */
      function refreshAll() {
        refreshInfo();
        gridC.textContent = '';
        const arr = list();
        if (!arr.filter(Boolean).length) {
          gridC.appendChild($new('div', 'pb2-hint', '还没有自定义表情——点上面「批量导入」选几张图，或者丢一个 zip 进来。'));
          return;
        }
        arr.forEach((u, idx) => {
          if (!u) return;                                   // 删过的空位
          const cell = $new('div', 'pb2-stk-cell');
          const im = $new('img');
          im.src = u; im.alt = '自定义 ' + idx; im.title = '自定义 ' + idx + '（' + stickerMarkOf('custom', idx) + '）';
          cell.appendChild(im);
          const del = $new('button', 'pb2-stk-del', '×');
          del.title = '删除这张（历史消息里的位置保持不变，只是不再显示）';
          del.addEventListener('click', (ev) => {
            ev.stopPropagation();
            arr[idx] = null; stickerSave(); refreshAll();
          });
          cell.appendChild(del);
          cell.addEventListener('click', () => copyMark(stickerMarkOf('custom', idx)));
          gridC.appendChild(cell);
        });
      }
      refreshAll();
    }, [{ label: '关闭' }]);
  }

  /** 批量导入：图片文件直接读；zip 走 zipread 解出里面所有图片。逐张做容量预检。 */
  function importStickers(files, done) {
    const arr = settings.customStickers || (settings.customStickers = []);
    let added = 0, skipped = 0, failed = 0;
    const queue = [];
    const finish = () => {
      stickerSave();
      if (done) done();
      bubbleSay('导入完成：新增 ' + added + ' 张' + (skipped ? '，跳过 ' + skipped + ' 张（存不下或超 200 张）' : '') +
        (failed ? '，失败 ' + failed + ' 个' : ''), 4600);
      log('info', '表情包导入：新增 ' + added + ' 跳过 ' + skipped + ' 失败 ' + failed);
    };
    const put = (dataUrl) => {
      const idx = arr.length;
      if (idx >= 200) { skipped++; return; }
      if (!stickerStoreFits(arr, dataUrl)) { skipped++; return; }
      arr[idx] = dataUrl;
      added++;
    };
    const step = () => {
      const job = queue.shift();
      if (!job) { finish(); return; }
      Promise.resolve(job()).then(step, () => { failed++; step(); });
    };
    for (const f of files) {
      const isZip = /\.zip$/i.test(f.name) || f.type === 'application/zip' || f.type === 'application/x-zip-compressed';
      if (isZip) {
        /* zip：整包读 → 解出图片条目 → 逐个解压（包太大直接跳过，避免拖死页面） */
        if (f.size > 60 * 1024 * 1024) { skipped++; continue; }
        queue.push(() => new Promise((res, rej) => {
          const rd = new FileReader();
          rd.onload = () => {
            let entries, imgs;
            try { entries = zipEntries(rd.result); imgs = zipImageEntries(entries); }
            catch (e) { rej(e); return; }
            const jobs2 = imgs.slice(0, 200).map((e, i) => ({
              file: e.name.replace(/^.*\//, '') || ('zip-' + (i + 1) + '.png'),
              size: e.size,
              get: () => zipExtract(rd.result, e).then(b => bytesToDataUrl(b, e.name)),
            }));
            for (const j2 of jobs2) {
              if (j2.size > 4 * 1024 * 1024) { skipped++; continue; }
              queue.push(() => j2.get().then(u => shrinkImageDataUrl(u, 256)).then(put));
            }
            res();
          };
          rd.onerror = () => rej(new Error('读 zip 失败'));
          rd.readAsArrayBuffer(f);
        }));
      } else if (/^image\//.test(f.type) || /\.(png|jpe?g|gif|webp|bmp)$/i.test(f.name)) {
        if (f.size > 6 * 1024 * 1024) { skipped++; continue; }
        queue.push(() => new Promise((res, rej) => {
          const rd = new FileReader();
          rd.onload = () => res(shrinkImageDataUrl(String(rd.result), 256).then(put));
          rd.onerror = () => rej(new Error('读图失败'));
          rd.readAsDataURL(f);
        }));
      } else {
        skipped++;
      }
    }
    step();
  }

  /** 导出：打包成 zip 下载（includeBuiltin=true 时把内置素材也打进去） */
  function exportStickers(includeBuiltin) {
    const jobs = [];
    const custom = (settings.customStickers || []).filter(Boolean);
    if (includeBuiltin) {
      for (const a of archiveStickerList()) {
        jobs.push(fetch(assetUrl(a.file)).then(r => r.arrayBuffer())
          .then(b => ({ name: '内置/st-' + a.id + '.webp', data: new Uint8Array(b), meta: a }))
          .catch(() => null));
      }
    }
    custom.forEach((u, i) => {
      const ext = /^data:image\/gif/i.test(u) ? 'gif' : /^data:image\/jpe?g/i.test(u) ? 'jpg' : /^data:image\/webp/i.test(u) ? 'webp' : 'png';
      jobs.push(Promise.resolve({ name: '自定义/custom-' + String(i).padStart(2, '0') + '.' + ext, data: dataUrlToBytes(u) }));
    });
    if (!jobs.length) { bubbleSay('没有可导出的表情（自定义是空的）', 3600); return; }
    bubbleSay('正在打包 ' + jobs.length + ' 张…', 3000);
    Promise.all(jobs).then(list => {
      const files = list.filter(Boolean);
      const readme = JSON.stringify({
        plugin: 'pet-buddy', kind: 'stickers',
        exportedAt: new Date().toISOString(),
        builtin: includeBuiltin ? archiveStickerTotal() : 0,
        custom: custom.length,
        note: '内置/ 来自插件素材（档案馆+微信+大肥鱼模型包）；自定义/ 是本机自传的。' +
          '重新导入：在「表情包管理 → 批量导入」里选中这些图片即可。',
      }, null, 2);
      files.push({ name: 'README.json', data: new TextEncoder().encode(readme) });
      const zip = zipBuild(files);
      const blob = new Blob([zip], { type: 'application/zip' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'pet-buddy-表情包-' + (includeBuiltin ? '全部' : '自定义') + '-' + String(Date.now()).slice(-6) + '.zip';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 8000);
      bubbleSay('打包好了：' + files.length + ' 个文件已开始下载', 4000);
    }).catch(e => bubbleSay('导出失败：' + (e && e.message ? e.message : e), 4200));
  }

  /* ---- v4.7 自行移动：模式循环 + 设置面板 ---- */
  /** 菜单里点一下循环：走走停停 → 逛桌面 → 关 → 走走停停… */
  function cycleWalkMode() {
    const ids = WALK_MODES.map(m => m.id);
    const cur = walkModeOf(settings.walkMode);
    const next = ids[(ids.indexOf(cur) + 1) % ids.length];
    settings.walkOn = next !== 'off';
    settings.walkMode = next;
    saveSettings();
    walkHalt();
    walkSchedule();     // 立刻按新设置重排下一次
    if (next === 'off') bubbleSay('好，本小姐就在这儿待着～', 2400);
    else bubbleSay('好呀，那本小姐自己溜达溜达（' + walkModeLabel(next) + '）～', 2600);
  }
  /** 间隔 / 速度 / 模式 + 「现在就走两步」 */
  function openWalkSettings() {
    openDialog('自行移动（散步）', body => {
      body.appendChild($new('div', 'pb2-hint',
        '时间：每隔一会儿自己起来走两步（间隔带随机抖动，不会像闹钟）；' +
        '模式：走走停停＝在原地附近水平溜达，逛桌面＝换个位置；' +
        '方法：代码平移桌宠位置 + 播「原地踏步」类动作，拖动/点击时立刻停下。'));
      /* 模式 */
      body.appendChild($new('h4', null, '模式'));
      const modeBox = $new('div', 'pb2-chiprow');
      for (const m of WALK_MODES) {
        const b = $new('button', 'pb2-chip' + (walkModeOf(settings.walkMode) === m.id && settings.walkOn !== false ? ' pb2-chip-on' : ''), m.label);
        b.addEventListener('click', () => {
          settings.walkMode = m.id; settings.walkOn = m.id !== 'off'; saveSettings();
          walkHalt(); walkSchedule(); refreshWalkChips();
        });
        modeBox.appendChild(b);
      }
      body.appendChild(modeBox);
      /* 间隔 */
      body.appendChild($new('h4', null, '出发间隔'));
      const intBox = $new('div', 'pb2-chiprow');
      for (const min of [1, 3, 5, 10, 20]) {
        const b = $new('button', 'pb2-chip' + (Math.round((Number(settings.walkEverySec) || 180) / 60) === min ? ' pb2-chip-on' : ''), min + ' 分钟');
        b.addEventListener('click', () => {
          settings.walkEverySec = min * 60; saveSettings(); walkSchedule(); refreshWalkChips();
        });
        intBox.appendChild(b);
      }
      body.appendChild(intBox);
      /* 速度 */
      body.appendChild($new('h4', null, '走多快'));
      const spBox = $new('div', 'pb2-chiprow');
      for (const sp of WALK_SPEEDS) {
        const b = $new('button', 'pb2-chip' + (walkSpeedOf(settings.walkSpeed) === sp.pxPerSec ? ' pb2-chip-on' : ''), sp.label + '（' + sp.pxPerSec + 'px/秒）');
        b.addEventListener('click', () => { settings.walkSpeed = sp.id; saveSettings(); refreshWalkChips(); });
        spBox.appendChild(b);
      }
      body.appendChild(spBox);
      /* 一键试跑 */
      const tryRow = $new('div', 'pb2-chiprow');
      const tryBtn = chipBtn('现在就走两步', true, () => { closeDialog(); walkHalt(); walkGo(); });
      tryRow.appendChild(tryBtn);
      body.appendChild(tryRow);
      /** 点完刷新所有 chip 的选中态 */
      function refreshWalkChips() {
        modeBox.querySelectorAll('button').forEach((b, i) => b.classList.toggle('pb2-chip-on', walkModeOf(settings.walkMode) === WALK_MODES[i].id && settings.walkOn !== false));
        intBox.querySelectorAll('button').forEach((b, i) => b.classList.toggle('pb2-chip-on', Math.round((Number(settings.walkEverySec) || 180) / 60) === [1, 3, 5, 10, 20][i]));
        spBox.querySelectorAll('button').forEach((b, i) => b.classList.toggle('pb2-chip-on', walkSpeedOf(settings.walkSpeed) === WALK_SPEEDS[i].pxPerSec));
      }
    }, [{ label: '关闭' }]);
  }

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
      body.appendChild($new('h4', null, '加一条'));
      body.appendChild($new('div', 'pb2-hint', '存在本机（localStorage），最多 30 条；语音闲聊、试听都用得上。'));
      const inp = $new('input');
      inp.type = 'text'; inp.placeholder = '加一条，例如：今天吃白饭？'; inp.style.flex = '1 1 auto';
      const bAdd = $new('button', 'pb2-mini pb2-mini-primary', '添加'); bAdd.type = 'button';
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
          const bSay = $new('button', 'pb2-mini', '说'); bSay.type = 'button';
          bSay.addEventListener('click', () => { speechUnlock(); speak(p.text, { force: true }); });
          const bEdit = $new('button', 'pb2-mini', '改'); bEdit.type = 'button';
          bEdit.addEventListener('click', () => askText('改成什么？', p.text, (v) => { p.text = v.slice(0, 60); saveSettings(); openPhraseBook(); }));
          const bDel = $new('button', 'pb2-mini pb2-mini-danger', '删'); bDel.type = 'button';
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
      body.appendChild($new('h4', null, '已保存的常用语'));
      body.appendChild(listBox);
      const bPreset = $new('button', 'pb2-mini', '加几条示例'); bPreset.type = 'button';
      bPreset.addEventListener('click', () => {
        ['今天吃白饭？没饭了！', '余额还剩多少呀？', '哼，才不是在等你呢……'].forEach(t => add(t));
        render();
      });
      body.appendChild(bPreset);
      render();
      setTimeout(() => { try { inp.focus(); } catch (e) { /* 无所谓 */ } }, 30);
    });
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
  /* ---- v4.17 台词与开场白：拆成三组（原来 106 行的单函数） ---- */
  /** 开场白组（含 AI 生成与试听）→ 返回字段 { gInp } */
  function buildGreetingSection(body) {
      body.appendChild($new('h4', null, '开场白（启动时说的第一句）'));
      body.appendChild($new('div', 'pb2-hint', '支持变量 {greet}（早上好/中午好…）与 {nickname}（你的称呼）。留空＝用默认那句。'));
      const gInp = $new('input'); gInp.type = 'text';
      gInp.style.width = '100%'; gInp.style.boxSizing = 'border-box';
      gInp.placeholder = '例：{greet}，{nickname}！大肥鱼上线啦～';
      gInp.value = String(settings.greeting || '');
      body.appendChild(gInp);
      const gRow = $new('div', 'pb2-row');
      const gGen = $new('button', 'pb2-mini', 'AI 生成开场白'); gGen.type = 'button';
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
      const gTry = $new('button', 'pb2-mini', '试听'); gTry.type = 'button';
      gTry.addEventListener('click', () => {
        const save0 = settings.greeting; settings.greeting = gInp.value;
        speechUnlock(); bubbleSay(openLine(), 5000); speak(openLine());
        settings.greeting = save0;
      });
      gRow.appendChild(gGen); gRow.appendChild(gTry);
      body.appendChild(gRow);
    return { gInp: gInp };
  }

  /** 被戳台词组（列表增删改 + AI 生成 + 恢复默认）；自管重绘 */
  function buildPokeLinesSection(body) {
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
          const del = $new('button', 'pb2-mini pb2-mini-danger', '删'); del.type = 'button';
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
        const add = $new('button', 'pb2-mini pb2-mini-primary', '+ 加一条'); add.type = 'button';
        add.addEventListener('click', () => {
          const arr = pokeLines().slice(); arr.push('哼哼～'); settings.pokeLines = arr; saveSettings(); renderList();
        });
        const reset = $new('button', 'pb2-mini', '恢复内置默认'); reset.type = 'button';
        reset.addEventListener('click', () => { settings.pokeLines = []; saveSettings(); renderList(); bubbleSay('已恢复内置台词', 2200); });
        addRow.appendChild(add); addRow.appendChild(reset);
        listBox.appendChild(addRow);
      };
      renderList();
      const pRow = $new('div', 'pb2-row');
      const pGen = $new('button', 'pb2-mini', 'AI 按人设+聊天记录生成'); pGen.type = 'button';
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
  }

  /** 自动更新组（周期选择 + 上次更新时间提示）→ 返回字段 { autoSel } */
  function buildLineAutoSection(body) {
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
    return { autoSel: autoSel };
  }

  function openLineEditor() {
    const F = {};   // 字段表（局部，交给各 build 组填充）
    openDialog('台词与开场白', body => {
      Object.assign(F, buildGreetingSection(body));
      buildPokeLinesSection(body);
      Object.assign(F, buildLineAutoSection(body));
    }, [
      { label: '取消' },
      { label: '保存', primary: true, onClick: () => {
        if (F.gInp) settings.greeting = F.gInp.value.trim();
        if (F.autoSel) settings.pokeAutoDays = Number(F.autoSel.value) || 0;
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

  /* ---- 模型选择器（BongoCat 式管理思路） ----
   * v4.17 重构：原来是近 200 行的单个函数，现按职责拆成四块（纯搬移，行为不变）——
   *   清单数据 builtinModelList / 一张内置卡 makeBuiltinModelCard /
   *   导入上传区 buildModelImportArea / 一张自定义卡 makeCustomModelCard。
   * openModelPicker 只剩"搭框架 + 装配"，改哪块看哪块。 */
  /** 内置模型清单：精灵图皮肤 + 图片皮肤 + 动作包（三类拼成一份） */
  function builtinModelList() {
  return Object.keys(SPRITE_SKINS).map(id => ({
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
  }

  /** 皮肤 id → 素材文件名（彻底删除时提示用；查不到返回空串） */
  function skinAssetFileOf(id) {
    if (SPRITE_SKINS[id]) return SPRITE_SKINS[id].file || '';
    if (IMAGE_SKINS[id]) return IMAGE_SKINS[id].file || '';
    return '';
  }

  /** 把 id 加入/移出某个名单（add=true → hiddenSkins/deletedSkins 里加上；false → 移出）
   *  两个按钮（移除 / 彻底删除）与"恢复已移除"共用这一份实现，避免三处各写一遍。 */
  function skinListToggle(key, id, add) {
    const cur = Array.isArray(settings[key]) ? settings[key].slice() : [];
    const at = cur.indexOf(id);
    if (add && at < 0) cur.push(id);
    if (!add && at >= 0) cur.splice(at, 1);
    return cur;
  }

  /** 一张内置模型卡：点卡片换肤；「移除」只是隐藏，「彻底删除」永久（弹确认框） */
  function makeBuiltinModelCard(m) {
    const card = $new('div', 'pb2-model-card' + (settings.skin === m.id ? ' pb2-selected' : ''));
    const th = $new('div', 'pb2-model-thumb');
    th.style.backgroundImage = 'url("' + m.thumb + '")';
    if (m.bgPos) { th.style.backgroundSize = '1536px 2288px'; th.style.backgroundPosition = m.bgPos; }
    else if (m.contain) { th.style.backgroundSize = 'contain'; th.style.backgroundPosition = 'center'; th.style.backgroundRepeat = 'no-repeat'; }
    const info = $new('div', 'pb2-model-info');
    info.appendChild($new('div', 'pb2-model-name', m.name));
    info.appendChild($new('div', 'pb2-model-desc', m.desc));
    // v3.7：内置模型也能移除（从列表隐藏，素材不动；随时可恢复）
    // v5.1：按钮行移进右侧信息列（底部一行、右对齐），不再竖排错位
    const acts = $new('div', 'pb2-model-acts');
    const del = $new('button', 'pb2-mini', '移除');
    del.type = 'button';
    del.title = '从列表移除（素材不删，可在下方「恢复已移除」找回）';
    del.addEventListener('click', ev => {
      ev.stopPropagation();
      settings.hiddenSkins = skinListToggle('hiddenSkins', m.id, true);   // v4.17：名单操作走共用实现
      if (settings.skin === m.id) { settings.skin = 'fish'; applySkin(); refreshLayout(); }
      saveSettings(); sfx('tap');
      bubbleSay('已经把「' + m.name + '」从列表里移除啦（可恢复）', 2800);
      openModelPicker();
    });
    acts.appendChild(del);
    // v3.9：彻底删除（永久从列表消失；素材文件仍在本机插件目录，面板里会告知文件名）
    const wipe = $new('button', 'pb2-mini pb2-mini-danger', '彻底删除');
    wipe.type = 'button';
    wipe.title = '永久移除该模型（不再出现在恢复列表）';
    wipe.addEventListener('click', ev => {
      ev.stopPropagation();
      const file = skinAssetFileOf(m.id);   // v4.17：查素材文件名（精灵图/图片皮肤通用）
      openDialog('彻底删除「' + m.name + '」？', b2 => {
        b2.appendChild($new('div', 'pb2-hint',
          '删除后这个模型**永久**从列表消失（不会出现在「恢复已移除」里）。' +
          (file ? '素材文件 ' + file + ' 仍在插件目录（…\\插件兼容层\\pet-buddy\\），想连文件一起清掉就在文件夹里删它。' : '') +
          '要暂时收起来的话，用「移除」就够了。'));
      }, [
        { label: '算了' },
        { label: '确认彻底删除', primary: true, onClick: () => {
          settings.deletedSkins = skinListToggle('deletedSkins', m.id, true);      // 加入"彻底删除"名单
          settings.hiddenSkins = skinListToggle('hiddenSkins', m.id, false);      // 同时从"已移除"名单移出
          if (settings.skin === m.id) { settings.skin = 'fish'; applySkin(); refreshLayout(); }
          saveSettings(); sfx('err');
          bubbleSay('「' + m.name + '」已彻底删除' + (file ? '（素材 ' + file + ' 可手动删）' : ''), 4200);
          setTimeout(() => openModelPicker(), 60);
        } },
      ]);
    });
    acts.appendChild(wipe);
    info.appendChild(acts);          // v5.1：按钮行挂在信息列底部（一行右对齐）
    card.appendChild(th); card.appendChild(info);
    card.addEventListener('click', () => { settings.skin = m.id; saveSettings(); applySkin(); refreshLayout(); closeDialog(); sfx('ok'); bubbleSay('变身！' + m.name + '登场～', 2600); });
    grid.appendChild(card);
    return card;
  }

  /** 自定义模型的导入 / 上传 / 导出区（文件选择行 + 全部导出） */
  function buildModelImportArea(body) {
  body.appendChild($new('h4', null, '自定义模型（上传图片或 zip 包 · 可改名/导出/删除）'));
  /* v5.1：文件选择统一成「按钮 + 文件名」（原生控件的灰色小方块太突兀） */
  const impField = fileField(body, {
    label: '导入模型包（.json）', accept: '.json,application/json',
    onPick: (fs) => {
      const f = fs[0];
      if (!f) return;
      importSkinPackFile(f, (n, err) => {
        if (n > 0) { openModelPicker(); bubbleSay('导入了 ' + n + ' 个模型～', 2800); }
        else bubbleSay('导入失败：' + (err || '文件里没有可用模型'), 4400);
      });
    },
  });
  const all = settings.customSkins || [];
  if (all.length > 1) {
    const expAll = chipBtn('全部导出', false, () => exportSkinPack(all));
    impField.row.appendChild(expAll);
  }
  /* v5.1：上传图片/zip 也用统一的文件选择行 */
  fileField(body, {
    label: '上传图片或 zip 包',
    accept: 'image/*,.zip,application/zip',
    hint: '静态图 ≤2MB、动图 ≤4MB、zip 会列出里面的图让你挑',
    onPick: (fs) => {
    const f = fs[0];
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
    },
  });
  }

  /** 一张自定义模型卡：改名 / 导出 / 删除 */
  function makeCustomModelCard(c) {
      const card = $new('div', 'pb2-model-card' + (settings.skin === c.id ? ' pb2-selected' : ''));
      const th = $new('div', 'pb2-model-thumb');
      th.style.backgroundImage = 'url("' + c.dataUrl + '")';
      const info = $new('div', 'pb2-model-info');
      info.appendChild($new('div', 'pb2-model-name', c.name));
      info.appendChild($new('div', 'pb2-model-desc', customSkinAnim(c) ? '自定义动图（GIF/动画 WebP）' : '自定义上传'));
      const acts = $new('div', 'pb2-model-acts');
      const ren = $new('button', 'pb2-mini', '改名'); ren.type = 'button';
      ren.addEventListener('click', ev => {
        ev.stopPropagation();
        askText('给这张模型起个名字', c.name || '', (v) => { c.name = v.slice(0, 24); saveSettings(); openModelPicker(); });
      });
      const exp = $new('button', 'pb2-mini', '导出'); exp.type = 'button';
      exp.addEventListener('click', ev => { ev.stopPropagation(); exportSkinPack([c]); });
      const del = $new('button', 'pb2-mini pb2-mini-danger', '删除'); del.type = 'button';
      del.addEventListener('click', ev => {
        ev.stopPropagation();
        settings.customSkins = settings.customSkins.filter(x => x.id !== c.id);
        if (settings.skin === c.id) settings.skin = 'fish';
        saveSettings(); applySkin(); refreshLayout(); openModelPicker();
      });
      acts.appendChild(ren); acts.appendChild(exp); acts.appendChild(del);
      info.appendChild(acts);        // v5.1：按钮行在信息列底部
      card.appendChild(th); card.appendChild(info);
      card.addEventListener('click', () => { settings.skin = c.id; saveSettings(); applySkin(); refreshLayout(); closeDialog(); });
      grid2.appendChild(card);
    }
    return card;
  }

  function openModelPicker() {
    openDialog('修改桌宠模型', body => {
      const hidden = Array.isArray(settings.hiddenSkins) ? settings.hiddenSkins : [];
      const deleted = Array.isArray(settings.deletedSkins) ? settings.deletedSkins : [];
      body.appendChild($new('h4', null, '内置模型（可移除/彻底删除）'));
      const grid = $new('div', 'pb2-model-grid');
      for (const m of builtinModelList()) {
        if (hidden.indexOf(m.id) >= 0 || deleted.indexOf(m.id) >= 0) continue;
        grid.appendChild(makeBuiltinModelCard(m));
      }
      body.appendChild(grid);
      if (hidden.length) {
        const restoreRow = $new('div', 'pb2-chiprow');
        restoreRow.appendChild(chipBtn('恢复已移除的模型（' + hidden.length + '）', false, () => {
          settings.hiddenSkins = [];
          saveSettings(); sfx('ok');
          bubbleSay('都找回来啦～', 2200);
          openModelPicker();
        }));
        body.appendChild(restoreRow);
      }
      body.appendChild($new('h4', null, '自定义模型（上传图片或 zip 包 · 可改名/导出/删除）'));
      buildModelImportArea(body);
      const customs = settings.customSkins || [];
      if (customs.length) {
        const grid2 = $new('div', 'pb2-model-grid');
        for (const c of customs) grid2.appendChild(makeCustomModelCard(c));
        body.appendChild(grid2);
      }
      body.appendChild($new('div', 'pb2-hint', '模型管理思路参考 BongoCat：内置 + 上传 + 改名/导出/导入/删除。上传图片与常用语都只存本机 localStorage。'));
    });
  }
  /* ---- 角色设定（可编辑） ---- */
  function openPersonaEditor() {
    const F = {};   // 字段表（局部）
    openDialog('角色设定', body => {
      body.appendChild($new('h4', null, '性格设定'));
      body.appendChild($new('label', null, '大肥鱼的性格设定（留空恢复默认：傲娇搞笑毒舌忠诚挚友）'));
      const ta = $new('textarea');
      ta.value = settings.persona || '';
      ta.placeholder = DEFAULT_PERSONA;
      ta.addEventListener('input', () => { ta.dataset.dirty = '1'; });
      body.appendChild(ta);
      const resetRow = $new('div', 'pb2-chiprow');
      resetRow.appendChild(chipBtn('恢复默认', false, () => { ta.value = ''; ta.dataset.dirty = '1'; }));
      body.appendChild(resetRow);
      F.ta = ta;
    }, [
      { label: '取消' },
      { label: '保存', primary: true, onClick: () => {
          const ta = F.ta;
          if (ta) { settings.persona = ta.dataset.dirty ? ta.value.trim() : settings.persona; saveSettings(); bubbleSay('记住了！以后就这么演。', 2600); }
        } },
    ]);
  }

  /* ================= v5.3 设置拆分：通用 / 聊天 / 声音 =================
   * 之前「聊天设置…」和「声音设置…」指向同一个巨型弹窗（20 个字段横跨四个领域）。
   * 现在按"这设置属于谁"分三处：
   *   通用设置：连接与额度（通道/模型/额度/网关/身份牌）+ 桌宠（大小/形变/称呼/监控/余额格式/开场白）
   *   聊天设置：聊天外观与内容入口（角色人设、台词开场白、常用语、表情包、会话管理、两个行为开关）
   *   声音设置：只放声音（语音播报全项 + 音效 + 语音闲聊入口）
   * 三个弹窗各自保存自己那部分，互不影响；分组标题统一（左侧蓝条）。 */

  /** 连接与额度（通道 / 模型 / 额度 / 网关身份牌）——通用设置第一组 */
  function buildConnFields(body) {
    const F = {};
    body.appendChild($new('h4', null, '连接与额度'));
    body.appendChild($new('label', null, '聊天通道'));
    const ch = $new('select');
    [['assistant', '助手子对话（统一）· 默认'], ['gateway', '网关令牌（OpenAI 兼容）'], ['mock', '模拟模式（离线）']].forEach(([v, l]) => {
      const op = $new('option', null, l); op.value = v; if (settings.channel === v) op.selected = true; ch.appendChild(op);
    });
    body.appendChild(ch); F.ch = ch;
    body.appendChild($new('label', null, '聊天模型（助手通道）'));
    const mdl = $new('select');
    CHAT_MODELS.forEach(m => {
      const op = $new('option', null, m.label);
      op.value = m.provider + '|' + m.model;
      if (settings.chatProvider === m.provider && settings.chatModel === m.model) op.selected = true;
      mdl.appendChild(op);
    });
    body.appendChild(mdl); F.mdl = mdl;
    body.appendChild($new('label', null, '剩余额度（元，自填可选；填了余额报告会带上）'));
    const quota = $new('input'); quota.type = 'number'; quota.min = '0'; quota.step = '0.01';
    quota.value = Number(settings.quota) > 0 ? String(settings.quota) : '';
    body.appendChild(quota); F.quota = quota;
    body.appendChild($new('label', null, '每元积分（积分制换算，后端 1000 分 = 1 元）'));
    const py = $new('input'); py.type = 'number'; py.min = '1'; py.step = '1';
    py.value = perYuanCredits();
    body.appendChild(py); F.py = py;
    return F;
  }

  /** 网关 / 身份牌 —— 通用设置第二组 */
  function buildGatewayFields(body) {
    const F = {};
    body.appendChild($new('h4', null, '网关 / 身份牌（内部通道用不到，可留空）'));
    body.appendChild($new('label', null, '网关 baseURL（只有 sk- 开头的 API Key 才需要）'));
    const gb = $new('input'); gb.type = 'text'; gb.placeholder = 'https://.../v1（可留空）'; gb.value = settings.gatewayBase || '';
    body.appendChild(gb); F.gb = gb;
    body.appendChild($new('label', null, '网关令牌 / 身份牌（只存本浏览器，不进日志）'));
    const gk = $new('input'); gk.type = 'password';
    gk.placeholder = '留空即可 ｜ sk-xxxx（网关 API Key）｜ jxai-姓名-设备号（内部通道身份牌）';
    gk.value = settings.gatewayKey || '';
    body.appendChild(gk); F.gk = gk;
    const tkHint = $new('div', 'pb2-hint', '');
    const tkExtra = $new('div', 'pb2-chiprow');
    body.appendChild(tkHint); body.appendChild(tkExtra);
    const refreshTokenHint = () => {
      const t = parseGatewayToken(gk.value);
      tkHint.textContent = tokenHint(gk.value);
      tkExtra.textContent = '';
      if (t.kind === 'inner') {
        const used = settings.nickname === t.name;
        tkExtra.appendChild(chipBtn(used ? '昵称已是「' + t.name + '」' : '用「' + t.name + '」当昵称', false, () => {
          settings.nickname = t.name; saveSettings();
          bubbleSay('身份牌收到！以后叫你 ' + t.name + '～', 2800);
          refreshTokenHint();
        }));
      }
    };
    gk.addEventListener('input', refreshTokenHint);
    refreshTokenHint();
    body.appendChild($new('label', null, '网关模型名'));
    const gm = $new('input'); gm.type = 'text'; gm.placeholder = 'deepseek-chat'; gm.value = settings.gatewayModel || '';
    body.appendChild(gm); F.gm = gm;
    return F;
  }

  /** 桌宠本体（大小 / 形变 / 称呼 / 监控 / 余额格式 / 开场白）——通用设置第三组 */
  function buildPetFields(body) {
    const F = {};
    body.appendChild($new('h4', null, '桌宠'));
    body.appendChild($new('label', null, '我的称呼（它这么叫你；留空＝让它自己从聊天里认）'));
    const nickRow = $new('div', 'pb2-row');
    const nickInp = $new('input'); nickInp.type = 'text';
    nickInp.placeholder = '例如：阳哥';
    nickInp.value = String(settings.nickname || '');
    nickInp.style.flex = '1 1 auto';
    const nickClear = chipBtn('清空', false, () => {
      nickInp.value = '';
      settings.nickname = ''; settings.nicknameLock = false;
      saveSettings(); sfx('tap');
      bubbleSay('称呼清空啦，以后我重新认～', 2600);
    });
    nickRow.appendChild(nickInp); nickRow.appendChild(nickClear);
    body.appendChild(nickRow); F.nickInp = nickInp;
    body.appendChild($new('label', null, '大小（40–200 px，桌宠显示宽度）'));
    const sizeRange = $new('input'); sizeRange.type = 'range';
    sizeRange.min = '40'; sizeRange.max = '200'; sizeRange.step = '4';
    sizeRange.value = String(clamp(Number(settings.size) || 96, 40, 200));
    body.appendChild(sizeRange); F.sizeRange = sizeRange;
    const sizeHint = $new('div', 'pb2-hint', '当前：' + (Number(settings.size) || 96) + ' px');
    sizeRange.addEventListener('input', () => { sizeHint.textContent = '当前：' + sizeRange.value + ' px'; });
    body.appendChild(sizeHint);
    body.appendChild($new('label', null, '互动形变（点桌宠时像弹簧压一下）'));
    const jellySel = $new('select');
    [['1', '开启（果冻挤压）'], ['0', '关闭']].forEach(([v, l]) => {
      const op = $new('option', null, l); op.value = v;
      if ((settings.jellyOn !== false ? '1' : '0') === v) op.selected = true;
      jellySel.appendChild(op);
    });
    body.appendChild(jellySel); F.jellySel = jellySel;
    body.appendChild($new('label', null, 'BongoCat 式鼠标/键盘监控（女仆/自定义皮肤：爪子跟随鼠标、按键弹键帽）'));
    const mon = $new('select');
    [['1', '开启（页面聚焦时生效）'], ['0', '关闭']].forEach(([v, l]) => {
      const op = $new('option', null, l); op.value = v;
      if ((settings.monitor !== false ? '1' : '0') === v) op.selected = true;
      mon.appendChild(op);
    });
    body.appendChild(mon); F.mon = mon;
    body.appendChild($new('label', null, '余额气泡格式（点一下桌宠时怎么念账）'));
    const balStyleSel = $new('select');
    [['short', '简洁：还剩 X 分（约 Y 元）· 今日 +N 分'],
     ['detail', '详细：剩余/总额/已用 + 今日 + 估算明细'],
     ['playful', '傲娇：大肥鱼口吻，带一句嘴碎']].forEach(([v, l]) => {
      const op = $new('option', null, l); op.value = v;
      if (balanceStyleId() === v) op.selected = true;
      balStyleSel.appendChild(op);
    });
    body.appendChild(balStyleSel); F.balStyleSel = balStyleSel;
    body.appendChild($new('label', null, '开场白（启动第一句；{greet} {nickname} 可用）'));
    const greetingInp = $new('input'); greetingInp.type = 'text';
    greetingInp.placeholder = '留空＝默认';
    greetingInp.value = String(settings.greeting || '');
    body.appendChild(greetingInp); F.greetingInp = greetingInp;
    return F;
  }

  /* ---- v4.16 桌宠设置：外观 + 称呼与说话 + 自行移动（从"通用设置"里分出来，菜单那栏也就能精简） ---- */
  function openPetSettings() {
    const F = {};            // v4.17：字段表放弹窗自己的作用域（原来挂在 openDialog 上）
    openDialog('桌宠设置', body => {
      Object.assign(F, buildPetFields(body));
      body.appendChild($new('h4', null, '自行移动（散步）'));
      body.appendChild($new('div', 'pb2-hint',
        '它每隔一会儿自己走两步：模式（走走停停 / 逛桌面 / 不自己动）、出发间隔、速度都在这里调。'));
      const row = $new('div', 'pb2-chiprow');
      row.appendChild(chipBtn('自行移动设置…', false, () => { openWalkSettings(); }));
      row.appendChild(chipBtn('现在就走两步', true, () => { closeDialog(); walkHalt(); walkGo(); }));
      body.appendChild(row);
      body.appendChild($new('h4', null, '摆件与外观'));
      const r2 = $new('div', 'pb2-chiprow');
      r2.appendChild(chipBtn('修改模型…', false, () => { openModelPicker(); }));
      r2.appendChild(chipBtn('重置位置', false, () => {
        settings.pos = null; saveSettings(); refreshLayout();
        bubbleSay('回到窝啦～', 2200);
      }));
      r2.appendChild(chipBtn(settings.hidden ? '露出桌宠' : '隐藏桌宠', false, () => {
        settings.hidden = !settings.hidden; saveSettings(); applyHidden();
        bubbleSay(settings.hidden ? '那我先躲起来～' : '我又出来啦～', 2200);
      }));
      body.appendChild(r2);
    }, [
      { label: '取消' },
      { label: '保存', primary: true, onClick: () => {
        const f = F; if (!f) return;
        settings.nickname = String(f.nickInp.value || '').trim();
        settings.nicknameLock = !!settings.nickname;
        settings.size = clamp(Number(f.sizeRange.value) || 96, 40, 200);
        settings.jellyOn = f.jellySel.value === '1';
        settings.monitor = f.mon.value === '1';
        settings.balanceStyle = f.balStyleSel.value;
        settings.greeting = f.greetingInp.value.trim();
        saveSettings(); applyMonitor(); refreshLayout();
        bubbleSay('设置好了～', 2000);
      } },
    ]);
  }

  /* ---- 通用设置：连接与额度 + 网关身份牌 ---- */
  function openGeneralSettings() {
    const F = {};
    openDialog('通用设置', body => {
      Object.assign(F, buildConnFields(body), buildGatewayFields(body));
    }, [
      { label: '取消' },
      { label: '保存', primary: true, onClick: () => {
        const f = F; if (!f) return;
        settings.channel = f.ch.value;
        const pm = f.mdl.value.split('|');
        if (settings.chatProvider !== pm[0] || settings.chatModel !== pm[1]) {
          settings.chatProvider = pm[0]; settings.chatModel = pm[1];
          localStorage.removeItem(CHAT_LS_SID);   // 换模型 → 重建统一子对话
        }
        settings.quota = Number(f.quota.value) || 0;
        settings.perYuan = Number(f.py.value) > 0 ? Number(f.py.value) : 1000;
        settings.gatewayBase = f.gb.value.trim();
        settings.gatewayKey = f.gk.value;
        settings.gatewayModel = f.gm.value.trim();
        CREDITS_CACHE = { at: 0, data: null };   // 换算/凭据变更 → 立即重取
        saveSettings(); applyMonitor(); refreshLayout();
        bubbleSay('设置好了～', 2000);
      } },
    ]);
  }
  /* 桌宠相关设置已移至「桌宠设置」弹窗（v4.16），这里不再重复处理 */

  /* ---- 声音设置：只有声音（语音播报 + 音效 + 语音闲聊） ---- */
  /* ---- v4.17 声音设置：按"组"拆开（原来是 138 行的单函数） ----
   * 三个 build* 各画一组、各自把字段交给调用方；落盘统一走 applySoundSettings。
   * 字段不再挂在 openDialog 上（那是全局挂载的老写法），改成弹窗自己的局部表，多次开也不串台。 */
  /** 语音播报组（10 项 + 试听行）→ 返回本组字段 */
  function buildSpeechFields(body) {
      body.appendChild($new('h4', null, '语音播报（聊天回复念出来）'));
      body.appendChild($new('label', null, '语音播报'));
      const spOn = $new('select');
      [['1', '开启'], ['0', '关闭（不说话）']].forEach(([v, l]) => {
        const op = $new('option', null, l); op.value = v;
        if ((settings.speechOn !== false ? '1' : '0') === v) op.selected = true;
        spOn.appendChild(op);
      });
      body.appendChild(spOn);
      body.appendChild($new('label', null, '朗读模式（引导＝经典音色+按真人语调选音；普通朗读＝直接用真人声）'));
      const spFollow = $new('select');
      [['guided', '语调引导（还是哔哔啵啵的音色，音高贴真人语调）'],
       ['classic', '经典合成（完全按字，音高固定几档）'],
       ['tts', '普通朗读（真人声直接播，不改音色）']].forEach(([v, l]) => {
        const op = $new('option', null, l); op.value = v;
        if (speechMode() === v) op.selected = true;
        spFollow.appendChild(op);
      });
      body.appendChild(spFollow);
      body.appendChild($new('label', null, 'bibo音色（合成器声线，影响「语调引导 / 经典合成」）'));
      const spVoice = $new('select');
      Object.keys(SPEECH_VOICE_NAMES).forEach(k => {
        const op = $new('option', null, SPEECH_VOICE_NAMES[k]); op.value = k;
        if ((settings.speechVoice || 'fish') === k) op.selected = true;
        spVoice.appendChild(op);
      });
      body.appendChild(spVoice);
      body.appendChild($new('label', null, '朗读音色（宿主 TTS 音色，影响「普通朗读」）'));
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
      body.appendChild($new('label', null, '合成音量（语调引导 / 经典合成用了 bibo 音色时生效）'));
      const spVol = $new('input'); spVol.type = 'range'; spVol.min = '0'; spVol.max = '1'; spVol.step = '0.05';
      spVol.value = String(speechVolume());
      body.appendChild(spVol);
      body.appendChild($new('label', null, '合成语速（每字间隔秒，越小越快）'));
      const spStep = $new('input'); spStep.type = 'range'; spStep.min = '0.08'; spStep.max = '0.3'; spStep.step = '0.01';
      spStep.value = String(clamp(Number(settings.speechStep) || 0.12, 0.08, 0.3));
      body.appendChild(spStep);
      body.appendChild($new('label', null, '朗读语速（0.5–2，1 为正常，TTS 真人声）'));
      const ttsRateInp = $new('input'); ttsRateInp.type = 'number';
      ttsRateInp.min = '0.5'; ttsRateInp.max = '2'; ttsRateInp.step = '0.1';
      ttsRateInp.value = String(clamp(Number(settings.ttsRate) || 1, 0.5, 2));
      body.appendChild(ttsRateInp);
      body.appendChild($new('label', null, '单次朗读上限（字，超出截断）'));
      const spMax = $new('input'); spMax.type = 'number'; spMax.min = '4'; spMax.max = '400'; spMax.step = '1';
      spMax.value = String(clamp(Math.round(Number(settings.speechMaxChars) || 60), 4, 400));
      body.appendChild(spMax);
      const probeRow = $new('div', 'pb2-chiprow');
      probeRow.appendChild(chipBtn('试听这一句', true, () => {   // 先落盘当前值，听到的即保存后的效果
        settings.speechOn = spOn.value === '1';
        settings.speechMode = spFollow.value;
        settings.speechFollow = spFollow.value !== 'classic';
        settings.speechVoice = spVoice.value;
        settings.ttsVoice = ttsVoiceSel.value;
        settings.speechVolume = Number(spVol.value);
        settings.speechStep = Number(spStep.value) || 0.12;
        settings.ttsRate = clamp(Number(ttsRateInp.value) || 1, 0.5, 2);
        settings.speechMaxChars = Number(spMax.value) || 60;
        speechApplyVolume(); ttsCache.clear(); trackCache.clear(); saveSettings();
        speechUnlock(); speechProbe(probeText());
      }));
      probeRow.appendChild(chipBtn('改试听文本…', false, () => { openProbeTextEditor(); }));
      body.appendChild(probeRow);
    return { spOn: spOn, spFollow: spFollow, spVoice: spVoice, ttsVoiceSel: ttsVoiceSel,
             spVol: spVol, spStep: spStep, ttsRateInp: ttsRateInp, spMax: spMax };
  }

  /** 音效组（开关 / 音量 / 试听）→ 返回本组字段 */
  function buildSfxFields(body) {
      body.appendChild($new('h4', null, '音效（点桌宠、弹面板、拖拽吸附…）'));
      body.appendChild($new('label', null, '音效开关'));
      const sfxOnSel = $new('select');
      [['1', '开启'], ['0', '关闭']].forEach(([v, l]) => {
        const op = $new('option', null, l); op.value = v;
        if ((settings.sfxOn !== false ? '1' : '0') === v) op.selected = true;
        sfxOnSel.appendChild(op);
      });
      body.appendChild(sfxOnSel);
      body.appendChild($new('label', null, '音效音量（与语音音量独立）'));
      const sfxVol = $new('input'); sfxVol.type = 'range'; sfxVol.min = '0'; sfxVol.max = '1'; sfxVol.step = '0.05';
      sfxVol.value = String(sfxVolume());
      body.appendChild(sfxVol);
      const sfxRow = $new('div', 'pb2-chiprow');
      sfxRow.appendChild(chipBtn('试听音效', false, () => {
        settings.sfxOn = sfxOnSel.value === '1';
        settings.sfxVolume = Number(sfxVol.value);
        sfxApplyVolume(); saveSettings();
        ['tap', 'pop', 'drop', 'ok', 'err'].forEach((n, i) => setTimeout(() => sfx(n, { force: true }), i * 320));
      }));
      body.appendChild(sfxRow);
    return { sfxOnSel: sfxOnSel, sfxVol: sfxVol };
  }

  /** 语音闲聊：只放说明与热键入口（无可保存字段） */
  function buildVoiceChatSection(body) {
      body.appendChild($new('h4', null, '语音闲聊'));
      const viRow = $new('div', 'pb2-chiprow');
      viRow.appendChild(chipBtn('开始语音闲聊（按住 ' + VI_HOTKEY_LABEL + '）', false, () => { closeDialog(); voiceChatByButton(); }));
      body.appendChild(viRow);
      body.appendChild($new('div', 'pb2-hint',
        '按住「' + VI_HOTKEY_LABEL + '」说话、松开就发给我（助手窗口要在前台）；也可以点上面的按钮，说完静音 2 秒自动收尾。' +
        '听写用宿主「语音」组件的本地离线模型。左 Alt 是助手自带的听写，本插件不占用。' +
        '浏览器策略：没有用户手势时不会自动出声，点一下桌宠即可解锁。'));
      body.appendChild($new('div', 'pb2-hint',
        '积分制：1000 分 = 1 元。余额来源：① 助手额度（公司内部通道，默认走这条，不用填令牌）；' +
        '② sk- 开头的网关 API Key；③ 通用设置里自填额度。'));
  }

  /** 落盘并即时生效（音量应用、缓存清理都在这里） */
  function applySoundSettings(f) {
    if (!f) return;
    settings.speechOn = f.spOn.value === '1';
    settings.speechMode = f.spFollow.value;
    settings.speechFollow = f.spFollow.value !== 'classic';
    settings.speechVoice = f.spVoice.value;
    settings.ttsVoice = f.ttsVoiceSel.value;
    settings.speechVolume = Number(f.spVol.value);
    settings.speechStep = Number(f.spStep.value) || 0.12;
    settings.ttsRate = clamp(Number(f.ttsRateInp.value) || 1, 0.5, 2);
    settings.speechMaxChars = Number(f.spMax.value) || 60;
    settings.sfxOn = f.sfxOnSel.value === '1';
    settings.sfxVolume = Number(f.sfxVol.value);
    speechApplyVolume(); sfxApplyVolume();
    ttsCache.clear(); trackCache.clear();
  }

  function openSoundSettings() {
    const F = {};          // 本次弹窗的字段表（作用域干净，不再挂全局）
    openDialog('声音设置', body => {
      Object.assign(F, buildSpeechFields(body), buildSfxFields(body));
      buildVoiceChatSection(body);
    }, [
      { label: '取消' },
      { label: '保存', primary: true, onClick: () => {
        applySoundSettings(F);
        saveSettings();
        bubbleSay('设置好了～', 2000);
      } },
    ]);
  }
    ]);
  }

  /* ---- 聊天设置：聊天外观与内容入口 ---- */
  function openChatSettings() {
    const F = {};   // 字段表（局部）
    openDialog('聊天设置', body => {
      body.appendChild($new('h4', null, '人设与台词'));
      body.appendChild($new('div', 'pb2-hint', '它是什么性格、怎么说话、开场第一句说什么——都在这里改。'));
      const r1 = $new('div', 'pb2-chiprow');
      r1.appendChild(chipBtn('角色设定…', false, () => { openPersonaEditor(); }));
      r1.appendChild(chipBtn('台词与开场白…', false, () => { openLineEditor(); }));
      body.appendChild(r1);
      body.appendChild($new('h4', null, '内容库'));
      body.appendChild($new('div', 'pb2-hint', '常用语（点「说」就念出来）与表情包（内置 67 张 + 自定义，可批量导入导出）。'));
      const r2 = $new('div', 'pb2-chiprow');
      r2.appendChild(chipBtn('常用语…', false, () => { openPhraseBook(); }));
      r2.appendChild(chipBtn('表情包管理…', false, () => { openStickerManager(); }));
      body.appendChild(r2);
      body.appendChild($new('h4', null, '聊天行为'));
      body.appendChild($new('label', null, '双击桌宠：就地输入框（关掉则双击不出输入框）'));
      const dbl = $new('select');
      [['1', '开启'], ['0', '关闭']].forEach(([v, l]) => {
        const op = $new('option', null, l); op.value = v;
        if ((settings.quickChat !== false ? '1' : '0') === v) op.selected = true;
        dbl.appendChild(op);
      });
      body.appendChild(dbl);
      body.appendChild($new('label', null, '双击/面板的聊天记录互通（双击聊的内容会同步进气泡面板）'));
      const sync = $new('select');
      [['1', '开启（推荐）'], ['0', '关闭（面板只看自己在面板里聊的）']].forEach(([v, l]) => {
        const op = $new('option', null, l); op.value = v;
        if ((settings.chatSync !== false ? '1' : '0') === v) op.selected = true;
        sync.appendChild(op);
      });
      body.appendChild(sync);
      body.appendChild($new('label', null, '气泡面板里的消息最多留几条（超出只清面板显示，会话记录不动）'));
      const keep = $new('input'); keep.type = 'number'; keep.min = '10'; keep.max = '200'; keep.step = '10';
      keep.value = String(clamp(Math.round(Number(settings.chatKeep) || 60), 10, 200));
      body.appendChild(keep);
      body.appendChild($new('h4', null, '会话'));
      const sid = deliverSid();
      body.appendChild($new('div', 'pb2-hint', '当前用的是一个助手子对话（双击、气泡面板、独立窗口共用同一份记录）：' + (sid ? sid : '（还没建，首次聊天时自动创建）')));
      const r3 = $new('div', 'pb2-chiprow');
      r3.appendChild(chipBtn('查看思考过程', false, () => { openLogViewer(); }));
      r3.appendChild(chipBtn('重置会话（下次聊天重新建）', false, () => {
        try { localStorage.removeItem(CHAT_LS_SID); } catch (e) { /* 忽略 */ }
        if (chatpMsgs) chatpMsgs.textContent = '';
        chatpLastSeq = 0;
        bubbleSay('会话重置啦，下次聊天我重新认识你～', 3200);
      }));
      body.appendChild(r3);
      body.appendChild($new('div', 'pb2-hint', '玩法：双击就地聊、右键「气泡聊天」开面板；面板里能发内置与自定义表情。'));
      Object.assign(F, { dbl: dbl, sync: sync, keep: keep });
    }, [
      { label: '关闭' },
      { label: '保存', primary: true, onClick: () => {
        const f = F; if (!f) return;
        settings.quickChat = f.dbl.value === '1';
        settings.chatSync = f.sync.value === '1';
        settings.chatKeep = clamp(Math.round(Number(f.keep.value) || 60), 10, 200);
        saveSettings();
        if (chatpSync) chatpSync();   // 同步开关变了，立刻按新设置刷一次
        bubbleSay('设置好了～', 2000);
      } },
    ]);
  }


  /* ---- 思考过程查看器 ---- */
  function openLogViewer() {
    openDialog('思考过程（后台日志·仅供查看）', body => {
      body.appendChild($new('h4', null, '最近 100 条'));
      const list = $new('div', 'pb2-loglist');
      if (!logs.length) list.appendChild($new('div', 'pb2-logrow', '（暂无日志）'));
      for (const it of logs.slice(-100).reverse()) {
        const row = $new('div', 'pb2-logrow pb2-t-' + it.type);
        row.appendChild($new('div', 'pb2-loghead', it.t + '  [' + it.type + ']'));
        row.appendChild($new('div', null, it.text));
        list.appendChild(row);
      }
      body.appendChild(list);
      const clearRow = $new('div', 'pb2-chiprow');
      clearRow.appendChild(chipBtn('清空日志', false, () => { logs = []; try { localStorage.removeItem(LS_LOG); } catch (e) {} openLogViewer(); }));
      body.appendChild(clearRow);
      body.appendChild($new('div', 'pb2-hint', '模型的思考过程（reasoning）只写进这里，聊天里永远不会显示。'));
    });
  }

  /* ---- 窗口化聊天 ----
   * v3.6：默认改成**页面内气泡聊天面板**（没有浏览器地址栏、没有窗口边框、可随处拖动）；
   * 老做法（独立窗口 chat.html）保留在「设置 → 打开独立聊天窗口」里。 */
  let chatp = null, chatpMsgs = null, chatpInput = null, chatpBtn = null, chatpBusy = false;
  let chatpFaceBtn = null, chatpStkPanel = null, chatpStickerOpen = false, chatpStkTab = 'recent', chatpStkDelMode = false;

  /* ---- v5.0 气泡聊天里的表情面板（把"能发的表情包"加回来）----
   * 内容与独立聊天窗口一致：最近 / 大肥鱼（精灵图格） / 黄豆（矢量） / 女仆 / 表情包（内置 67 张） / 我的（自定义）。
   * 交互：点一张表情 —— 输入框空着就直接发出去；输入框有字就追加进去（和窗口页一致）；
   *       「我的」tab 支持 ➕ 批量添加（图片或 zip，会自动缩图并做容量预检）与「管理」删除（置 null 保下标）。 */
  const CHATP_STK_TABS = [['recent', '最近'], ['fish', '大肥鱼'], ['bean', '黄豆'], ['maid', '女仆'], ['archive', '表情包'], ['custom', '我的']];
  function chatpRecentList() {
    try { return JSON.parse(localStorage.getItem(LS_RECENT) || '[]') || []; } catch (e) { return []; }
  }
  function chatpPushRecent(g, n) {
    const r = chatpRecentList().filter(x => !(x && x.g === g && x.n === n));
    r.unshift({ g: g, n: n });
    try { localStorage.setItem(LS_RECENT, JSON.stringify(r.slice(0, 12))); } catch (e) { /* 忽略 */ }
  }
  /** 标记文本：内置组短标记，档案馆/自定义走 stick 长标记（与窗口页同一格式） */
  function chatpStickerMark(g, n) { return g === 'stick' ? '[stick:' + n + ']' : '[' + g + ':' + n + ']'; }
  function chatpStkItems(tab) {
    if (tab === 'recent') return chatpRecentList().filter(x => x && x.g);
    if (tab === 'fish') return Object.keys(FISH_STICKERS).map(n => ({ g: 'fish', n: n }));
    if (tab === 'bean') return Object.keys(BEAN).map(n => ({ g: 'bean', n: n }));
    if (tab === 'maid') return [{ g: 'maid', n: '1' }];
    if (tab === 'archive') return archiveStickerList().map(a => ({ g: 'stick', n: 'archive:' + a.id, name: a.name }));
    if (tab === 'custom') return (settings.customStickers || []).map((u, i) => ({ g: 'stick', n: 'custom:' + i, name: '自定义 ' + i, empty: !u }));
    return [];
  }
  /** 点一张表情：输入框有字就追加，空着就直接发 */
  function chatpUseSticker(g, n) {
    const mark = chatpStickerMark(g, n);
    chatpPushRecent(g, n);
    const cur = (chatpInput.value || '').trim();
    if (cur) { chatpInput.value = cur + ' ' + mark; chatpInput.focus(); }
    else { chatpStickerOpen = false; renderChatpStickers(); chatpSend(mark); }
  }
  /** 选表情图片/zip（tab 上的「➕ 添加」与网格末尾的「＋」共用这一份） */
  function pickStickerFiles() {
    const fu = $new('input');
    fu.type = 'file'; fu.multiple = true; fu.accept = 'image/*,.zip,application/zip'; fu.style.display = 'none';
    fu.addEventListener('change', () => {
      importStickers(Array.from(fu.files || []), () => { chatpStkTab = 'custom'; renderChatpStickers(); });
      fu.value = '';
    });
    chatpStkPanel.appendChild(fu);
    fu.click();
  }

  /** 表情面板的分类行（含「我的」的 管理/添加、表情包的 管理… 入口） */
  function buildStickerTabs() {
    const tabs = $new('div', 'pb2-stkp-tabs');
    for (const [id, label] of CHATP_STK_TABS) {
      const b = $new('button', 'pb2-stkp-tab' + (chatpStkTab === id ? ' pb2-on' : ''), label);
      b.type = 'button';
      b.addEventListener('click', () => { chatpStkTab = id; chatpStkDelMode = false; renderChatpStickers(); });
      tabs.appendChild(b);
    }
    if (chatpStkTab === 'custom') {
      tabs.appendChild($new('span', 'pb2-stkp-sp'));
      tabs.appendChild(chipBtn(chatpStkDelMode ? '完成' : '管理', false, () => { chatpStkDelMode = !chatpStkDelMode; renderChatpStickers(); }));
      tabs.appendChild(chipBtn('➕ 添加', false, pickStickerFiles));
    }
    if (chatpStkTab === 'archive' || chatpStkTab === 'custom') {
      tabs.appendChild($new('span', 'pb2-stkp-sp'));
      tabs.appendChild(chipBtn('管理…', false, () => { chatpStickerOpen = false; renderChatpStickers(); openStickerManager(); }));
    }
    return tabs;
  }

  /** 一个表情格（删除态下点一下即删；平时点一下即发/追加） */
  function makeStickerCell(it) {
    const cell = $new('div', 'pb2-stkp-cell' + (chatpStkDelMode ? ' pb2-del-mode' : ''));
    const el = stickerEl(it.g, it.n);
    if (el) {
      cell.title = (it.name ? it.name + '（' : '') + chatpStickerMark(it.g, it.n) + (it.name ? '）' : '');
      cell.appendChild(el);
    } else {
      cell.textContent = '?';
      cell.title = '失效表情';
    }
    cell.addEventListener('click', () => {
      if (chatpStkDelMode && chatpStkTab === 'custom') {       // 删除：置 null 保下标（历史消息不错位）
        const idx = Number(String(it.n).split(':')[1]);
        const arr = settings.customStickers || [];
        if (!isNaN(idx) && arr[idx] !== undefined) { arr[idx] = null; stickerSave(); renderChatpStickers(); }
        return;
      }
      chatpUseSticker(it.g, it.n);
    });
    return cell;
  }

  /** 表情面板网格（「我的」末尾带一个 ＋ 格） */
  function buildStickerGrid() {
    const grid = $new('div', 'pb2-stkp-grid');
    const shown = chatpStkItems(chatpStkTab).slice(0, 200);
    let real = 0;
    for (const it of shown) {
      if (it.empty) continue;                                  // 删过的空位不显示
      grid.appendChild(makeStickerCell(it));
      real++;
    }
    if (!real) {
      grid.appendChild($new('div', 'pb2-hint',
        chatpStkTab === 'recent' ? '还没用过表情，先到「表情包」里挑一张～' : '这里还没有表情'));
    }
    if (chatpStkTab === 'custom') {
      const addCell = $new('div', 'pb2-stkp-cell pb2-stkp-add', '＋');
      addCell.title = '添加表情（图片或 zip，可多选）';
      addCell.addEventListener('click', pickStickerFiles);
      grid.appendChild(addCell);
    }
    return grid;
  }

  /** 面板总装：开合 → 分类行 → 网格（每块都能单独改） */
  function renderChatpStickers() {
    if (!chatpStkPanel) return;
    chatpStkPanel.hidden = !chatpStickerOpen;
    if (!chatpStickerOpen) return;
    chatpStkPanel.textContent = '';
    chatpStkPanel.appendChild(buildStickerTabs());
    chatpStkPanel.appendChild(buildStickerGrid());
  }

  /* v4.4 成果卡片的动作：调宿主交付接口——
   *   POST /api/sessions/{id}/delivery/open   → 用系统默认程序打开文件
   *   POST /api/sessions/{id}/delivery/reveal → 在资源管理器里定位该文件
   * {id} 用桌宠自己的助手子对话（localStorage 里那个）；接口不可用时卡片自己回落「复制路径」。 */
  function deliverSid() { try { return localStorage.getItem(CHAT_LS_SID) || ''; } catch (e) { return ''; } }
  function delivApi(action, path) {
    const sid = deliverSid();
    if (!sid) return Promise.reject(new Error('no-session'));
    return fetch('/api/sessions/' + encodeURIComponent(sid) + '/delivery/' + action, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: path }),
    }).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json().catch(() => ({})); });
  }
  /** v4.6 文件预览：走宿主的文件服务接口取字节 → blob URL（图片显示缩略图、视频显示首帧）。
   *  拿不到就抛错，卡片保持类型图标（不假装有预览）。 */
  const delivPreviewCache = new Map();   // path → blob URL（最多留 24 个）
  function delivPreview(path) {
    const key = String(path || '').toLowerCase();
    if (delivPreviewCache.has(key)) return Promise.resolve(delivPreviewCache.get(key));
    const sid = deliverSid();
    if (!sid) return Promise.reject(new Error('no-session'));
    const url = '/api/md/' + encodeURIComponent(sid) + '/' + String(path).replace(/\\/g, '/');
    return fetch(url).then(r => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.blob();
    }).then(b => {
      const obj = URL.createObjectURL(b);
      if (delivPreviewCache.size >= 24) {
        const old = delivPreviewCache.keys().next().value;
        try { URL.revokeObjectURL(delivPreviewCache.get(old)); } catch (e) { /* 忽略 */ }
        delivPreviewCache.delete(old);
      }
      delivPreviewCache.set(key, obj);
      return obj;
    });
  }
  const DELIV_ACT = {
    open: p => delivApi('open', p),
    reveal: p => delivApi('reveal', p),
    preview: p => delivPreview(p),
    fail: msg => bubbleSay(msg, 4200),
  };

  function chatpAdd(kind, text) {
    const row = $new('div', 'pb2-chatp-msg pb2-' + kind);
    if (kind === 'pet' || kind === 'me') { try { renderRich(row, text); } catch (e) { row.textContent = text; } }
    else row.textContent = text;
    if (kind === 'pet') renderDeliverables(row, text, DELIV_ACT);   // v4.4：成果卡片（打开文件 / 定位文件夹）
    chatpMsgs.appendChild(row);
    chatpTrimMsgs();                                                // v5.3：按设置裁掉过老的消息（只影响显示）
    chatpMsgs.scrollTop = chatpMsgs.scrollHeight;
    return row;
  }
  /** v5.3：气泡面板最多留 settings.chatKeep 条（会话记录不动，只是面板显示裁短） */
  function chatpTrimMsgs() {
    if (!chatpMsgs) return;
    const keep = clamp(Math.round(Number(settings.chatKeep) || 60), 10, 200);
    while (chatpMsgs.childElementCount > keep) chatpMsgs.removeChild(chatpMsgs.firstElementChild);
  }

  /* ---- v4.5 双击闲聊 ↔ 气泡聊天联动 ----
   * 两条入口（双击气泡、面板输入框）发的是**同一个助手子对话**，所以面板的历史直接取会话记录：
   *   openChatPanel / 每次问答结束 → chatpSync()：拉 GET /api/sessions/{id}/messages，
   *   把 seq 大于「已渲染游标」的增量补进来（user 侧取【用户说】之后的原话，跳过人设/余额块）。
   * 发送瞬间先乐观显示（.pb2-temp），正式记录到位再替换——拉不到（离线/模拟模式）就把乐观条目转正，
   * 保证「消息不会凭空消失」。双击仍是单次气泡（不改交互），内容与面板共用一份记录。 */
  let chatpLastSeq = 0;       // 已渲染到的最新消息 seq
  let chatpSyncing = false;   // 防并发
  let chatpTemps = [];        // 乐观条目（正式记录到位后清掉）

  function chatpTemp(kind, text) {
    const el = chatpAdd(kind, text);
    el.classList.add('pb2-temp');
    chatpTemps.push(el);
    return el;
  }
  function chatpClearTemps() { for (const el of chatpTemps) { try { el.remove(); } catch (e) { /* 已移除 */ } } chatpTemps = []; }
  function chatpPromoteTemps() { for (const el of chatpTemps) el.classList.remove('pb2-temp'); chatpTemps = []; }

  /** 面板在眼前时才乐观显示（面板没开就什么都不做，之后 sync 会从会话记录补上） */
  function chatpEcho(kind, text) {
    if (!chatp || chatp.hidden || !chatpMsgs) return null;
    return chatpTemp(kind, text);
  }

  /** 从会话记录拉增量补进面板；返回是否成功（false → 调用方保留乐观条目） */
  async function chatpSync() {
    if (!chatp || !chatpMsgs || chatpSyncing) return false;
    if (settings.chatSync === false) return false;   // v5.3：关掉互通就不从会话记录补历史
    const sid = deliverSid();
    if (!sid) return false;
    chatpSyncing = true;
    try {
      const r = await fetch('/api/sessions/' + encodeURIComponent(sid) + '/messages?limit=40');
      if (!r.ok) return false;
      const j = await r.json();
      const all = (j.messages || []).slice().sort((a, b) => (a.seq || 0) - (b.seq || 0));
      const fresh = all.filter(m => (m.seq || 0) > chatpLastSeq);
      if (!fresh.length) return true;                    // 没有新的，也算成功（乐观条目留着）
      chatpClearTemps();                                 // 正式记录到位 → 临时条目退场
      for (const m of fresh) {
        chatpLastSeq = Math.max(chatpLastSeq, m.seq || 0);
        if (m.role !== 'user' && m.role !== 'assistant') continue;   // v4.6：system/工具注入不进面板
        const raw = String(m.text || '');
        if (m.role === 'assistant' && looksLikeMetaJson(raw)) continue;   // 调用统计等元数据也跳过
        const mine = m.role === 'user';
        const text = mine ? sessionUserText(raw) : raw.trim();
        if (!text) continue;                             // 人设块/注入块不进面板
        chatpAdd(mine ? 'me' : 'pet', text);
      }
      return true;
    } catch (e) { return false; }
    finally { chatpSyncing = false; }
  }

  async function chatpSend(textOverride) {
    const text = String(textOverride == null ? (chatpInput.value || '') : textOverride).trim();
    if (!text || chatpBusy) return;
    if (textOverride == null) chatpInput.value = '';
    chatpBusy = true; chatpBtn.disabled = true;
    chatpTemp('me', text);
    chatpTemp('sys', '大肥鱼思考中…');
    try {
      speechUnlock();
      const r = await chatSend(text);
      speak(r.text);
      if (!(await chatpSync())) { chatpPromoteTemps(); chatpAdd('pet', r.text); }
    } catch (e) {
      sfx('err');
      if (!(await chatpSync())) { chatpPromoteTemps(); chatpAdd('pet', '出错了：' + e.message); }
    } finally { chatpBusy = false; chatpBtn.disabled = false; chatpInput.focus(); }
  }

  /** v4.6：面板始终贴着桌宠头顶——每次打开都按桌宠当前位置重算（不再沿用拖动过的位置），
   *  桌宠移动/改大小（refreshLayout）时若面板开着也跟着走；水平方向对齐桌宠中线附近。 */
  function chatpFollowPet() {
    if (!chatp || chatp.hidden) return;
    const pr = petWrap.getBoundingClientRect();
    if (!pr.width || settings.hidden) return;                  // 桌宠量不到（隐藏中）就保持原样
    chatp.style.right = 'auto'; chatp.style.bottom = 'auto';
    // 垂直：面板底边贴在桌宠头顶上方 8px（= 发送按钮位于桌宠中线之上）
    const bottomPx = clamp(Math.round(window.innerHeight - pr.top) + 8, 8, Math.max(60, window.innerHeight - 120));
    chatp.style.bottom = bottomPx + 'px';
    chatp.style.top = 'auto';
    // 水平：面板左对齐桌宠中线往左一点，保证气泡尖角指向桌宠
    const w = chatp.offsetWidth || 322;
    const leftPx = clamp(Math.round(pr.left + pr.width / 2 - w + 46), 6, Math.max(6, window.innerWidth - w - 6));
    chatp.style.left = leftPx + 'px'; chatp.style.right = 'auto';
    // 高度上限：别顶出屏幕上沿
    const maxH = Math.max(180, Math.round(pr.top - 24));
    chatp.style.maxHeight = Math.min(maxH, Math.round(window.innerHeight * 0.62), 470) + 'px';
  }

  function openChatPanel() {
    speechUnlock(); sfx('pop');
    if (chatp) {
      chatp.hidden = false;
      try { chatpInput.focus(); } catch (e) { /* 焦点无所谓 */ }
      chatpFollowPet();   // v4.6：每次打开都重新贴合桌宠头顶
      chatpSync();        // v4.5：每次打开都补上双击闲聊等入口产生的新消息（同一会话记录）
      return;
    }
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
    chatpBtn = $new('button', 'pb2-mini pb2-mini-primary', '发送');
    chatpBtn.type = 'button';
    chatpBtn.addEventListener('click', chatpSend);
    chatpInput.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); chatpSend(); } });
    /* v5.0：表情按钮 + 表情面板（与独立聊天窗口同一套内容：最近/大肥鱼/黄豆/女仆/表情包/我的） */
    chatpFaceBtn = $new('button', 'pb2-chatp-face', '😊');
    chatpFaceBtn.type = 'button';
    chatpFaceBtn.title = '发表情（点一下直接发；输入框里有字就追加进去）';
    chatpFaceBtn.addEventListener('click', () => { chatpStickerOpen = !chatpStickerOpen; renderChatpStickers(); });
    foot.appendChild(chatpFaceBtn); foot.appendChild(chatpInput); foot.appendChild(chatpBtn);
    chatpStkPanel = $new('div', 'pb2-stkp');
    chatpStkPanel.hidden = true;
    chatp.appendChild(chatpStkPanel);
    chatp.appendChild(foot);
    /* v4.6：位置不再记忆——每次打开都贴桌宠头顶（见 appendChild 后的 chatpFollowPet()）。
     * 标题栏仍可拖动（临时挪开看内容），松手不保存，下次打开回到贴头顶的位置。 */
    let dragging = false, dragDx = 0, dragDy = 0;
    head.addEventListener('pointerdown', ev => {
      if (ev.target === close) return;
      dragging = true;
      const r = chatp.getBoundingClientRect();
      dragDx = ev.clientX - r.left; dragDy = ev.clientY - r.top;
      chatp.style.right = 'auto'; chatp.style.bottom = 'auto';
      chatp.style.left = r.left + 'px'; chatp.style.top = r.top + 'px';
      chatp.classList.add('pb2-dragging');     // v5.1：拖动时给个"提起来"的反馈
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
      chatp.classList.remove('pb2-dragging');
      sfx('tap');
      // v4.6：不再记住拖动后的位置——面板的职责是"始终贴桌宠头顶"，下次打开自动回去
    };
    head.addEventListener('pointerup', endDrag);
    head.addEventListener('pointercancel', endDrag);
    document.body.appendChild(chatp);
    chatpAdd('sys', '（试试问我余额还剩多少～）');
    chatpFollowPet();   // v4.6：贴桌宠头顶（含水平对齐与最大高度）
    chatpSync();        // v4.5：把会话记录里的历史（含双击闲聊过的）补进面板
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
