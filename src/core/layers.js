/* ============================================================================
 * pet-buddy · 共享核心（core）· 桌宠图层与输入驱动（v5.2 起）
 * ----------------------------------------------------------------------------
 * 目标：让桌宠「像 BongoCat 那样动起来」——眼珠朝指针看、手/爪跟着指针偏、
 *       按键时对应键位/手按下亮起。这里只放**纯计算**（输入 → 图层变换），
 *       不碰 DOM、不订阅事件，所以能在离线自检里逐条断言；渲染在 pet.client.js。
 *
 * 图层形状（与将来 .petpack / 外部包清单的 layers 字段同一套，导入器落地时直接复用）：
 *   layer = { id, kind:'pointer'|'key',
 *             x, y, w, h,       // 位置与尺寸（比例 0..1，相对桌宠框）
 *             rangeX, rangeY,   // kind=pointer：两轴最大位移（相对自身宽/高）
 *             rot,              // kind=pointer：整体旋转幅度（度，按横向偏移给）
 *             hand,             // kind=key：亮起哪只手（left/right/both）
 *             src }             // 可选：图层贴图（本轮不用；导入器落地时写资源名）
 * 本轮只做运行时：图层计划由 layerPlanFor() 按皮肤类型生成，运行时只认计划——
 * 下一轮解析 zip/.petpack 时，把外部清单规范化成同样的计划即可，渲染一行不用改。
 *
 * 输入源（inputSource）契约——事件形状：
 *   { kind:'pointer'|'key'|'mouse', code, key, down, x, y, t, edit? }
 *   · x/y 一律**页面坐标**（宿主全局键鼠源将来自己把屏幕坐标换算过来）；
 *   · 本轮只有「助手窗口内」一个源（页面聚焦时生效）：切到别的程序不跟——
 *     这是现阶段的天花板，宿主把全局键鼠送进来后按同一形状接上，消费端不用改。
 * ==========================================================================*/

/** 指针平滑的默认手感：tau 越小越跟手；maxSpeed = 归一化单位/秒（1 = 参考半径） */
const POINTER_FOLLOW = { tau: 0.09, maxSpeed: 3.0, snap: 0.004 };
/** 参考半径 = 桌宠宽度 × 这个倍数：鼠标离开这么远就算"看到底"（再远也不继续偏） */
const POINTER_REF_R = 2.4;/** 按键亮起的最短保持（毫秒）：再快的一下敲击也看得见，不会一闪而过 */
const PRESS_HOLD_MS = 150;
/** 「看鼠标」时整体轻偏的幅度（比例，相对桌宠宽/高；只给精灵图皮肤用） */
const BODY_LEAN = { rangeX: 0.028, rangeY: 0.018 };

/* ---- 归一化指针：鼠标位置 → 相对桌宠中心的方向与力度（各轴 -1..1） ---- */
function pointerTargetOf(px, py, cx, cy, refR) {
  const r = Number(refR) > 0 ? Number(refR) : 200;
  const nx = (Number(px) - Number(cx)) / r, ny = (Number(py) - Number(cy)) / r;
  return { x: clamp(isNaN(nx) ? 0 : nx, -1, 1), y: clamp(isNaN(ny) ? 0 : ny, -1, 1) };
}

/** 参考半径（像素）：桌宠宽度的 POINTER_REF_R 倍，但至少给到视口短边的一半——
 *  只按桌宠宽度算（96×2.4 = 230px）的话，鼠标在屏幕别处就一直是"看到底"，瞳孔全程贴边；
 *  按视口给足幅度，鼠标在中距离移动时瞳孔才有一来一回的活气。 */
function pointerRefRadius(petW, viewW, viewH) {
  const short = Math.min(Number(viewW) || 0, Number(viewH) || 0);
  return Math.max(Math.max(140, (Number(petW) || 0) * POINTER_REF_R), short * 0.45);
}

/** 平滑器状态：ready=false 表示"第一帧直接到位"（避免从 0 慢慢爬） */
function newPointerState() { return { x: 0, y: 0, ready: false }; }

/** 一步平滑：指数逼近（不振荡 ⇒ 不抖）+ 速度上限（甩得再快也不会瞬移）。
 *  每帧调一次，原地更新 st，返回当前值。 */
