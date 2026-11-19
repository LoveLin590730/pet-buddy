/* ============================================================================
 * pet-buddy · 共享核心（core）· 语音听写：对着桌宠说话（右 Alt+M）
 * ----------------------------------------------------------------------------
 * 采集：16 kHz 单声道（AudioContext + MediaStreamSource + ScriptProcessor，
 *   与宿主「语音」组件同一套做法；内核给不到 16k 时内部线性重采样到 16k）。
 * VAD：噪声底自适应，阈值 = max(0.008, 底 × 3.5)（与宿主语音组件同口径）；
 *   尾部静音满 2 秒、或松开热键、或超过 60 秒 → 收尾。
 * 识别：POST /api/c/voice/asr/transcribe —— 宿主「语音」组件的本地离线模型
 *   （零配置、不联网）。组件被关掉时该端点 404，这里给出人话提示，不假装成功。
 * 触发：右 Alt + M（按住说话，松开结束）。左 Alt 是助手自带的听写，本插件不碰。
 * 纪律：识别结果先回显给用户看（「你说：…」）再发出去；空结果不发送。
 * 调用方约定：viStart() 可能失败（未授权/无麦克风），一律返回 {ok, reason}。
 * ==========================================================================*/

  const VI_ASR_URL = '/api/c/voice/asr/transcribe';
  const VI_SR = 16000;            // 识别引擎要的采样率
  const VI_MIN_SPEECH_MS = 350;   // 短于它算噪声毛刺（不说话就不发）
  const VI_TAIL_SILENCE_MS = 2000;// 尾部静音满 2 秒自动收尾
  const VI_MAX_MS = 60000;        // 单次上限
  const VI = {
    phase: 'idle', stream: null, ctx: null, node: null, srcNode: null,
    frames: [], speechMs: 0, silenceMs: 0, noise: 0.004, startedAt: 0, level: 0,
    cbs: [], resultCbs: [], lastErr: '', autoStopped: false, timer: null,
  };

  function viPhase() { return VI.phase; }
  function viLastError() { return VI.lastErr; }
  /** 订阅状态变化：cb(phase, info)；phase = idle | recording | recognizing | error */
  function viOn(cb) { if (typeof cb === 'function') VI.cbs.push(cb); }
  /** 订阅「一轮听写的结论」：cb({ok, text?, reason?})——手动松开、静音自动收尾都走这里 */
  function viOnResult(cb) { if (typeof cb === 'function') VI.resultCbs.push(cb); }
  function viEmitResult(r) { for (const cb of VI.resultCbs) { try { cb(r); } catch (e) { /* 回调异常不影响流程 */ } } }
  function viEmit(extra) {
    const info = Object.assign({ level: VI.level, ms: Date.now() - VI.startedAt, err: VI.lastErr }, extra || {});
    for (const cb of VI.cbs) { try { cb(VI.phase, info); } catch (e) { /* 回调异常不影响录音流程 */ } }
  }
  function viSetPhase(p, extra) { VI.phase = p; viEmit(extra); }

  /** 线性重采样（内核给不到 16k 时用；语音带宽窄，这样够） */
  function viResample(input, fromRate, toRate) {
    if (fromRate === toRate) return input;
    const ratio = fromRate / toRate;
    const outLen = Math.max(1, Math.floor(input.length / ratio));
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const pos = i * ratio, i0 = Math.floor(pos), i1 = Math.min(input.length - 1, i0 + 1), frac = pos - i0;
      out[i] = input[i0] * (1 - frac) + input[i1] * frac;
    }
    return out;
  }
  /** Float32 采样 → 16 位单声道 WAV 的 base64（ASR 接口要的格式） */
  function viWavB64(floats) {
    const len = floats.length;
    const buf = new ArrayBuffer(44 + len * 2);
    const v = new DataView(buf);
    const wstr = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    wstr(0, 'RIFF'); v.setUint32(4, 36 + len * 2, true); wstr(8, 'WAVE');
    wstr(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, VI_SR, true); v.setUint32(28, VI_SR * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    wstr(36, 'data'); v.setUint32(40, len * 2, true);
    for (let i = 0; i < len; i++) {
      const s = Math.max(-1, Math.min(1, floats[i]));
      v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    const u8 = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  /** 语音识别（本地离线模型）：返回识别文本（空串＝没听清） */
  async function viTranscribe(wavB64) {
    const ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), 90000) : null;
    try {
      const r = await fetch(VI_ASR_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cmd: 'transcribe', model: 'xasr', device: 'cpu', wav_b64: wavB64 }),
        signal: ctl ? ctl.signal : undefined,
      });
      if (r.status === 404) throw new Error('语音听写不可用：宿主的「语音」组件未开启（设置 → 语音）');
      if (!r.ok) throw new Error('语音识别失败（HTTP ' + r.status + '）');
      const d = await r.json();
      return String((d && (d.text || d.result)) || '').trim();
    } finally { if (timer) clearTimeout(timer); }
  }

  function viTeardown() {
    if (VI.timer) { clearInterval(VI.timer); VI.timer = null; }
    try { if (VI.node) VI.node.disconnect(); } catch (e) { /* 已断 */ }
    try { if (VI.srcNode) VI.srcNode.disconnect(); } catch (e) { /* 已断 */ }
    try { if (VI.ctx) VI.ctx.close(); } catch (e) { /* 已关 */ }
    try { if (VI.stream) VI.stream.getTracks().forEach((t) => t.stop()); } catch (e) { /* 已停 */ }
    VI.node = null; VI.srcNode = null; VI.ctx = null; VI.stream = null;
    VI.frames = []; VI.speechMs = 0; VI.silenceMs = 0; VI.noise = 0.004; VI.level = 0;
  }

  /** 开始录音。返回 {ok:true} 或 {ok:false, reason} */
  async function viStart() {
    if (VI.phase === 'recording') return { ok: true, already: true };
    if (VI.phase === 'recognizing') return { ok: false, reason: 'busy' };
    VI.lastErr = ''; VI.autoStopped = false;
    const md = (typeof navigator !== 'undefined' && navigator.mediaDevices) ? navigator.mediaDevices : null;
    if (!md || !md.getUserMedia) {
      VI.lastErr = '当前环境没有麦克风接口（需要 https 或本机地址）';
      viSetPhase('error', { reason: 'no-api' });
      return { ok: false, reason: VI.lastErr };
    }
    let stream;
    try {
      stream = await md.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      const denied = e && (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError');
      VI.lastErr = denied ? '麦克风未授权（Windows 设置 → 隐私 → 麦克风 / 允许桌面应用访问）' : ('麦克风不可用：' + (e && e.message ? e.message : e));
      viSetPhase('error', { reason: 'mic' });
      return { ok: false, reason: VI.lastErr };
    }
    VI.stream = stream;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      VI.ctx = new Ctx({ sampleRate: VI_SR });
    } catch (e) { VI.ctx = new (window.AudioContext || window.webkitAudioContext)(); }
    VI.srcNode = VI.ctx.createMediaStreamSource(stream);
    VI.node = VI.ctx.createScriptProcessor(4096, 1, 1);
    VI.frames = []; VI.speechMs = 0; VI.silenceMs = 0; VI.noise = 0.004; VI.startedAt = Date.now();
    VI.node.onaudioprocess = (ev) => {
      if (VI.phase !== 'recording') return;
      const f = ev.inputBuffer.getChannelData(0);
      let sum = 0;
      for (let i = 0; i < f.length; i++) sum += f[i] * f[i];
      const rms = Math.sqrt(sum / f.length);
      VI.level = Math.min(1, rms * 7);
      const frameMs = (f.length / VI.ctx.sampleRate) * 1000;
      const isSpeech = rms > Math.max(0.008, VI.noise * 3.5);
      if (!isSpeech) VI.noise = Math.min(0.02, VI.noise * 0.98 + rms * 0.02);
      if (isSpeech) {
        VI.frames.push(new Float32Array(f));
        VI.speechMs += frameMs; VI.silenceMs = 0;
      } else if (VI.speechMs > 0) {
        VI.frames.push(new Float32Array(f)); // 说话后的间隙也留着（识别更连贯），由收尾统一截
        VI.silenceMs += frameMs;
      }
      // 自动收尾：说过话 + 尾部静音满 2 秒（或单次超上限）
      if ((VI.speechMs >= VI_MIN_SPEECH_MS && VI.silenceMs >= VI_TAIL_SILENCE_MS) || (Date.now() - VI.startedAt > VI_MAX_MS)) {
        VI.autoStopped = true;
        viEmit({ auto: true });
        setTimeout(() => { viStop().catch(() => {}); }, 0);
      }
    };
    VI.srcNode.connect(VI.node);
    VI.node.connect(VI.ctx.destination); // 内核要求节点入图才会回调
    viSetPhase('recording', { started: true });
    try { if (VI.ctx.state === 'suspended') await VI.ctx.resume(); } catch (e) { /* 唤醒失败也继续录 */ }
    return { ok: true };
  }

  /** 结束录音并识别。结论经 viOnResult 派发（无论成功失败），同时作为返回值给出 */
  async function viStop() {
    if (VI.phase !== 'recording') return { ok: false, reason: 'not-recording' };
    const ctxRate = VI.ctx ? VI.ctx.sampleRate : VI_SR;
    const frames = VI.frames, speechMs = VI.speechMs;
    viTeardown();
    viSetPhase('recognizing', { speechMs });
    if (speechMs < VI_MIN_SPEECH_MS) {
      VI.lastErr = '没听到说话（按住 ' + VI_HOTKEY_LABEL + ' 说完再松开）';
      viSetPhase('idle', { silent: true });
      const r = { ok: false, reason: 'silent', silent: true, message: VI.lastErr };
      viEmitResult(r);
      return r;
    }
    const total = frames.reduce((n, c) => n + c.length, 0);
    const all = new Float32Array(total);
    let off = 0;
    for (const c of frames) { all.set(c, off); off += c.length; }
    const pcm = viResample(all, ctxRate, VI_SR);
    try {
      const text = await viTranscribe(viWavB64(pcm));
      viSetPhase('idle', { text });
      if (!text) {
        VI.lastErr = '没听清（说得慢一点、离麦克风近一点）';
        const r = { ok: false, reason: 'empty', message: VI.lastErr };
        viEmitResult(r);
        return r;
      }
      const r = { ok: true, text, seconds: pcm.length / VI_SR };
      viEmitResult(r);
      return r;
    } catch (e) {
      VI.lastErr = (e && e.name === 'AbortError') ? '语音识别超时（识别引擎忙或组件未就绪）' : (e && e.message ? e.message : String(e));
      viSetPhase('error', { reason: 'asr' });
      const r = { ok: false, reason: VI.lastErr, message: VI.lastErr };
      viEmitResult(r);
      return r;
    }
  }

  /** 放弃这一轮（按键取消/失焦）：不识别、不上传 */
  function viCancel() {
    if (VI.phase !== 'recording') return false;
    viTeardown();
    viSetPhase('idle', { cancelled: true });
    return true;
  }

  /* ---- 右 Alt + M：按住说话（左 Alt 属于助手自带的听写，这里不碰） ----
   * 浏览器对右 Alt 的报法不统一：key='Alt' + location=2，或 key='AltGraph'；
   * 两种都认。热键只负责"何时按下/松开"，具体流程由调用方决定。
   * handlers = { onStart, onCancel }：按下时调 onStart；松开时调用方自行 viStop()
   * （viStop 的结论经 viOnResult 派发，所以松开处理不必回传）。 */
  let VI_HOTKEY_BOUND = false;
  let viRightAlt = false;
  function viWatchHotkey(handlers) {
    if (VI_HOTKEY_BOUND) return false;
    VI_HOTKEY_BOUND = true;
    const h = handlers || {};
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Alt' && e.location === 2) viRightAlt = true;
      if (e.key === 'AltGraph') viRightAlt = true;
      if (e.code === 'KeyM' && viRightAlt && !e.repeat) {
        e.preventDefault();
        if (h.onStart) { try { h.onStart(); } catch (err) { /* 调用方异常不影响热键 */ } }
      }
    }, true);
    document.addEventListener('keyup', (e) => {
      if (e.key === 'Alt' && e.location === 2) viRightAlt = false;
      if (e.key === 'AltGraph') viRightAlt = false;
      if (e.code === 'KeyM' && VI.phase === 'recording') {
        e.preventDefault();
        if (h.onStop) { try { h.onStop(); } catch (err) { /* 同上 */ } }
        else viStop().catch(() => {});
      }
    }, true);
    window.addEventListener('blur', () => {
      viRightAlt = false;
      if (VI.phase === 'recording' && viCancel() && h.onCancel) { try { h.onCancel(); } catch (err) { /* 同上 */ } }
    });
    return true;
  }

  /** 热键文案（气泡与设置里共用一处，避免两处写岔） */
  const VI_HOTKEY_LABEL = '右 Alt + M';
