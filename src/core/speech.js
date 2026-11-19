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
      follow: speechFollowEnabled(), mode: speechMode(), ttsVoice: ttsVoicePref(), ttsRate: ttsRatePref(),
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
  /** v3.6：三种朗读模式 —— guided（语调引导）/ classic（经典合成）/ tts（普通朗读，真人声直接播） */
  function speechMode() {
    const m = String(settings.speechMode || '');
    if (m === 'guided' || m === 'classic' || m === 'tts') return m;
    return settings.speechFollow === false ? 'classic' : 'guided';
  }
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
    const rec = { pcm: pcm, durSec: pcm.length / ANALYZE_SR, srcSampleRate: buf.sampleRate, mono: mono };
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

  /* ---- v3.4.1：把 TTS 用在"选音"上，而不是逐帧重唱 ----
   * v3.4.0 试过"逐帧照抄 F0 连续重唱"（见文件末尾已弃用的 synthFollow）——听感像跑调，不好听。
   * 现在改成：**结构、音色、口型全部照经典合成**（一个字一声、声线音阶、按字选口型），
   * 只把"这个字唱哪个音"从 `hash(字)` 换成"**在声线音阶里挑最接近真人这一声的那个音**"。
   * 于是还是那个哔哔啵啵的小人声，但抑扬顿挫跟着真人语调走（疑问上扬、重音突出都能听出来）。 */

  /** 在声线音阶里挑一个最接近目标频率的音；shift = 整体平移的半音数（不传则自动试一个八度内） */
  function pickScaleMidi(f0, scale, shift) {
    const sc = (scale && scale.length) ? scale : VOICES.fish.scale;
    if (!(f0 > 0)) return sc[0];
    const target = 69 + 12 * Math.log2(f0 / 440);   // Hz → MIDI
    const shifts = (shift === undefined || shift === null) ? [-12, 0, 12] : [shift];
    let best = sc[0], bestD = Infinity;
    for (const s of sc) {
      for (const sh of shifts) {
        const d = Math.abs(s + sh - target);
        if (d < bestD) { bestD = d; best = s + sh; }
      }
    }
    return best;
  }

  /** 把一串目标音高"放进音阶"：按**相对句中位**的高低去选档。
   *  真人音域（一两百 Hz 到三百多 Hz，跨度常在 15 个半音以上）比这些小人声线（5 档、跨度 8 个半音）宽得多，
   *  直接按绝对值挑最近音，会把大半的字都挤到同一个音上（起伏全丢）——
   *  所以这里只映射**相对走向**：比句中位高就往上选，低就往下选，形状留住、幅度略微夸张一点更可爱。 */
  function guidedPickList(f0list, scale) {
    const sc = (scale && scale.length) ? scale : VOICES.fish.scale;
    const mid = (sc.length - 1) / 2;
    const vals = (f0list || []).map(v => (v > 0 ? 69 + 12 * Math.log2(v / 440) : NaN));
    const ok = vals.filter(v => !isNaN(v));
    if (!ok.length) return vals.map(() => sc[Math.round(mid)]);
    const sorted = ok.slice().sort((a, b) => a - b);
    const pct = (p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)))];
    const med = pct(0.5);
    const span = Math.max(5, (pct(0.9) - pct(0.1)) / 2);   // 自适应幅度
    return vals.map(v => {
      if (isNaN(v)) return sc[Math.round(mid)];
      const d = clamp(((v - med) / span) * 1.25, -1, 1);
      return sc[clamp(Math.round(mid + d * mid), 0, sc.length - 1)];
    });
  }

  /** 每个字的"目标音高"：把 TTS 判为浊音的帧按字数等分，每段取中位基频 */
  function guidedTargets(track, count) {
    const res = new Array(Math.max(0, count)).fill(0);
    const frames = (track && track.frames) || [];
    const voiced = [];
    for (const f of frames) if (f.f0 > 0) voiced.push(f.f0);
    if (!voiced.length || count <= 0) return res;
    const per = Math.max(1, Math.floor(voiced.length / count));
    for (let i = 0; i < count; i++) {
      const seg = voiced.slice(i * per, i === count - 1 ? voiced.length : (i + 1) * per);
      if (!seg.length) continue;
      const sorted = seg.slice().sort((a, b) => a - b);
      res[i] = sorted[Math.floor(sorted.length / 2)];
    }
    return res;
  }

  /** 语调引导合成：结构/音色/口型全照经典，只有音高按上面的"选音"来 */
  function synthGuided(text, track, opts) {
    const o = opts || {};
    const v = typeof o.voice === 'object' ? Object.assign({}, VOICES.fish, o.voice) : (VOICES[o.voice || 'fish'] || VOICES.fish);
    const sampleRate = o.sampleRate || SPEECH_SR;
    const step = o.step || v.step;
    const gap = o.gap === undefined ? 0.22 : o.gap;
    // v3.7：按标点/表情标记切段，段间停顿时长由标点决定（明显断句）
    const sentences = speechSegments(text)
      .map(s => ({ text: s.text, tk: syllables(s.text), pause: Math.max(s.pauseSec, gap * 0.6) }))
      .filter(s => s.tk.length);
    const totalTk = sentences.reduce((n, s) => n + s.tk.length, 0) || 1;
    const targets = guidedTargets(track, totalTk);
    const mids = guidedPickList(targets, v.scale);          // 按相对走向选档（不是绝对值）
    const total = sentences.reduce((n, s) => n + s.tk.length * step + s.pause, 0) + 0.4;
    const out = new Float32Array(Math.ceil(total * sampleRate));
    let t = 0.02, k = 0;
    for (const { text: s, tk, pause } of sentences) {
      const ask = /[？?]$/.test(s), shout = /[！!]/.test(s), sad = /(……|\.\.\.|…)$/.test(s);
      tk.forEach((w, i) => {
        const last = i === tk.length - 1;
        const m = (mids[k++] !== undefined ? mids[k - 1] : v.scale[0]) + (shout ? 3 : 0) - (sad ? 3 : 0);
        const dur = Math.min(step * v.hold, v.maxDur) + (last && (ask || shout || sad) ? 0.1 : 0);
        voice(out, sampleRate, t + i * step, m, dur, v,
          last && ask ? 5 : last && sad ? -4 : last ? v.fall : 0,
          hash(w));   // 口型仍按字来，保持经典听感
      });
      t += tk.length * step + pause;
    }
    for (let i = 0; i < out.length; i++) out[i] = Math.tanh(out[i] * 2.4);
    return out;
  }

  /* 已弃用（v3.4.1）：逐帧照抄 F0 的连续重唱，听感像跑调——保留代码只作对照，默认路径不再用它。 */
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
    // v3.7：表情/贴纸标记不念，但**当作一次停顿**（用户要求：[stick:…] 也算断句）
    t = t.replace(/\[(?:stick|fish|bean)\s*:[^\]]*\]/gi, '｜');
    t = t.replace(/```[\s\S]*?```/g, ' ');                      // 代码块
    t = t.replace(/`[^`]*`/g, ' ');
    t = t.replace(/https?:\/\/\S+/g, ' ');                      // 链接
    t = t.replace(/[*_#>~]/g, ' ');                             // markdown 记号（保留 ｜ 停顿标记）
    t = t.replace(/[（(]\s*[)）]/g, ' ');
    t = t.replace(/[ \t\r\n]+/g, ' ').trim();
    // v4.1：数字本地化朗读——合成音念不出阿拉伯数字串（会挤成一声），转成中文读法。
    // <8 位按位值读（67834 → 六万七千八百三十四），≥8 位逐位读（手机号/时间戳类），
    // 小数部分一律逐位（67.83 → 六十七点八三）。
    t = t.replace(/\d{1,16}(?:\.\d{1,8})?/g, function (m) { return numToZh(m); });
    t = t.replace(/\s*｜\s*/g, '｜');                            // 停顿标记两侧不留空格
    const max = clamp(Math.round(Number(settings.speechMaxChars) || 60), 4, 400);
    if (t.length > max) t = t.slice(0, max).replace(/[，,、；;：:。.!！?？｜\s]+$/, '') + '……';
    return t;
  }

  /* ---- v4.1 数字 → 中文读法（只服务朗读，不上屏） ---- */
  const ZH_DIGITS = '零一二三四五六七八九';
  /** 1~4 位整数段 → 中文（六千七百八十三；10~19 的「一十」省成「十」） */
  function numZhSeg(seg) {
    const units = ['', '十', '百', '千'];
    let out = '', zeroPending = false;
    for (let i = 0; i < seg.length; i++) {
      const d = seg.charCodeAt(i) - 48;
      const u = seg.length - 1 - i;
      if (d === 0) { if (out) zeroPending = true; }
      else {
        if (zeroPending) { out += '零'; zeroPending = false; }
        if (d === 1 && u === 1 && !out) out += '十';        // 10~19 读「十x」不读「一十x」
        else out += ZH_DIGITS[d] + units[u];
      }
    }
    return out || '零';
  }
  /** 按位值读：万/亿分组（67834 → 六万七千八百三十四；100005 → 十万零五） */
  function numZhValue(s) {
    const groups = [];
    for (let i = s.length; i > 0; i -= 4) groups.unshift(s.slice(Math.max(0, i - 4), i));
    const gu = ['', '万', '亿', '兆'];
    let out = '', prevZero = false;
    for (let i = 0; i < groups.length; i++) {
      const g = numZhSeg(groups[i]);
      const isTop = i === 0;
      if (g === '零') { prevZero = !isTop; continue; }
      if (prevZero || (!isTop && groups[i].charAt(0) === '0')) out += '零';   // 跨组连接零（10001 → 一万零一）
      out += g + gu[groups.length - 1 - i];
      prevZero = false;
    }
    return out || '零';
  }
  /** 入口：'67834' → 六点八万（5~6 位走口语简读，比「六万七千八百三十四」快一倍）；
   *        '6783' → 六千七百八十三；'67.83' → 六十七点八三；'13800001111' → 逐位 */
  function numToZh(m) {
    const parts = String(m).split('.');
    let int = parts[0].replace(/^0+(?=\d)/, '');
    let out;
    if (!int) out = '零';                                  // 纯 '0' 或 '0xx'
    else if (int.length >= 9) {                            // 长号码/时间戳：逐位读更自然
      out = '';
      for (let i = 0; i < int.length; i++) out += ZH_DIGITS[int.charCodeAt(i) - 48];
    } else if (int.length >= 5 && int.length <= 6) {
      // v4.4 口语简读：5~6 位（1 万~99 万）读成「X点X万」，口语更快；
      // 整万读「X万」，小数位为 0 时省略（67834 → 六点八万、67100 → 六点七万、60000 → 六万）
      const v = Number(int) / 10000;
      const w = Math.floor(v);
      const d = Math.round((v - w) * 10);                  // 保留一位小数（四舍五入）
      if (d === 0) out = numZhValue(String(w)) + '万';
      else if (d === 10) out = numZhValue(String(w + 1)) + '万';
      else out = numZhValue(String(w)) + '点' + ZH_DIGITS[d] + '万';
    } else out = numZhValue(int);
    if (parts.length > 1 && parts[1]) {
      out += '点';
      for (let i = 0; i < parts[1].length; i++) out += ZH_DIGITS[parts[1].charCodeAt(i) - 48];
    }
    return out;
  }


  /** 标点 → 该停多久（秒）。断句明显与否就靠这张表（v4.4：整体收紧约 20%，念得更利索） */
  function pauseOf(p) {
    if (!p) return 0.08;                       // 段与段之间的小气口
    if (p.indexOf('｜') >= 0) return 0.26;      // 表情/贴纸标记 = 明显停顿
    if (/…/.test(p)) return 0.30;               // 省略号拉长
    if (/[。！？!?]/.test(p)) return 0.24;      // 句末
    return 0.12;                                // 逗号/顿号/分号/冒号
  }

  /** 切段：每段带上"说完该停多久"（v3.7 断句的核心） */
  function speechSegments(text) {
    const s = String(text || '');
    const out = [];
    const re = /([^。！？!?…，,、；;：:｜\n]+)([。！？!?…]+|[，,、；;：:]+|｜)?/g;
    let m;
    while ((m = re.exec(s)) !== null) {
      const body = (m[1] || '').trim();
      const punct = m[2] || '';
      if (!body) { if (punct) out.push({ text: '', pauseSec: pauseOf(punct) }); continue; }
      out.push({ text: body + punct, pauseSec: pauseOf(punct) });
    }
    return out;
  }

  /** 经典合成 + 断句：逐段调用 vendor 的 synth，段间按标点插静音 */
  function synthPaced(text, opts) {
    const o = opts || {};
    const sr = o.sampleRate || SPEECH_SR;
    const segs = speechSegments(text).filter(x => syllables(x.text).length > 0);
    if (!segs.length) return new Float32Array(0);
    const parts = [];
    let total = 0.02;
    for (const seg of segs) {
      let a;
      try { a = synth(seg.text, { voice: o.voice, step: o.step, sampleRate: sr }); }
      catch (e) { continue; }
      if (!a || !a.length) continue;
      parts.push({ a: a, pause: seg.pauseSec });
      total += a.length / sr + seg.pauseSec;
    }
    if (!parts.length) return new Float32Array(0);
    const out = new Float32Array(Math.ceil(total * sr));
    let pos = Math.round(0.02 * sr);
    for (const p of parts) {
      if (pos + p.a.length <= out.length) out.set(p.a, pos);
      pos += p.a.length + Math.round(p.pause * sr);
    }
    return out;
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
    if (!text || !text.replace(/[｜\s]+/g, '')) return { ok: false, skipped: 'empty' };
    const ctx = speechCtx();
    if (!ctx) return { ok: false, reason: 'no-ctx' };
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch (e) { /* 等手势 */ } }
    // ① 三种模式（v3.6）：
    //    tts     = 普通朗读，直接用宿主 TTS 的真人声播（不走合成器、不改音色）
    //    guided  = 语调引导（经典音色 + 按真人语调选音）
    //    classic = 经典合成（完全按字）
    let samples = null, via = 'classic', sampleRate = SPEECH_SR;
    const mode = o.style || speechMode();
    if (mode === 'tts') {
      try {
        const rec = await ttsPcm(text, { rate: o.rate });
        if (rec.mono && rec.srcSampleRate) { samples = rec.mono; sampleRate = rec.srcSampleRate; via = 'tts'; }
      } catch (e) {
        log('info', '普通朗读不可用，回退语调引导：' + (e && e.message ? e.message : e));
      }
    }
    if (!samples && mode !== 'classic') {
      try {
        const rec = await ttsPcm(text, { rate: o.rate });
        let track = trackCache.get(text);
        if (!track) {
          track = prosodyTrack(rec.pcm);
          if (trackCache.size >= TTS_CACHE_MAX) trackCache.delete(trackCache.keys().next().value);
          trackCache.set(text, track);
        }
        if (track.frames.length > 2) {
          // v3.4.1：用"语调引导"（经典音色 + 按真人语调选音），不再用连续重唱
          samples = synthGuided(text, track, {
            voice: settings.speechVoice || 'fish',
            step: clamp(Number(settings.speechStep) || 0.12, 0.06, 0.4),
            sampleRate: SPEECH_SR,
          });
          via = 'guided';
        }
      } catch (e) {
        log('info', '韵律跟读不可用，改用经典合成：' + (e && e.message ? e.message : e));
      }
    }
    // ② 经典合成（回退，也是"跟读关闭"时的正路）：一个字一声
    if (!samples) {
      try {
        samples = synthPaced(text, { voice: settings.speechVoice || 'fish', step: clamp(Number(settings.speechStep) || 0.12, 0.06, 0.4), sampleRate: SPEECH_SR });
      } catch (e) {
        log('error', '语音合成失败: ' + e.message);
        return { ok: false, reason: 'synth' };
      }
    }
    const durSec = samples.length / sampleRate;
    let buf;
    try {
      buf = ctx.createBuffer(1, samples.length, sampleRate);
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