function pointerStep(st, tx, ty, dtSec, opt) {
  const o = opt || POINTER_FOLLOW;
  const tau = Number(o.tau) > 0 ? Number(o.tau) : POINTER_FOLLOW.tau;
  const maxSpeed = Number(o.maxSpeed) > 0 ? Number(o.maxSpeed) : POINTER_FOLLOW.maxSpeed;
  const snap = Number(o.snap) > 0 ? Number(o.snap) : POINTER_FOLLOW.snap;
  const gx = Number(tx) || 0, gy = Number(ty) || 0;
  if (!st.ready) { st.x = gx; st.y = gy; st.ready = true; return { x: st.x, y: st.y }; }
  const dt = clamp(Number(dtSec) > 0 ? Number(dtSec) : 0.016, 0.001, 0.05);   // 卡帧也不会一步跳完
  const k = 1 - Math.exp(-dt / tau);
  let sx = (gx - st.x) * k, sy = (gy - st.y) * k;
  const len = Math.hypot(sx, sy), maxStep = maxSpeed * dt;
  if (len > maxStep) { const f = maxStep / len; sx *= f; sy *= f; }
  st.x += sx; st.y += sy;
  if (Math.abs(gx - st.x) <= snap && Math.abs(gy - st.y) <= snap) { st.x = gx; st.y = gy; }  // 收尾贴齐，杜绝微抖
  return { x: st.x, y: st.y };
}

/* ---- 键位 → 手：与打字习惯一致（左手管左半、右手管右半，空格双手）；认不出返回 '' ---- */
const HAND_CODES = {
  left: ('Backquote,Digit1,Digit2,Digit3,Digit4,Digit5,Tab,CapsLock,ShiftLeft,ControlLeft,AltLeft,MetaLeft,Escape,' +
         'KeyQ,KeyW,KeyE,KeyR,KeyT,KeyA,KeyS,KeyD,KeyF,KeyG,KeyZ,KeyX,KeyC,KeyV,KeyB,F1,F2,F3,F4'),
  right: ('Digit6,Digit7,Digit8,Digit9,Digit0,Minus,Equal,Backspace,BracketLeft,BracketRight,Backslash,Semicolon,Quote,' +
          'Comma,Period,Slash,Enter,ShiftRight,ControlRight,AltRight,MetaRight,' +
          'KeyY,KeyU,KeyI,KeyO,KeyP,KeyH,KeyJ,KeyK,KeyL,KeyN,KeyM,F5,F6,F7,F8,F9,F10,F11,F12,' +
          'ArrowLeft,ArrowRight,ArrowUp,ArrowDown'),
  both: 'Space',
};
const HAND_OF_CODE = (() => {
  const m = {};
  String(HAND_CODES.left).split(',').forEach(c => { if (c) m[c] = 'left'; });
  String(HAND_CODES.right).split(',').forEach(c => { if (c) m[c] = 'right'; });
  String(HAND_CODES.both).split(',').forEach(c => { if (c) m[c] = 'both'; });
  return m;
})();
/** 键位 code（KeyboardEvent.code）→ 哪只手；认不出的键返回 ''（运行时按"双手按下"兜底） */
function handOfKeyCode(code) { return HAND_OF_CODE[String(code == null ? '' : code)] || ''; }

/* ---- 按下状态机：按下亮起、松开复原（带最短保持；丢了 keyup 也不会一直亮着） ---- */
function newPressState() { return { held: {}, lastAt: 0, lastHand: '' }; }

/** 按下：key = 键位 code（鼠标用 mouse:0 / mouse:2），hand = left/right/both/'' */
function pressPush(st, key, hand, now) {
  st.held[String(key)] = hand == null ? '' : String(hand);
  st.lastAt = Number(now) || 0;
}

/** 松开：返回这次松开的是不是真按着（没按过/重复松开 = false） */
function pressPop(st, key, now) {
  const k = String(key);
  if (!Object.prototype.hasOwnProperty.call(st.held, k)) return false;
  st.lastHand = st.held[k];
  delete st.held[k];
  st.lastAt = Number(now) || 0;
  return true;
}

/** 这一刻算不算"亮着"：有键按着，或刚松开还在最短保持期内 */
function pressActive(st, now, holdMs) {
  const hold = Number(holdMs) > 0 ? Number(holdMs) : PRESS_HOLD_MS;
  if (Object.keys(st.held).length) return true;
  return (Number(now) || 0) - (st.lastAt || 0) < hold;
}

/** 哪只手亮着：按着的手；松开后的保持期用最后松开那只手；认不出的键 = 双手（兜底也看得见） */
function pressHands(st, now, holdMs) {
  const h = { left: false, right: false };
  const keys = Object.keys(st.held);
  if (keys.length) {
    for (const k of keys) {
      const v = st.held[k];
      if (v === 'left') h.left = true;
      else if (v === 'right') h.right = true;
      else { h.left = true; h.right = true; }
    }
    return h;
  }
  if (!pressActive(st, now, holdMs)) return h;
  const v = st.lastHand == null ? '' : st.lastHand;
  if (v === 'left') h.left = true;
  else if (v === 'right') h.right = true;
  else { h.left = true; h.right = true; }
  return h;
}

