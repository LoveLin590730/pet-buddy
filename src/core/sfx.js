/* ============================================================================
 * pet-buddy · 共享核心（core）· 交互音效（v3.3）
 * ----------------------------------------------------------------------------
 * 音效不额外找素材 —— 用同一套「哔哔啵啵」合成器（vendor/bibibobo.js）造短音：
 *   一个字 + 短时长 + 无声隙＝一声干净的「啵 / 叮 / 唰 / 哔」，与语音同一个音色家族。
 * 播放：独立 GainNode 直连输出（音量与语音分开），音效可叠加（连点不会互相掐断），
 *   但同一个音效在 90ms 内只响一次（防手抖连点糊成一片）。
 * 策略：无用户手势时静默降级（不上屏不报错）；开关默认开，音量默认 0.6。
 * ==========================================================================*/

  /** 音效谱：文本 + 声线 + 语速 + 相对音量（文本就是"念"出来的那个字） */
  const SFX_SPEC = {
    tap:  { text: '啵', voice: 'fish', step: 0.085, gain: 0.75 }, // 点桌宠
    pop:  { text: '叮', voice: 'fish', step: 0.10,  gain: 0.55 }, // 菜单/面板弹出、开始收音
    drop: { text: '唰', voice: 'lumo', step: 0.085, gain: 0.60 }, // 拖拽吸附到边缘
    ok:   { text: '嗯', voice: 'fish', step: 0.10,  gain: 0.50 }, // 听写识别成功
    err:  { text: '哔', voice: 'lumo', step: 0.12,  gain: 0.65 }, // 出错
  };
  const SFX_MIN_GAP_MS = 90;
  const SFX_CACHE = new Map();   // name → Float32Array（合成一次反复用）
  const SFX_LAST = new Map();    // name → 上次播放时刻
  let SFX_GAIN = null;

  function sfxEnabled() { return settings.sfxOn !== false; }
  function sfxVolume() { return clamp(Number(settings.sfxVolume) >= 0 ? Number(settings.sfxVolume) : 0.6, 0, 1); }

  function sfxGainNode() {
    const ctx = speechCtx();
    if (!ctx) return null;
    if (!SFX_GAIN || SFX_GAIN.context !== ctx) {
      SFX_GAIN = ctx.createGain();
      SFX_GAIN.gain.value = sfxVolume();
      SFX_GAIN.connect(ctx.destination);
    }
    return SFX_GAIN;
  }
  function sfxApplyVolume() { if (SFX_GAIN) SFX_GAIN.gain.value = sfxVolume(); }

  function sfxSamples(name) {
    if (SFX_CACHE.has(name)) return SFX_CACHE.get(name);
    const spec = SFX_SPEC[name] || SFX_SPEC.pop;
    let out = null;
    try { out = synth(spec.text, { voice: spec.voice, step: spec.step, gap: 0.01, sampleRate: SPEECH_SR }); }
    catch (e) { log('error', '音效合成失败 ' + name + ': ' + e.message); }
    SFX_CACHE.set(name, out);
    return out;
  }

  /**
   * 响一声音效。
   * @param {'tap'|'pop'|'drop'|'ok'|'err'} name
   * @param {{force?:boolean}} [opts] force=true 无视开关（设置面板试听）
   * @returns {boolean} 是否真的发起了播放（false = 关着/无音频环境/被防抖吞掉）
   */
  function sfx(name, opts) {
    const o = opts || {};
    if (!sfxEnabled() && !o.force) return false;
    const spec = SFX_SPEC[name];
    if (!spec) return false;
    const now = Date.now();
    if (!o.force && now - (SFX_LAST.get(name) || 0) < SFX_MIN_GAP_MS) return false;
    SFX_LAST.set(name, now);
    const ctx = speechCtx();
    const gain = sfxGainNode();
    if (!ctx || !gain) return false;
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch (e) { /* 等手势 */ } }
    const samples = sfxSamples(name);
    if (!samples || !samples.length) return false;
    try {
      const buf = ctx.createBuffer(1, samples.length, SPEECH_SR);
      buf.copyToChannel(samples, 0);
      const node = ctx.createBufferSource();
      node.buffer = buf;
      const v = ctx.createGain();
      v.gain.value = clamp(spec.gain * (o.force ? 1 : 1), 0, 1);
      node.connect(v); v.connect(gain);
      node.start();
      return true;
    } catch (e) { log('error', '音效播放失败 ' + name + ': ' + e.message); return false; }
  }

  /** 音效状态（设置面板/诊断用） */
  function sfxState() {
    return { enabled: sfxEnabled(), volume: sfxVolume(), hasGain: !!SFX_GAIN, cached: SFX_CACHE.size, names: Object.keys(SFX_SPEC) };
  }
