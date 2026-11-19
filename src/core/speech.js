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
    return {
      enabled: speechEnabled(), volume: speechVolume(), hasCtx: !!(SPEECH && SPEECH.ctx),
      ctxState: SPEECH && SPEECH.ctx ? SPEECH.ctx.state : 'none', speaking: !!(SPEECH && SPEECH.src),
      follow: speechFollowEnabled(), ttsVoice: ttsVoicePref(), ttsRate: ttsRatePref(),
      ttsCached: ttsCache.size,
    };
  }

  /* ================= v3.4 韵律跟读：TTS → 音高/口型/音量 → 锯齿+带通重唱 =================
   * 经典合成是"一个字一声"（音高只有 5 档、按字哈希决定），所以听起来偏念经、离真人语调远。
   * 这一版换条路：先请宿主「语音」组件的后端 TTS（POST /api/voice/tts，Edge 通道、免配置）
   * 把整句真读一遍，再从这段音频里**逐帧量出**三样东西——
   *   ① 基频 F0（自相关，即"语调"）② 能量（即"轻重"）③ 过零率（当"口型"的粗线索），
   * 最后用 bibibobo 那套「抗混叠锯齿波 + 两个带通」照着这条曲线重唱。
   * 效果：音色仍是「哔哔啵啵」，但抑扬顿挫、疑问上扬、停顿长短全是真人语气。
   * 全流程走本机后端（TTS 在宿主侧合成）；任何一步失败都回退经典合成，绝不因此不出声。 */

  const ANALYZE_SR = 16000;            // 分析用采样率（量音高足够，算得快）
  const PROSODY_HOP_SEC = 0.02;        // 每 20ms 一帧
  const PROSODY_WIN = 1024;            // 每帧 64ms 窗
  const F0_MIN = 70, F0_MAX = 400;     // 人声基频范围
  const TTS_CACHE_MAX = 24;            // 最近若干句的 TTS 结果（同一句重播不再请求）
  const TTS_TIMEOUT_MS = 9000;

  const ttsCache = new Map();          // 文本 → { pcm:Float32Array(16k), durSec }
  const trackCache = new Map();        // 文本 → 韵律轨

  function speechFollowEnabled() { return settings.speechFollow !== false; }
  function ttsVoicePref() { return String(settings.ttsVoice || ''); }
  function ttsRatePref() { return clamp(Number(settings.ttsRate) || 1, 0.5, 2); }

  /** 调宿主后端 TTS 取音频 → 解码 → 16k 单声道 PCM（失败抛错，由 speak 回退经典合成） */
  async function ttsPcm(text, opts) {
    const hit = ttsCache.get(text);
    if (hit) return hit;
    const ctx = speechCtx();
    if (!ctx) throw new Error('no-ctx');
    const o = opts || {};
    const ctrl = new AbortController();
    const timer = setTimeout(() => { try { ctrl.abort(); } catch (e) { /* 已结束 */ } }, o.timeout || TTS_TIMEOUT_MS);
    let ab;
    try {
      const res = await fetch('/api/voice/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text, rate: o.rate || ttsRatePref(), voice: o.voice || ttsVoicePref() }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error('TTS HTTP ' + res.status);
      ab = await res.arrayBuffer();
      if (!ab || ab.byteLength < 512) throw new Error('TTS 音频过短');
    } finally { clearTimeout(timer); }
    const buf = await ctx.decodeAudioData(ab);
    const mono = mixToMono(buf);
    const pcm = buf.sampleRate === ANALYZE_SR ? mono : resampleLinear(mono, buf.sampleRate, ANALYZE_SR);
    const rec = { pcm: pcm, durSec: pcm.length / ANALYZE_SR, srcSampleRate: buf.sampleRate };
    if (ttsCache.size >= TTS_CACHE_MAX) ttsCache.delete(ttsCache.keys().next().value);
    ttsCache.set(text, rec);
    return rec;
  }

  function mixToMono(buf) {
    const n = buf.length, out = new Float32Array(n);
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < n; i++) out[i] += d[i];
    }
    if (buf.numberOfChannels > 1) for (let i = 0; i < n; i++) out[i] /= buf.numberOfChannels;
    return out;
  }

  /** 线性重采样（TTS 源多为 24k/44.1k → 16k） */
  function resampleLinear(x, srIn, srOut) {
    if (!x.length || srIn === srOut) return x;
    const ratio = srOut / srIn, n = Math.max(1, Math.round(x.length * ratio)), out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const pos = i / ratio, i0 = Math.floor(pos), frac = pos - i0;
      const a = x[i0] || 0, b = x[i0 + 1] !== undefined ? x[i0 + 1] : a;
      out[i] = a + (b - a) * frac;
    }
    return out;
  }

  /** 逐帧量韵律（20ms 一帧） */
  function prosodyTrack(pcm) {
    const sr = ANALYZE_SR;
    const hop = Math.max(1, Math.round(PROSODY_HOP_SEC * sr));
    const win = PROSODY_WIN;
    const frames = [];
    let prevF0 = 0;
    for (let s = 0; s + win <= pcm.length; s += hop) {
      const f = analyzeFrame(pcm, s, win, sr, prevF0);
      if (f.f0 > 0) prevF0 = f.f0;
      frames.push(f);
    }
    return { frames: frames, hopSec: hop / sr, durSec: pcm.length / sr, sr: sr };
  }

  /** 单帧分析：去均值 → 自相关找基频（粗搜再细搜，省一半算力）→ 能量与过零率 */
  function analyzeFrame(x, start, win, sr, prevF0) {
    let mean = 0;
    for (let i = 0; i < win; i++) mean += x[start + i];
    mean /= win;
    let energy = 0, zc = 0, prevSign = 0;
    for (let i = 0; i < win; i++) {
      const v = x[start + i] - mean;
      energy += v * v;
      const sgn = v >= 0 ? 1 : 0;
      if (i && sgn !== prevSign) zc++;
      prevSign = sgn;
    }
    const rms = Math.sqrt(energy / win);
    const minLag = Math.max(2, Math.floor(sr / F0_MAX));
    const maxLag = Math.min(win - 4, Math.floor(sr / F0_MIN));
    const corr = (lag) => {
      let acc = 0;
      for (let i = 0; i + lag < win; i++) acc += (x[start + i] - mean) * (x[start + i + lag] - mean);
      return acc / (win - lag);
    };
    let best = -Infinity, bestLag = 0;
    const lags = [];
    for (let lag = minLag; lag <= maxLag; lag += 3) lags.push(lag);            // 粗搜
    for (let lag = Math.max(minLag, bestLag ? bestLag - 3 : minLag); lag <= Math.min(maxLag, (bestLag || minLag) + 3); lag++) {
      if (lags.indexOf(lag) < 0) lags.push(lag);                              // 细搜（稍后统一打分）
    }
    const scored = lags.map((lag) => ({ lag, v: corr(lag) }));
    for (const s of scored) if (s.v > best) { best = s.v; bestLag = s.lag; }
    // 整数倍陷阱：200Hz 的 lag=80/160/240 相关性几乎一样高，取全局最大会误判成低八度。
    // 解决：先找最大，再取"第一个达到 0.9×最大"的 lag（= 最短周期 = 真实基频）。
    if (bestLag) {
      for (const s of scored) {
        if (s.lag < bestLag && s.v >= best * 0.9) { bestLag = s.lag; break; }
      }
    }
    const conf = best / (energy / win + 1e-9);
    let f0 = 0;
    if (rms > 0.006 && conf > 0.25 && bestLag > 0) {
      f0 = sr / bestLag;
      if (prevF0 > 0) {   // 八度纠错：人声不会一帧跳八度
        const cands = [f0, f0 * 2, f0 / 2];
        let pick = f0, bestDiff = Math.abs(Math.log(f0 / prevF0));
        for (const c of cands) { const d = Math.abs(Math.log(c / prevF0)); if (d < bestDiff) { bestDiff = d; pick = c; } }
        f0 = pick;
      }
      if (f0 < F0_MIN || f0 > F0_MAX) f0 = 0;
    }
    // 过零率 → 口型档：高频多的（前元音/齿音）用亮口型，低沉的用暗口型
    const zcr = zc / win;
    const vowel = zcr > 0.18 ? 4 : zcr > 0.12 ? 1 : zcr > 0.08 ? 0 : zcr > 0.05 ? 3 : 2;
    return { f0: f0, rms: rms, vowel: vowel, zcr: zcr };
  }

  /** 按韵律轨"重唱"：锯齿波 + 两个带通（bibibobo 同款内核），逐帧跟随音高 / 口型 / 音量 */
  function synthFollow(track, opts) {
    const o = opts || {};
    const v = VOICES[o.voice || 'fish'] || VOICES.fish;
    const sr = SPEECH_SR;
    const frames = track.frames || [];
    const out = new Float32Array(Math.max(1, Math.ceil((track.durSec + 0.06) * sr)));
    if (!frames.length) return out;
    const osc = saw(sr);
    const bp1 = bandpass(sr), bp2 = bandpass(sr);
    let ampSm = 0, f0Sm = frames[0].f0 > 0 ? frames[0].f0 : 180;
    for (let i = 0; i < out.length; i++) {
      const fi = Math.min(frames.length - 1, Math.floor((i / sr) / track.hopSec));
      const fr = frames[fi];
      if (!fr) break;
      const voiced = fr.f0 > 0;
      // 平稳化：音高/音量都走一阶低通（否则有台阶声）；清音段保留少量气息
      const fTarget = voiced ? fr.f0 : f0Sm;
      const aTarget = clamp(fr.rms * 7, 0, 1.2) * (voiced ? 1 : 0.25);
      f0Sm += (fTarget - f0Sm) * 0.25;
      ampSm += (aTarget - ampSm) * 0.2;
      const [a, b] = VOWELS[fr.vowel % VOWELS.length];
      const s = osc(f0Sm);
      out[i] = (bp1(s, a * v.formant, 4) + 0.7 * bp2(s, b * v.formant, 5)) * ampSm * v.gain * 3.0;
    }
    // 峰值归一 + 软限幅：响度稳（音量交给播放端的 GainNode），音色不变
    let peak = 0;
    for (let i = 0; i < out.length; i++) { const a2 = Math.abs(out[i]); if (a2 > peak) peak = a2; }
    if (peak > 0) { const k = 0.9 / peak; for (let i = 0; i < out.length; i++) out[i] = Math.tanh(out[i] * k * 1.6) * 0.95; }
    return out;
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
  async function speak(raw, opts) {
    const o = opts || {};
    if (!speechEnabled() && !o.force) return { ok: false, skipped: 'off' };
    const text = speechClean(raw);
    if (!text) return { ok: false, skipped: 'empty' };
    const ctx = speechCtx();
    if (!ctx) return { ok: false, reason: 'no-ctx' };
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch (e) { /* 等手势 */ } }
    // ① 韵律跟读（默认）：向宿主后端 TTS 要一遍真语音 → 量出语调/轻重/口型 → 用锯齿+带通重唱
    let samples = null, via = 'classic';
    if (speechFollowEnabled() && o.style !== 'classic') {
      try {
        const rec = await ttsPcm(text, { rate: o.rate });
        let track = trackCache.get(text);
        if (!track) {
          track = prosodyTrack(rec.pcm);
          if (trackCache.size >= TTS_CACHE_MAX) trackCache.delete(trackCache.keys().next().value);
          trackCache.set(text, track);
        }
        if (track.frames.length > 2) { samples = synthFollow(track, { voice: settings.speechVoice || 'fish' }); via = 'follow'; }
      } catch (e) {
        log('info', '韵律跟读不可用，改用经典合成：' + (e && e.message ? e.message : e));
      }
    }
    // ② 经典合成（回退，也是"跟读关闭"时的正路）：一个字一声
    if (!samples) {
      try {
        samples = synth(text, { voice: settings.speechVoice || 'fish', step: clamp(Number(settings.speechStep) || 0.13, 0.06, 0.4), sampleRate: SPEECH_SR });
      } catch (e) {
        log('error', '语音合成失败: ' + e.message);
        return { ok: false, reason: 'synth' };
      }
    }
    const durSec = samples.length / SPEECH_SR;
    let buf;
    try {
      buf = ctx.createBuffer(1, samples.length, SPEECH_SR);
      buf.copyToChannel(samples, 0);
    } catch (e) {
      log('error', '语音缓冲准备失败: ' + e.message);
      return { ok: false, reason: 'buffer' };
    }
    speechStop(); // 单实例：新的一句打断上一句
    const id = ++SPEECH.id;
    const node = ctx.createBufferSource();
    node.buffer = buf; node.connect(SPEECH.gain);
    SPEECH.src = node;
    if (o.onStart) { try { o.onStart({ text, seconds: durSec, via }); } catch (e) { /* 回调出错不影响播放 */ } }
    return new Promise((resolve) => {
      let settled = false;
      const t0 = ctx.currentTime;
      const finish = (r) => {
        if (settled) return;
        settled = true;
        if (SPEECH && SPEECH.src === node) SPEECH.src = null;
        if (o.onEnd) { try { o.onEnd(r); } catch (e) { /* 同上 */ } }
        resolve(Object.assign({ text, seconds: durSec, id, via }, r));
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