/* ---- 眼球图层：两眼框与瞳孔可动范围（比例，相对桌宠框） ----
 * sprite 一组是**量出来的**：官方图集 idle 帧（192×208 格）两眼心 (95,106)/(125,107)、
 *   眼框 20×23 → cx=0.573 cy=0.512 spacing=0.156 w=0.104 h=0.112。
 * image 一组是**通用默认**（中上部）：用户可在「桌宠设置 → 眼球位置」三个滑块里对准自己的图。
 * rangeX/rangeY 是瞳孔相对眼框的可动比例——比 (1-瞳孔占比)/2 小，保证瞳孔永远不越出眼框。 */
const EYE_PLANS = {
  sprite: { cx: 0.573, cy: 0.512, spacing: 0.156, w: 0.104, h: 0.112, rangeX: 0.24, rangeY: 0.2 },
  image:  { cx: 0.5, cy: 0.36, spacing: 0.18, w: 0.1, h: 0.1, rangeX: 0.24, rangeY: 0.2 },
};
/** 眼球位置可调范围（比例）——三个滑块的上下限 */
const EYE_TUNE_RANGE = { cx: [0.1, 0.9], cy: [0.06, 0.85], spacing: [0.04, 0.6] };
/** 图片皮肤的眼球微调：把设置里的值洗成合法比例（读与写都走它，坏值不会带进渲染） */
function eyeTuneOf(raw) {
  const base = EYE_PLANS.image, t = (raw && typeof raw === 'object') ? raw : {};
  const one = (k) => {
    const v = Number(t[k]);
    return isNaN(v) ? base[k] : clamp(v, EYE_TUNE_RANGE[k][0], EYE_TUNE_RANGE[k][1]);
  };
  return { cx: one('cx'), cy: one('cy'), spacing: one('spacing') };
}
/** 眼球计划：皮肤类型（sprite 官方图集 / image 上传图片）+ 用户微调 → 可渲染的计划。
 *  sprite 的坐标是量好的，不吃微调（免得用户一拖就把官方形象的瞳孔拖歪）。 */
function eyePlanOf(kind, tune) {
  const base = EYE_PLANS[kind] || EYE_PLANS.image;
  const t = kind === 'image' ? eyeTuneOf(tune) : null;
  return {
    cx: t ? t.cx : base.cx, cy: t ? t.cy : base.cy, spacing: t ? t.spacing : base.spacing,
    w: base.w, h: base.h, rangeX: base.rangeX, rangeY: base.rangeY,
  };
}
/** 眼框（像素）：两眼各自的左上角与尺寸 + 瞳孔可动半径（瞳孔在框内动，不会跑到脸上别处） */
function eyeBoxes(plan, w, h) {
  const ew = plan.w * w, eh = plan.h * h, half = plan.spacing * w / 2;
  const cx = plan.cx * w, cy = plan.cy * h;
  const one = (left) => ({
    left: left, top: cy - eh / 2, w: ew, h: eh,
    rangeX: plan.rangeX * ew, rangeY: plan.rangeY * eh,
  });
  return [one(cx - half - ew / 2), one(cx + half - ew / 2)];
}

/** 手/爪图层：几何由 client.css 的既有布局决定（保留原视觉），这里只管"怎么动"——
 *  moveX/moveY 是位移相对**桌宠框**宽/高的系数，rot 是横向偏到底时的最大旋转角。 */
const PAW_PLAN = { rot: 10, moveX: 0.05, moveY: 0.03 };

/** 手/爪的变换（像素/度）：朝指针方向偏一点 + 转一点；w/h 是桌宠框尺寸 */
function pawTransform(plan, nx, ny, w, h) {
  const p = plan || PAW_PLAN;
  const ax = Number(nx) || 0, ay = Number(ny) || 0;
  return {
    x: ax * (Number(w) || 0) * (Number(p.moveX) || 0),
    y: ay * (Number(h) || 0) * (Number(p.moveY) || 0),
    rot: ax * (Number(p.rot) || 0),
  };
}

/** 皮肤类型 → 图层计划：
 *  · sprite（官方图集）：眼球 + 整体轻偏（她自带手，不叠浮空爪）
 *  · image（上传的图/GIF/动画 WebP）：眼球 + 手爪图层
 *  · 其它（动作包视频 / 未知）：不叠图层——视频里角色自己在动，叠上去对不上 */
function layerPlanFor(kind, tune) {
  const k = kind === 'sprite' || kind === 'image' ? kind : '';
  if (!k) return { kind: '', eyes: null, paws: null, body: null };
  return {
    kind: k,
    eyes: eyePlanOf(k, tune),
    paws: k === 'image' ? PAW_PLAN : null,
    body: k === 'sprite' ? BODY_LEAN : null,
  };
}
