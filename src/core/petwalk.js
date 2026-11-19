/* ============================================================================
 * pet-buddy · 共享核心（core）· 自行移动（散步）
 * ----------------------------------------------------------------------------
 * 桌宠自己走两步：这是「时间 / 模式 / 方法」的纯逻辑部分（不碰 DOM，便于自检）——
 *   时间：walkNextDelay() 算下一次出发间隔（基准 × 0.65~1.45 抖动，避免机械感）
 *   模式：stroll 走走停停（水平散步）/ roam 逛桌面（随机位置）/ off 不自己动
 *   方法：walkPlan() 按当前位置、屏幕、桌宠尺寸、速度，算出一段位移的目标点与时长；
 *         walkEase() 提供"起步慢→中间快→停下慢"的缓动，配合原地踏步动画就像真在走。
 * 素材说明：动作包里 moves 池的三个动作（螃蟹走路 / 原地漂浮踏步 / 原地左转奔跑）
 *          都是**原地**动画，位移由代码平移桌宠完成——所以这里只产出"去哪儿、走多久"。
 * 约束：只写顶层 const / function；不 import / 不 export；不碰 DOM。
 * ==========================================================================*/

  /** 散步模式（菜单按这个顺序循环） */
  const WALK_MODES = [
    { id: 'stroll', label: '走走停停' },
    { id: 'roam',   label: '逛桌面' },
    { id: 'off',    label: '不自己动' },
  ];
  /** 速度档（像素/秒） */
  const WALK_SPEEDS = [
    { id: 'slow',   label: '慢悠悠', pxPerSec: 42 },
    { id: 'normal', label: '正常',   pxPerSec: 74 },
    { id: 'fast',   label: '小跑',   pxPerSec: 124 },
  ];
  const WALK_MARGIN = 12;      // 离屏幕边缘至少留这么多（别贴边卡住）
  const WALK_MIN_DIST = 70;    // 单段最短位移（太短看着像抖）
  const WALK_MAX_DIST = 280;   // 单段最长位移
  const WALK_MIN_MS = 420;     // 单段最短时长
  const WALK_MAX_MS = 14000;   // 单段最长时长（防极慢速度走太久）
  const WALK_WARMUP_MS = 1000;  // v4.15：普通行走动作的原地前摇（原 0.5s，按用户要求 +0.5s）

  function walkModeOf(id) {
    const s = String(id == null ? '' : id);
    for (const m of WALK_MODES) if (m.id === s) return s;
    return 'stroll';
  }
  function walkModeLabel(id) {
    const s = walkModeOf(id);
    for (const m of WALK_MODES) if (m.id === s) return m.label;
    return '走走停停';
  }
  function walkSpeedOf(id) {
    const s = String(id == null ? '' : id);
    for (const sp of WALK_SPEEDS) if (sp.id === s) return sp.pxPerSec;
    return 74;
  }
  /** 速度档中文名（供自检与文案用） */
  function walkSpeedLabel(id) {
    const s = String(id == null ? '' : id);
    for (const sp of WALK_SPEEDS) if (sp.id === s) return sp.label;
    return '正常';
  }

  /** 由（随机种子, 路数）派生的稳定伪随机 0..1——一次规划里的多个随机量互不相同又可控 */
  function walkRnd(rnd, slot) {
    const x = Math.sin((Number(rnd) || 0) * 9301.13 + (Number(slot) || 0) * 49297.77) * 233280.17;
    return x - Math.floor(x);
  }

  /** 下一次出发的等待秒数：基准 × 0.65~1.45 抖动（rnd 0..1）；基准夹在 20 秒~1 小时 */
  function walkNextDelay(everySec, rnd) {
    const base = clamp(Math.round(Number(everySec) || 180), 20, 3600);
    const r = clamp(Number(rnd) || 0, 0, 1);
    return Math.max(8, Math.round(base * (0.65 + r * 0.8)));
  }

  /** 缓动 0..1：easeInOutSine（起步与收尾都慢，中间快）
   *  v5.4：位移默认改用下面的梯形速度曲线（见 walkTrapezoid），这个函数保留给"想用老曲线"的调用与自检。 */
  function walkEase(t) {
    const x = clamp(Number(t) || 0, 0, 1);
    return 0.5 - Math.cos(Math.PI * x) / 2;
  }

  /* ---- v5.4 起步/收尾速度曲线（用户要的"先加速再跑、最后收住"） ----
   * 之前用 easeInOutSine：起步与收尾都在变，但"加速段"和"整段"绑死（段越长加速越久）。
   * 现在改成**梯形速度曲线**：起步固定用 WALK_ACCEL_MS 线性加速到正常速度 → 匀速 → 收尾 WALK_DECEL_MS 减速停下。
   * 传入的是归一化时长（a = 加速段占比、b = 减速段占比），自动夹到 a+b ≤ 0.9 并归一化总位移为 1。 */
  const WALK_ACCEL_MS = 1000;      // 起步加速：速度从 0 → 正常，用 1 秒（用户要求）
  const WALK_DECEL_MS = 450;       // 收尾减速（停下不突兀）
  const WALK_WARMUP_SLOW = 1500;   // "左转 / 奔跑"类动作：先原地 1.5 秒再起（v4.15：原 1s，+0.5s）

  /** 原地前摇时长（毫秒）：动作越"重"起手越慢。
   *  ① 名字里带关键词优先（奔跑/左转 → 1s；走路/漂浮/蟹步 → 0.5s）；
   *  ② 认不出名字就看位置：动作池的**最后一个**按"左转奔跑"处理（本地模型包最后一个正是它）；
   *  ③ 都没有就用默认 0.5s。 */
  function walkWarmupFor(name, index, count) {
    const s = String(name == null ? '' : name);
    if (/奔跑|跑步|冲刺|疾走|左转|狂跑/.test(s)) return WALK_WARMUP_SLOW;
    if (/走路|行走|散步|踏步|漂浮|漂|蟹|横行|横走/.test(s)) return WALK_WARMUP_MS;
    const n = Math.round(Number(count) || 0);
    const i = Math.round(Number(index));
    if (n > 1 && !isNaN(i) && i === n - 1) return WALK_WARMUP_SLOW;
    return WALK_WARMUP_MS;
  }

  /** 梯形速度曲线的位移（0..1）：a=加速段占比、b=减速段占比（都按整段时长归一化）。 */
  function walkTrapezoid(t, a, b) {
    let ta = clamp(Number(a) || 0, 0, 0.45);
    let tb = clamp(Number(b) || 0, 0, 0.45);
    if (ta + tb > 0.9) { const k = 0.9 / (ta + tb); ta *= k; tb *= k; }
    const x = clamp(Number(t) || 0, 0, 1);
    const total = 1 - ta / 2 - tb / 2;       // 梯形面积（= 面积归一化分母）
    if (total <= 0) return x;
    let pos;
    if (ta > 0 && x < ta) pos = x * x / (2 * ta);                        // 加速段：速度 0→1
    else if (tb > 0 && x > 1 - tb) { const u = 1 - x; pos = total - u * u / (2 * tb); }   // 减速段：速度 1→0
    else pos = ta / 2 + (x - ta);                                        // 匀速段
    return clamp(pos / total, 0, 1);
  }

  /** 某一刻的位置：默认走梯形曲线（起步加速 + 收尾减速）。
   *  a/b 可传归一化的加速/减速占比；给 0 就是"立刻满速"（老行为，便于对比）。 */
  function walkPosAt(from, to, t, a, b) {
    const hasCurve = a != null || b != null;
    const e = hasCurve ? walkTrapezoid(t, a == null ? 0 : a, b == null ? 0 : b) : walkEase(t);
    return {
      left: (Number(from && from.left) || 0) + ((Number(to && to.left) || 0) - (Number(from && from.left) || 0)) * e,
      bottom: (Number(from && from.bottom) || 0) + ((Number(to && to.bottom) || 0) - (Number(from && from.bottom) || 0)) * e,
    };
  }

  /** 规划一段位移。view=视口 {w,h}；size=桌宠 {w,h}；pos=当前位置 {left,bottom}；
   *  mode=模式 id；speedId=速度档；rnd=随机种子 0..1。
   *  返回 {from,to,dir,dist,durMs,vertical} 或 null（不移动）。 */
  function walkPlan(view, size, pos, mode, speedId, rnd) {
    const m = walkModeOf(mode);
    if (m === 'off') return null;
    const vw = Math.max(1, Number(view && view.w) || 0);
    const vh = Math.max(1, Number(view && view.h) || 0);
    const pw = Math.max(1, Number(size && size.w) || 0);
    const ph = Math.max(1, Number(size && size.h) || 0);
    const from = { left: Math.round(Number(pos && pos.left) || 0), bottom: Math.round(Number(pos && pos.bottom) || 0) };
    const r = clamp(Number(rnd) || 0, 0, 1);
    const maxLeft = Math.max(WALK_MARGIN, vw - pw - WALK_MARGIN);
    const maxBottom = Math.max(WALK_MARGIN, vh - ph - WALK_MARGIN);

    /* 水平：随机方向 + 随机距离；躲开"撞边还硬走"——到边了就往回走 */
    const span = WALK_MAX_DIST - WALK_MIN_DIST;
    let dist = WALK_MIN_DIST + walkRnd(r, 1) * span;
    let dirRight = walkRnd(r, 2) < 0.5;
    if (from.left <= WALK_MARGIN + 2) dirRight = true;              // 贴左墙 → 只能向右
    else if (from.left >= maxLeft - 2) dirRight = false;            // 贴右墙 → 只能向左

    let targetLeft = from.left + (dirRight ? dist : -dist);
    if (targetLeft < WALK_MARGIN) { targetLeft = Math.min(maxLeft, WALK_MARGIN + (from.left - WALK_MARGIN) + dist / 2); }
    if (targetLeft > maxLeft) { targetLeft = Math.max(WALK_MARGIN, maxLeft - dist / 2); }
    targetLeft = clamp(Math.round(targetLeft), WALK_MARGIN, maxLeft);

    /* 垂直（逛桌面模式才有）：上/下飘 60~200px */
    let targetBottom = from.bottom;
    if (m === 'roam') {
      const vDist = 60 + walkRnd(r, 3) * 140;
      const up = walkRnd(r, 4) < 0.5;
      targetBottom = clamp(Math.round(from.bottom + (up ? vDist : -vDist)), WALK_MARGIN, maxBottom);
    }

    const dx = targetLeft - from.left, dy = targetBottom - from.bottom;
    const real = Math.sqrt(dx * dx + dy * dy);
    if (real < 16) return null;                                     // 几乎没动就别走了（防原地抽搐）

    const pxPerSec = walkSpeedOf(speedId);
    const durMs = clamp(Math.round(real / pxPerSec * 1000), WALK_MIN_MS, WALK_MAX_MS);
    return {
      from: from,
      to: { left: targetLeft, bottom: targetBottom },
      dir: dx >= 0 ? 'right' : 'left',
      dist: Math.round(real),
      durMs: durMs,
      vertical: Math.abs(dy) > 4,
      mode: m,
    };
  }

  /** 一次散步走几段（走走停停更像在散步；逛桌面通常一段到位） */
  function walkSegCount(mode, rnd) {
    const m = walkModeOf(mode);
    if (m === 'off') return 0;
    if (m === 'roam') return 1;
    return 1 + Math.floor(walkRnd(Number(rnd) || 0, 5) * 3);        // 1~3 段
  }

  /** 两段之间歇多久（毫秒）：400~1400，逛桌面短一点 */
  function walkPauseMs(mode, rnd) {
    const m = walkModeOf(mode);
    const base = m === 'roam' ? 260 : 420;
    return Math.round(base + walkRnd(Number(rnd) || 0, 6) * 1000);
  }
