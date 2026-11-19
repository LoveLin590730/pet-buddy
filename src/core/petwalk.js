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
  const WALK_WARMUP_MS = 500;  // v5.2：行走动作有前摇——先原地踏步这么久再开始位移（至少 0.5s）

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

  /** 缓动 0..1：easeInOutSine（起步与收尾都慢，中间快） */
  function walkEase(t) {
    const x = clamp(Number(t) || 0, 0, 1);
    return 0.5 - Math.cos(Math.PI * x) / 2;
  }

  /** 某一刻的位置（线性插值 + 缓动） */
  function walkPosAt(from, to, t) {
    const e = walkEase(t);
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
