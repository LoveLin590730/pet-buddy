/* ============================================================================
 * pet-buddy · 共享核心（core）· 语音播报：把回复念成「哔哔啵啵」的小人声
 * ----------------------------------------------------------------------------
 * 合成核心来自 vendor/bibibobo.js（MIT，构建期原样内联，只去掉行首 export）：
 *   一条抗混叠锯齿波 → 两个带通滤波器捏共振峰（口型）→ 一个字一声
 *   （hash(字) 选音高与口型，同一个字永远同一声）→ 每个声线一组音阶 →
 *   标点管语气（问号尾音上滑、感叹号整句升高、省略号压低）。零依赖、全离线。
 * 播放走 Web Audio 单实例：新一句开始前停掉上一句，音量统一经一个 GainNode。
 * 自动播放策略：无用户手势的冷启动会拿到 suspended 的上下文、声音出不来——
 *   本模块**静默降级**（不上屏、不报错、只记一条日志），绝不弹窗打扰。
 * 调用方约定：speak() 返回 Promise（播完/被跳过/被挡住都会 resolve，不 reject）。
 * ==========================================================================*/

  const SPEECH_SR = 44100;  // 采样率（bibibobo 原样；降到 16k 会闷掉共振峰的齿音）
  let SPEECH = null;        // { ctx, gain, src, id }：全局一份，懒创建

  /** 声线名 → 展示名（设置面板用） */
  const SPEECH_VOICE_NAMES = { fish: '大肥鱼（高）', lumo: '路墨（低）' };

  /** 语音总开关与音量（settings 是唯一真相源；改完调 speechApplyVolume） */
  function speechEnabled() { return settings.speechOn !== false; }
  function speechVolume() { return clamp(Number(settings.speechVolume) >= 0 ? Number(settings.speechVolume) : 0.5, 0, 1); }

  function speechCtx() {
    if (SPEECH && SPEECH.ctx) return SPEECH.ctx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    try {
      const ctx = new Ctx();
      const gain = ctx.createGain();
      gain.gain.value = speechVolume();
      gain.connect(ctx.destination);
      SPEECH = { ctx, gain, src: null, id: 0 };
      return ctx;
    } catch (e) { log('error', '音频上下文创建失败: ' + e.message); return null; }
  }

  function speechApplyVolume() { if (SPEECH && SPEECH.gain) SPEECH.gain.gain.value = speechVolume(); }

  /** 在用户手势里调一次：把被策略挂起的上下文唤起来（之后自动说话才出声） */
  function speechUnlock() {
    const ctx = speechCtx();
    if (!ctx) return false;
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch (e) { /* 只能等下一次手势 */ } }
    if (ctx.state !== 'running') return false;
    // 0 长度缓冲"空播"一次：部分内核要把上下文真正跑起来才算解锁
    try {
      const b = ctx.createBuffer(1, 1, SPEECH_SR);
      const s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.gain); s.start();
    } catch (e) { /* 无所谓，唤醒失败也不影响后续尝试 */ }
    return true;
  }

  function speechStop() {
    if (SPEECH && SPEECH.src) {
      const s = SPEECH.src; SPEECH.src = null;
      try { s.onended = null; s.stop(); } catch (e) { /* 已经停了 */ }
    }
  }

  /** 状态快照（诊断/验证页用） */
  function speechState() {
    return { enabled: speechEnabled(), volume: speechVolume(), hasCtx: !!(SPEECH && SPEECH.ctx), ctxState: SPEECH && SPEECH.ctx ? SPEECH.ctx.state : 'none', speaking: !!(SPEECH && SPEECH.src) };
  }

  /** 清洗成「能念的文本」：剥掉贴纸标记/代码/链接/markdown 记号，压平空白，按上限截断 */
  function speechClean(raw) {
    let t = String(raw == null ? '' : raw);
    t = t.replace(/\[(?:stick|fish|bean)\s*:[^\]]*\]/gi, ' '); // 表情/贴纸标记不念出来
    t = t.replace(/```[\s\S]*?```/g, ' ');                      // 代码块
    t = t.replace(/`[^`]*`/g, ' ');
    t = t.replace(/https?:\/\/\S+/g, ' ');                      // 链接
    t = t.replace(/[*_#>|~]/g, ' ');                            // markdown 记号
    t = t.replace(/[（(]\s*[)）]/g, ' ');
    t = t.replace(/[ \t\r\n]+/g, ' ').trim();
    const max = clamp(Math.round(Number(settings.speechMaxChars) || 60), 4, 400);
    if (t.length > max) t = t.slice(0, max).replace(/[，,、；;：:。.!！?？\s]+$/, '') + '……';
    return t;
  }

  /**
   * 念一句。
   * @param {string} raw 要说的话（会先 speechClean）
   * @param {{force?:boolean, onStart?:Function, onEnd?:Function}} [opts]
   *   force=true 时无视总开关（设置面板的「试听」用）
   * @returns {Promise<{ok:boolean, reason?:string, skipped?:string, seconds?:number, text?:string}>}
   *   ok=true 播完；ok=false 说明原因（off/empty/no-ctx/blocked/synth/start），调用方不必处理错误
   */
  function speak(raw, opts) {
    const o = opts || {};
    if (!speechEnabled() && !o.force) return Promise.resolve({ ok: false, skipped: 'off' });
    const text = speechClean(raw);
    if (!text) return Promise.resolve({ ok: false, skipped: 'empty' });
    if (o.opts) { /* 预留：逐句语速等覆盖项 */ }
    const ctx = speechCtx();
    if (!ctx) return Promise.resolve({ ok: false, reason: 'no-ctx' });
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch (e) { /* 等手势 */ } }
    let samples;
    try {
      samples = synth(text, { voice: settings.speechVoice || 'fish', step: clamp(Number(settings.speechStep) || 0.13, 0.06, 0.4), sampleRate: SPEECH_SR });
    } catch (e) {
      log('error', '语音合成失败: ' + e.message);
      return Promise.resolve({ ok: false, reason: 'synth' });
    }
    const durSec = samples.length / SPEECH_SR;
    let buf;
    try {
      buf = ctx.createBuffer(1, samples.length, SPEECH_SR);
      buf.copyToChannel(samples, 0);
    } catch (e) {
      log('error', '语音缓冲准备失败: ' + e.message);
      return Promise.resolve({ ok: false, reason: 'buffer' });
    }
    speechStop(); // 单实例：新的一句打断上一句
    const id = ++SPEECH.id;
    const node = ctx.createBufferSource();
    node.buffer = buf; node.connect(SPEECH.gain);
    SPEECH.src = node;
    if (o.onStart) { try { o.onStart({ text, seconds: durSec }); } catch (e) { /* 回调出错不影响播放 */ } }
    return new Promise((resolve) => {
      let settled = false;
      const t0 = ctx.currentTime;
      const finish = (r) => {
        if (settled) return;
        settled = true;
        if (SPEECH && SPEECH.src === node) SPEECH.src = null;
        if (o.onEnd) { try { o.onEnd(r); } catch (e) { /* 同上 */ } }
        resolve(Object.assign({ text, seconds: durSec, id }, r));
      };
      node.onended = () => finish({ ok: true });
      try { node.start(); } catch (e) { finish({ ok: false, reason: 'start' }); return; }
      // 兜底：正常播完也一定有 onended；这里只防"被策略挡住 → 一声不响也不结束"。
      // 判据：起播 350ms 后音频时钟还没走 → 认定没出声（冷启动被策略拦），静默收场。
      setTimeout(() => {
        if (settled) return;
        if (ctx.state === 'suspended' || ctx.currentTime - t0 < 0.005) {
          log('info', '语音未能出声（浏览器的自动播放策略：需要一次用户点击后才能自动说话）');
          try { node.stop(); } catch (e) { /* 未起播 */ }
          finish({ ok: false, reason: 'blocked' });
        }
      }, 350);
      // 第二道兜底：时钟异常时别让 Promise 永远挂着
      setTimeout(() => { if (!settled) { try { node.stop(); } catch (e) { /* 已停 */ } finish({ ok: true, late: true }); } }, (durSec + 1.2) * 1000);
    });
  }

  /** 试听（设置面板/菜单用：无视开关，念一句固定台词） */
  function speechProbe(text) {
    speechUnlock();
    return speak(text || '哼哼，本小姐的声音，好听吧？', { force: true });
  }
