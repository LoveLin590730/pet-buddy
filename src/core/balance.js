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
    const out = { date: localDateStr(new Date()), prompt: 0, output: 0, calls: 0, cost: 0, costCredits: 0, credits: null, valley, sessions: 0, apiOk: false, gateway: '' };
    try {
      const r = await fetch('/api/sessions', { headers: { 'Accept': 'application/json' } });
      if (r.ok) {
        const j = await r.json();
        const list = (j && j.sessions) || j || [];
        for (const s of list) {
          const day = String(s.updatedAt || s.createdAt || '').slice(0, 10);
          if (day !== out.date) continue;
          const p = Number(s.usagePrompt) || 0, o = Number(s.usageOutput) || 0, c = Number(s.usageCalls) || 0;
          out.prompt += p; out.output += o; out.calls += c; out.sessions++;
          const tier = priceTier(s.model);
          // prompt 按未命中价（无命中细分，保守）；输出按输出价
          out.cost += (p / 1e6) * tier.miss[valley ? 0 : 1] + (o / 1e6) * tier.out[valley ? 0 : 1];
        }
        out.apiOk = true;
      }
    } catch (e) { log('error', '余额取数失败: ' + e.message); }
    out.gateway = await gatewayBase();
    out.cost = Math.round(out.cost * 10000) / 10000;
    // v2.2.3 积分制：今日估算折积分 + 网关真实积分（并行）
    out.costCredits = Math.round(out.cost * perYuanCredits());
    out.credits = await fetchCredits(force);
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
  let CREDITS_CACHE = { at: 0, data: null };
  function perYuanCredits() { return Number(settings.perYuan) > 0 ? Number(settings.perYuan) : 1000; }
  function fmtCredits(n) { return Math.round(n).toLocaleString('en-US'); }
  async function fetchCredits(force) {
    if (!force && CREDITS_CACHE.data && Date.now() - CREDITS_CACHE.at < 120000) return CREDITS_CACHE.data;
    const base = (settings.gatewayBase || (await gatewayBase())).replace(/\/+$/, '');
    const key = settings.gatewayKey || '';
    const out = { ok: false };
    if (!base || !key) {
      out.reason = '未配置网关令牌';
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
