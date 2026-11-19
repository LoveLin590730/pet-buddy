/* ============================================================================
 * pet-buddy · 共享核心（core）· 余额与积分
 * ----------------------------------------------------------------------------
 * src/core/*.js 是桌宠半边（client.js）与聊天窗口半边（chat.html）的唯一真相源：
 * 两份产物中都含同一段代码，由 build.mjs 按标记注入——改这里，两端同时生效。
 * 约束：只写顶层 const / function；不 import、不 export、不依赖宿主环境；
 *       去掉行首 export 即可作为普通脚本内联（手法参考 hakihakii/bibibobo）。
 * 切勿手改产物（client.js / chat.html），它们会被 build.mjs 覆盖。
 * ==========================================================================*/

  /* ================= 余额引擎 ================= */
  // 价目（元/百万 token）：[谷, 峰]。prompt 无缓存命中细分，按未命中价保守估算。
  const PRICES = {
    flash: { hit: [0.02, 0.04], miss: [1, 2], out: [4, 8] },
    pro:   { hit: [0.15, 0.3],  miss: [4.5, 9], out: [13.5, 27] },
  };
  // 全天谷价的法定假日（2026 年公开放假安排）
  const HOLIDAY_VALLEY = new Set([
    '2026-01-01','2026-01-02','2026-01-03',
    '2026-02-15','2026-02-16','2026-02-17','2026-02-18','2026-02-19','2026-02-20','2026-02-21','2026-02-22','2026-02-23',
    '2026-04-04','2026-04-05','2026-04-06',
    '2026-05-01','2026-05-02','2026-05-03','2026-05-04','2026-05-05',
    '2026-06-19','2026-06-20','2026-06-21',
    '2026-09-25','2026-09-26','2026-09-27',
    '2026-10-01','2026-10-02','2026-10-03','2026-10-04','2026-10-05','2026-10-06','2026-10-07',
  ]);
  const pad2 = n => String(n).padStart(2, '0');
  function localDateStr(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  // 谷价：北京时间 00:30–08:30（对应官方错峰时段）或法定假日全天
  function isValley(now) {
    const d = now || new Date();
    if (HOLIDAY_VALLEY.has(localDateStr(d))) return true;
    const mins = d.getHours() * 60 + d.getMinutes();
    return mins >= 30 && mins < 510; // 00:30 ~ 08:30
  }
  function priceTier(model) {
    const m = (model || '').toLowerCase();
    return m.indexOf('pro') >= 0 ? PRICES.pro : PRICES.flash;
  }

  let balCache = { at: 0, data: null };
  let gatewayInfo = { baseURL: '', at: 0 };
  async function gatewayBase() {
    if (gatewayInfo.at && Date.now() - gatewayInfo.at < 300000) return gatewayInfo.baseURL;
    try {
      const r = await fetch('/api/config', { headers: { 'Accept': 'application/json' } });
      if (r.ok) { const j = await r.json(); gatewayInfo = { baseURL: String(j.baseURL || ''), at: Date.now() }; }
    } catch (e) { /* 离线 */ }
    return gatewayInfo.baseURL;
  }
  async function todaySpend(force) {
    if (!force && balCache.data && Date.now() - balCache.at < 60000) return balCache.data;
    const valley = isValley(new Date());
    const out = { date: localDateStr(new Date()), prompt: 0, cacheHit: 0, output: 0, calls: 0, cost: 0, costCredits: 0, credits: null, companyQuota: null, valley, sessions: 0, staleSessions: 0, apiOk: false, gateway: '' };
    try {
      const r = await fetch('/api/sessions', { headers: { 'Accept': 'application/json' } });
      if (r.ok) {
        const j = await r.json();
        const list = (j && j.sessions) || j || [];
        for (const s of list) {
          const active = String(s.updatedAt || s.createdAt || '').slice(0, 10);
          if (active !== out.date) continue; // 今天没活动的会话不算
          // v3.1.0：会话用量是**累计值**（usagePrompt/usageOutput 从建会话算起），跨天会话里
          // 昨天的用量也会被算进来——实测把 22 个活跃会话的历史累计当"今日"，能算出接近整月
          // 额度的虚高数字。所以只统计「今天建的会话」（其累计量全部属于今天），
          // 更早建的跨天会话单独计数提示，不硬塞进今日（deferred：宿主没有按天用量接口）。
          if (String(s.createdAt || '').slice(0, 10) !== out.date) { out.staleSessions++; continue; }
          const p = Number(s.usagePrompt) || 0, o = Number(s.usageOutput) || 0, c = Number(s.usageCalls) || 0;
          // 会话用量里带 usageCacheHit（命中缓存的输入 token）——命中价便宜一个量级，
          // 之前整包按未命中价估，会把花费算高；这里拆开计价。
          const hit = Math.min(p, Math.max(0, Number(s.usageCacheHit) || 0));
          const miss = Math.max(0, p - hit);
          out.prompt += p; out.cacheHit += hit; out.output += o; out.calls += c; out.sessions++;
          const tier = priceTier(s.model);
          const k = valley ? 0 : 1;
          out.cost += (miss / 1e6) * tier.miss[k] + (hit / 1e6) * tier.hit[k] + (o / 1e6) * tier.out[k];
        }
        out.apiOk = true;
      }
    } catch (e) { log('error', '余额取数失败: ' + e.message); }
    out.gateway = await gatewayBase();
    out.cost = Math.round(out.cost * 10000) / 10000;
    // v2.2.3 积分制：今日估算折积分 + 余额来源（v3.1.0：内部通道额度优先，网关账单仅 sk- Key）
    out.costCredits = Math.round(out.cost * perYuanCredits());
    const both = await Promise.all([fetchCompanyQuota(force), fetchCredits(force)]);
    out.companyQuota = both[0];
    out.credits = both[1];
    // v3.1.0：额度接口的「月度累计已用」按天取增量＝当日真实消耗（比 token 估算可信得多，
    // 因为它是后端自己的计价）。插件只在运行期间采样，所以口径是「从今天首次打开插件到现在」。
    try {
      const q = out.companyQuota;
      if (q && q.ok) {
        const used = Number(q.usedPoints) || 0;
        const rec = JSON.parse(localStorage.getItem(LS_QUOTA_DAILY) || 'null');
        if (!rec || rec.date !== out.date || used < Number(rec.last || 0)) {
          // 新的一天（或跨月重置导致数字回退）：重新起算
          out.realSince = nowStr().slice(11, 16);
          out.realToday = 0;
        } else {
          out.realSince = rec.since || '';
          out.realToday = Math.max(0, used - Number(rec.first || 0));
        }
        out.realOk = true;
        localStorage.setItem(LS_QUOTA_DAILY, JSON.stringify({ date: out.date, first: out.realToday > 0 ? Number(rec.first) : used, last: used, since: out.realSince }));
      }
    } catch (e) { /* 只是估算，失败不影响余额显示 */ }
    balCache = { at: Date.now(), data: out };
    return out;
  }
  function fmtMoney(n) {
    if (n >= 100) return '¥' + n.toFixed(1);
    if (n >= 1) return '¥' + n.toFixed(2);
    return '¥' + n.toFixed(4);
  }

  /* ================= v2.2.3 积分制（1000 分 = 1 元） =================
   * 后端（公司网关）按积分计费：1000 分 = 1 元。真实数据源（OpenAI 兼容 billing）：
   *   GET {网关}/v1/dashboard/billing/subscription → system_hard_limit_usd（账户额度，≥1e8 视为不限额）
   *   GET {网关}/v1/dashboard/billing/usage → total_usage（美分，累计；日期参数被网关忽略）
   * 积分 = 美元 × 每元积分（默认 1000，可在聊天设置调整）。
   * 需在聊天设置配置网关地址+令牌；未配置时退回本地 token 估算并折成积分显示。 */
  /* ================= v3.1.0 令牌识别 + 内部通道额度 =================
   * 公司内部通道的令牌形如 jxai-<姓名>-<设备号>（例 jxai-杨镇城-jx-yzc）——它是「身份牌」：
   *   ① 浏览器 fetch 不允许把非 ASCII 字符放进请求头，带中文的令牌根本发不出去；
   *   ② 公司网关 /v1/* 也不认它（实测返回 Invalid token），它不是 OpenAI 兼容的 API Key。
   * 所以内部通道的余额**不看令牌**，而是由助手接口 GET /api/models 的 companyQuota 直接给出
   * （月度额度，单位就是「分」，与插件积分制一致）——这才是内部通道用户看余额的正确来源。
   * 真正能查网关账单的是 sk- 开头的 API Key（走 OpenAI 兼容 billing 接口，见 fetchCredits）。 */
  function parseGatewayToken(raw) {
    const t = String(raw == null ? '' : raw).trim();
    if (!t) return { kind: 'empty', valid: false, label: '未填写' };
    if (/^sk-/.test(t)) return { kind: 'apikey', valid: true, label: '网关 API Key' };
    const m = t.match(/^jxai-([^-]{1,24})-(.+)$/);
    if (m) return { kind: 'inner', valid: true, name: m[1], device: m[2], label: '公司内部通道身份牌' };
    return { kind: 'other', valid: false, label: '格式无法识别' };
  }
  /** 令牌输入框下方的即时说明（聊天设置里用） */
  function tokenHint(raw) {
    const t = parseGatewayToken(raw);
    if (t.kind === 'inner') return '已识别：公司内部通道身份牌（' + t.name + ' · 设备 ' + t.device + '）。' +
      '内部通道的真实额度由助手直接给出（剩余/月度总额），不需要填令牌；这个牌子不是网关 API Key。';
    if (t.kind === 'apikey') return '已识别：网关 API Key（sk- 开头），余额按网关账单（订阅额度 − 累计用量）显示。';
    if (t.kind === 'empty') return '留空即可：余额显示助手给出的内部通道额度（月度分）＋ 今日估算。只有 sk- 开头的 Key 才去读网关账单。';
    return '格式无法识别：网关 API Key 形如 sk-xxxx；公司内部通道身份牌形如 jxai-姓名-设备号（例 jxai-杨镇城-jx-yzc）。';
  }

  let QUOTA_CACHE = { at: 0, data: null };
  /** 助手接口的内部通道额度：{points, remainPoints, usedPoints, periodText, nextAt, asOf}，单位「分」 */
  async function fetchCompanyQuota(force) {
    if (!force && QUOTA_CACHE.data && Date.now() - QUOTA_CACHE.at < 60000) return QUOTA_CACHE.data;
    const out = { ok: false };
    try {
      const r = await fetch('/api/models', { headers: { 'Accept': 'application/json' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      const q = j && j.companyQuota;
      if (!q || typeof q.remainPoints !== 'number') throw new Error('接口未返回 companyQuota');
      out.ok = true;
      out.points = Number(q.points) || 0;
      out.remainPoints = Number(q.remainPoints) || 0;
      out.usedPoints = Number(q.usedPoints) || 0;
      out.periodText = String(q.periodText || '');
      out.nextAt = String(q.nextAt || '');
      out.asOf = String(q.asOf || '');
    } catch (e) {
      out.reason = e.message;
      log('error', '内部额度读取失败: ' + e.message);
    }
    QUOTA_CACHE = { at: Date.now(), data: out };
    return out;
  }
  /** 内部额度一句话（余额气泡/聊天回复共用；无额度时返回空串） */
  function quotaLine(q) {
    if (!q || !q.ok) return '';
    let s = '剩余积分 ' + fmtCredits(q.remainPoints) + ' 分（月度 ' + fmtCredits(q.points) + '，已用 ' + fmtCredits(q.usedPoints) + '）';
    if (q.periodText) s += '，' + q.periodText + '刷新';
    return s;
  }

  /** v3.8 余额文案格式表（标签给 UI 用） */
  const BALANCE_STYLES = [
    { id: 'short', label: '简洁' },
    { id: 'detail', label: '详细' },
    { id: 'playful', label: '傲娇' },
  ];

  /** v3.8 余额格式 id（非法值回退 short） */
  function balanceStyleId() {
    const s = String(settings.balanceStyle || 'short');
    return BALANCE_STYLES.some(x => x.id === s) ? s : 'short';
  }

  /* v3.8 余额文案三种格式（放 core 便于离线自检；pet.client.js 只负责切换 UI） */
  function balanceLine(d) {
    const c = d.credits || {};
    const q = d.companyQuota || {};
    const style = balanceStyleId();
    const per = perYuanCredits();
    const yuan = (pts) => fmtMoney(Math.round((Number(pts) / per) * 100) / 100);
    const todayReal = d.realOk ? fmtCredits(d.realToday || 0) : '';
    const todayEst = fmtCredits(d.costCredits || 0);
    // 余额主体（三种来源统一成一句话）
    const shortBase = q.ok ? '还剩 ' + fmtCredits(q.remainPoints) + ' 分 ≈' + yuan(q.remainPoints)
      : (c.ok && c.unlimited) ? '账户不限额'
        : c.ok ? '还剩 ' + fmtCredits(c.remainCredits) + ' 分'
          : Number(settings.quota) > 0 ? '额度 ' + fmtMoney(Number(settings.quota))
            : '额度未知';

    if (style === 'short') {
      return shortBase + (todayReal ? ' · 今日 +' + todayReal + ' 分' : (d.apiOk ? '' : ''));
    }
    if (style === 'playful') {
      const tails = ['省着点用哦～', '别太浪！', '够你用到月底啦～', '记得摸摸我～', '本小姐算得可准了'];
      const tail = tails[(new Date().getDate() + (d.sessions || 0)) % tails.length];
      if (q.ok) {
        return '哼哼，' + shortBase + (todayReal ? '，今天已经花掉 ' + todayReal + ' 分' : '') +
          '。月度就 ' + fmtCredits(q.points) + ' 分' + (q.periodText ? '，' + q.periodText + '刷新' : '') + '。' + tail;
      }
      return '哼，' + shortBase + (todayReal ? '，今天花掉 ' + todayReal + ' 分' : '') + '。' + tail;
    }
    // detail：完整口径（但比旧版短很多）
    const parts = [];
    if (q.ok) {
      parts.push('剩余 ' + fmtCredits(q.remainPoints) + ' / ' + fmtCredits(q.points) + ' 分（已用 ' + fmtCredits(q.usedPoints) + '）');
      if (q.periodText) parts.push(q.periodText + '刷新');
    } else if (c.ok && c.unlimited) {
      parts.push('账户不限额');
    } else if (c.ok) {
      parts.push('剩余积分 ' + fmtCredits(c.remainCredits));
    } else if (Number(settings.quota) > 0) {
      parts.push('自填额度 ' + fmtMoney(Number(settings.quota)));
    }
    if (todayReal) parts.push('今日 +' + todayReal + ' 分');
    parts.push('估算 ' + todayEst + ' 分（' + (d.sessions || 0) + ' 个新会话·' + (d.valley ? '谷' : '峰') + '价·入 ' + fmtTok(d.prompt) + '（命中 ' + fmtTok(d.cacheHit) + '）·出 ' + fmtTok(d.output) + '·' + d.calls + ' 次' + (d.staleSessions ? '；' + d.staleSessions + ' 个跨天会话未计入' : '') + '）');
    return parts.join(' ｜ ');
  }

  let CREDITS_CACHE = { at: 0, data: null };
  function perYuanCredits() { return Number(settings.perYuan) > 0 ? Number(settings.perYuan) : 1000; }
  function fmtCredits(n) { return Math.round(n).toLocaleString('en-US'); }
  async function fetchCredits(force) {
    if (!force && CREDITS_CACHE.data && Date.now() - CREDITS_CACHE.at < 120000) return CREDITS_CACHE.data;
    const base = (settings.gatewayBase || (await gatewayBase())).replace(/\/+$/, '');
    const key = settings.gatewayKey || '';
    const tk = parseGatewayToken(key);
    const out = { ok: false };
    if (tk.kind !== 'apikey') {
      // v3.1.0：非 sk- Key（留空 / 内部通道身份牌 / 其他格式）不去打网关账单接口——
      // 免得白等一次 401，也让余额气泡改说人话（内部通道看助手额度，见 fetchCompanyQuota）
      out.reason = tk.kind === 'inner' ? '内部通道身份牌，不查网关账单（余额看助手额度）'
        : tk.kind === 'empty' ? '未配置网关 API Key' : '令牌不是 sk- 开头的网关 API Key';
    } else if (!base) {
      out.reason = '未配置网关地址';
    } else {
      try {
        const hdr = { 'Authorization': 'Bearer ' + key };
        const end = localDateStr(new Date(Date.now() + 864e5));
        const r1 = await fetch(base + '/v1/dashboard/billing/subscription', { headers: hdr });
        if (!r1.ok) throw new Error('subscription HTTP ' + r1.status);
        const sub = await r1.json();
        let usedUsd = 0;
        try {
          const r2 = await fetch(base + '/v1/dashboard/billing/usage?start_date=2020-01-01&end_date=' + end, { headers: hdr });
          if (r2.ok) {
            const use = await r2.json();
            usedUsd = Number(use.total_usage || 0) / 100; // 美分 → 美元
          }
        } catch (e2) { /* usage 可选 */ }
        const limit = Number(sub.system_hard_limit_usd ?? sub.hard_limit_usd ?? 0);
        const unlimited = limit >= 1e8;
        out.ok = true;
        out.unlimited = unlimited;
        out.remainCredits = unlimited ? null : Math.max(0, Math.round((limit - usedUsd) * perYuanCredits()));
        out.usedCredits = Math.round(usedUsd * perYuanCredits());
        out.perYuan = perYuanCredits();
      } catch (e) {
        out.reason = e.message;
        log('error', '积分读取失败: ' + e.message);
      }
    }
    CREDITS_CACHE = { at: Date.now(), data: out };
    return out;
  }
