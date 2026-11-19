/* ============================================================================
 * pet-buddy · 共享核心（core）· 聊天引擎（三通道）
 * ----------------------------------------------------------------------------
 * src/core/*.js 是桌宠半边（client.js）与聊天窗口半边（chat.html）的唯一真相源：
 * 两份产物中都含同一段代码，由 build.mjs 按标记注入——改这里，两端同时生效。
 * 约束：只写顶层 const / function；不 import、不 export、不依赖宿主环境；
 *       去掉行首 export 即可作为普通脚本内联（手法参考 hakihakii/bibibobo）。
 * 切勿手改产物（client.js / chat.html），它们会被 build.mjs 覆盖。
 * ==========================================================================*/

  /* ================= 聊天引擎（三通道） ================= */
  // 14 轮短期记忆（网关/模拟通道使用；assistant 通道由子对话天然持有）
  const shortMemory = [];

  function periodGreet() {
    const h = new Date().getHours();
    if (h >= 5 && h < 11) return '早上好';
    if (h < 14) return '中午好';
    if (h < 18) return '下午好';
    if (h < 23) return '晚上好';
    return '夜深了';
  }

  /** 组装发给模型的文本。
   * v2.1.3 起：人设不再每轮全量——full=true（子对话首条或人设/昵称变化后的第一条）才带
   * 「桌宠设定+用户资料」；之后正常聊天只发用户消息本身 + 可选余额数据，人设靠子对话历史。 */
  function buildPrompt(userText, balanceBlock, full) {
    const parts = [];
    if (full !== false) {
      const persona = (settings.persona || '').trim() || DEFAULT_PERSONA;
      parts.push('【桌宠设定·系统级，始终遵守】\n' + persona);
      const profile = ['当前时段：' + periodGreet()];
      if (settings.nickname) profile.push('用户昵称：' + settings.nickname);
      if (profile.length) parts.push('【用户资料】' + profile.join('；'));
      // 与窗口化聊天一致的贴纸标记说明（v2.2.2：archive 组全量教学+优先使用指示）
      const ARCH_PROMPT =
        '抱臂拒绝=拒绝、抱着小鲸=睡觉、抱西瓜=吃瓜、抱头=委屈、抱尾巴=卖萌、token罐=token、' +
        '打游戏=游戏、流口水=流口水、抱胖鱼=抱鱼、坐罐堆=无语、被抱吓到=吓到、窗边=发呆、' +
        '抱碗=开吃、比心=比心、扫帚=敷衍、插手=生气；另有 wx1～wx24 大肥鱼日常系列。';
      parts.push('【表情包标记】回复中可以插贴纸（会渲染成图片），写法与可用贴纸：' +
        '① [stick:archive:中文名] —— archive 组（蓝色大肥鱼表情包，你的主力表情，优先使用这组）：' + ARCH_PROMPT + '\n' +
        '② 备选小表情：' +
        Object.keys(FISH_STICKERS).map(k => '[fish:' + k + ']').join(' ') + '、' +
        Object.keys(BEAN).map(k => '[bean:' + k + ']').join(' ') + '、[maid:1]。' +
        '格式必须严格用半角方括号加英文冒号（如 [stick:archive:比心] 或 [bean:smile]），不要写成中文括号或加多余空格；' +
        '适度使用，一条回复最多 1-2 个。');
      // v4.4：交付文件的写法约定（只在首轮人设里说一次，之后靠上下文——不再每轮重发）
      parts.push('【交付文件】如果你产出了文件（图片、折线图、表格、文档、网页等），' +
        '请在回复最后单独一行写「📎 加完整绝对路径」（一行一个，最多 3 个）；没有产出文件就不要写。' +
        '桌宠会把这一行变成可「打开文件 / 打开文件夹位置」的成果卡片。');
    }
    if (balanceBlock) parts.push(balanceBlock);
    parts.push('【用户说】' + userText);
    return parts.join('\n\n');
  }

  /* ---- v2.1.3 人设指纹：按子对话分别跟踪「该人设已全量发送」状态（LS_PSTATE 见 core/config.js） ----
   * 指纹 = hash(生效人设 + 昵称)；时段是易变信息不进指纹。
   * 编辑人设/昵称变化 → 指纹变 → 下一条自动全量重发；换模型=新子对话=天然首条。 */
  // v2.2.2：人设指纹加入 PROMPT_VER——首轮人设段落（贴纸教学等）改版后，
  // 老子对话也会自动全量重发一次新说明，无需用户手动操作
  const PROMPT_VER = '20261119-deliv';
  function hashStr(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) { h = (((h << 5) + h) + s.charCodeAt(i)) >>> 0; }
    return h.toString(36);
  }
  function personaFingerprint() {
    const persona = (settings.persona || '').trim() || DEFAULT_PERSONA;
    return hashStr(persona + '\u0001' + (settings.nickname || '') + '\u0001' + PROMPT_VER);
  }
  function loadPState() { try { return JSON.parse(localStorage.getItem(LS_PSTATE) || '{}') || {}; } catch (e) { return {}; } }
  function savePState(st) { try { localStorage.setItem(LS_PSTATE, JSON.stringify(st)); } catch (e) { /* 容量满等 */ } }
  function markPersonaSent(key, fp) {
    const st = loadPState();
    st[key] = { fp: fp, at: new Date().toISOString().slice(0, 19) };
    savePState(st);
    log('info', '人设已全量发送至 [' + key + ']（fp=' + fp + '）');
  }
  function needPersonaFull(key) {
    const fp = personaFingerprint();
    const st = loadPState();
    return (!st[key] || st[key].fp !== fp) ? fp : null; // 返回非空=需要全量（附带新指纹）
  }

  /* v3.9.1：判断一个称呼明显是"从聊天里截错的句子"（不是人名） */
  const NICK_VIRTUAL = /[们嘛吧呢吗啊呀哦的了着过谁说想把让给和跟在有没不就都也还又很太建群聊你我他]/;
  const NICK_BAD_HEAD = /^[们的个建是说想把让给和跟在有没不就都也还又很太]/;
  function nicknameLooksWrong(nick) {
    const s = String(nick == null ? '' : nick).trim();
    if (!s) return false;
    if (s.length > 6) return true;                     // 人名很少超过 6 个字
    if (NICK_BAD_HEAD.test(s)) return true;            // 「们建个营销群嘛」这种就是以虚词开头
    const hits = (s.match(new RegExp(NICK_VIRTUAL.source, 'g')) || []).length;
    if (hits >= 2) return true;                        // 一个名字里有两个以上虚词 → 肯定是句子
    return false;
  }

  function extractNickname(text) {
    // v3.9：① 用户在设置里手动设过称呼 → 锁定，不再被聊天内容改掉
    //         ② 只认「我叫/我是/叫我/喊我」+ 2~6 字，且名字里不能有虚词/代词/动词
    //         （之前的 1~12 字太宽，"我是我们建个营销群嘛"这种会被截成一句垃圾当名字）
    if (settings.nicknameLock) return null;
    const m = String(text == null ? '' : text).match(/(?:我叫|我是|叫我|喊我)\s*([\u4e00-\u9fa5A-Za-z0-9_·]{2,6})/);
    if (!m || !m[1]) return null;
    const name = m[1];
    if (nicknameLooksWrong(name)) return null;
    const old = settings.nickname;
    settings.nickname = name; saveSettings();
    return old === name ? null : name;
  }
  const BAL_RE = /花(了|费|掉|钱)|用了多(少|少钱)|余额|还剩|额度|多少钱|花费|账单|今日花费/;

  /** 从会话记录里还原「用户原话」——气泡聊天面板拉历史时用（v4.5）。
   *  三种情况都要吃下：① 新版拼了【用户说】前缀 → 取其后的原话；
   *  ② 老对话（v3.x）没前缀、就是一句原话 → 原样用；
   *  ③ 人设块 / 余额块 / JSON 注入（env 快照等）→ 返回空串（面板里不该出现这些）。 */
  function sessionUserText(raw) {
    const t = String(raw == null ? '' : raw).trim();
    if (!t) return '';
    const m = /【用户说】([\s\S]*)$/.exec(t);
    if (m) return m[1].trim();
    if (/【(?:桌宠设定|用户资料|表情包标记|交付文件|余额|数字助理派发)/.test(t)) return '';
    if (/^\{[\s\S]*\}$/.test(t)) return '';                 // JSON 注入（环境快照/模型参数等）
    return t;
  }

  async function apiOK() {
    try { const r = await fetch('/api/models', { headers: { 'Accept': 'application/json' } }); return r.ok; }
    catch (e) { return false; }
  }

  /* ---- 通道 A：助手子对话（统一） ---- */
  async function ensureAssistantSession() {
    const sid = localStorage.getItem(CHAT_LS_SID);
    if (sid) {
      try {
        const r = await fetch('/api/sessions/' + sid, { headers: { 'Accept': 'application/json' } });
        if (r.ok) return sid;
      } catch (e) { /* 落到重建 */ }
    }
    const body = {
      title: '桌宠聊天',
      provider: settings.chatProvider || 'company-internal',
      model: settings.chatModel || 'deepseek-flash',
      permission: 'workspace-write',
      tools: [],
    };
    const r = await fetch('/api/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error('创建桌宠子对话失败：HTTP ' + r.status);
    const j = await r.json();
    localStorage.setItem(CHAT_LS_SID, j.id);
    log('info', '已创建统一子对话 ' + j.id + '（' + body.provider + '/' + body.model + '）');
    return j.id;
  }

  /** 读 chat SSE 流：把事件记进后台日志；连接建立（消息已落库）即回调 onSent；返回流是否正常结束 */
  async function readChatStream(sid, content, onSent) {
    const resp = await fetch('/api/sessions/' + sid + '/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    if (resp.status === 409) throw new Error('BUSY');
    if (!resp.ok) throw new Error('聊天请求失败：HTTP ' + resp.status);
    if (typeof onSent === 'function') { try { onSent(); } catch (ce) { /* 回调容错 */ } }
    if (!resp.body) return true;
    const reader = resp.body.getReader();
    const dec = new TextDecoder('utf-8');
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2);
        const line = chunk.split('\n').find(l => l.startsWith('data:'));
        if (!line) continue;
        let ev = null;
        try { ev = JSON.parse(line.slice(5).trim()); } catch (e) { log('sse', '[raw] ' + chunk.slice(0, 400)); continue; }
        const msg = ev.message || {};
        if (msg.role === 'assistant' && msg.content) log('reasoning', '[assistant 增量] ' + msg.content);
        else if (ev.type === 'reasoning' || msg.reasoning_content) log('reasoning', '[思考] ' + (msg.reasoning_content || ev.content || ''));
        else if (ev.type && ev.type !== 'message') log('sse', '[' + ev.type + '] ' + JSON.stringify(ev).slice(0, 600));
        // 流内即时通道错误检测：模型调用失败（429/停用/连不上）事件一出现就中止等待
        if (msg.role === 'system' && typeof msg.content === 'string' && msg.content.startsWith('{')) {
          try {
            const o = JSON.parse(msg.content);
            if (o.error && (o.type === 'call' || o.type === 'error')) {
              try { reader.cancel(); } catch (ce) { /* 忽略 */ }
              const e2 = new Error('MODEL_CHANNEL: ' + o.error);
              e2.channelError = String(o.error);
              throw e2;
            }
          } catch (pe) { if (pe.channelError) throw pe; }
        }
      }
    }
    return true;
  }

  /** 取最后一条 assistant 回复；无回复时检测模型通道错误（429/停用/连接失败等 system 记录） */
  async function lastAssistantText(sid) {
    const r = await fetch('/api/sessions/' + sid + '/messages', { headers: { 'Accept': 'application/json' } });
    if (!r.ok) throw new Error('取回复失败：HTTP ' + r.status);
    const j = await r.json();
    const msgs = (j && j.messages) || [];
    let reply = '';
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m.role === 'assistant' && (m.text || '').trim()) { reply = m.text.trim(); break; }
    }
    if (reply) return reply;
    // 无回复：倒序找最近的模型调用失败记录（type:call/error 带 error 字段即为通道错误）
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m.role !== 'system' || !(m.text || '').startsWith('{')) continue;
      try {
        const o = JSON.parse(m.text);
        if (o.error && (o.type === 'call' || o.type === 'error')) {
          const e = new Error('MODEL_CHANNEL: ' + o.error);
          e.channelError = String(o.error);
          throw e;
        }
      } catch (pe) { if (pe.channelError) throw pe; }
    }
    return '';
  }

  const pollReply = async (sid, tries) => {
    for (let i = 0; i < (tries || 40); i++) {
      await new Promise(res => setTimeout(res, 3000));
      const t = await lastAssistantText(sid); // 通道错误（429/停用）会直接抛出，不再傻等
      if (t) return t;
    }
    return '';
  };

  async function sendViaAssistant(userText, balanceBlock) {
    const sid = await ensureAssistantSession();
    // v2.1.3：按子对话跟踪人设——首条（或人设/昵称变化后首条）全量，其余只发短消息
    const fpNeed = needPersonaFull(sid);
    const prompt = buildPrompt(userText, balanceBlock, !!fpNeed);
    try { await readChatStream(sid, prompt, fpNeed ? () => markPersonaSent(sid, fpNeed) : null); }
    catch (e) { if (e.message === 'BUSY') return { text: '咳、正忙着呢！一条一条来啦，笨蛋主人～', via: 'assistant' }; throw e; }
    let reply = '';
    try { reply = await lastAssistantText(sid); } catch (e) { throw e; }
    if (!reply) reply = await pollReply(sid, 30);
    if (!reply) reply = '……（刚才好像走神了，再说一遍？）';
    return { text: reply, via: 'assistant' };
  }

  /* ---- 通道 B：网关令牌（OpenAI 兼容 /chat/completions） ---- */
  async function sendViaGateway(userText, balanceBlock) {
    // v3.1.0：先认令牌——jxai-姓名-设备号 是内部通道身份牌，浏览器也不允许把中文塞进请求头，
    // 拿它打网关只会得到一个看不懂的报错，这里直接说清并指路助手通道。
    const tk = parseGatewayToken(settings.gatewayKey);
    if (tk.kind === 'inner') throw new Error('填的是公司内部通道身份牌，不是网关 API Key（网关只认 sk- 开头的 Key）；聊天请切回「助手子对话」通道');
    if (!settings.gatewayBase || !settings.gatewayKey) throw new Error('网关未配置（baseURL / 令牌）');
    // v2.1.3：网关通道同样按指纹跟踪（固定键 'gw'），首条全量、后续短消息（人设在 mem 历史里）
    const fpNeed = needPersonaFull('gw');
    const prompt = buildPrompt(userText, balanceBlock, !!fpNeed);
    shortMemory.push({ role: 'user', content: prompt });
    while (shortMemory.length > 28) shortMemory.shift(); // 14 轮 = 28 条
    const msgs = [{ role: 'system', content: '你是桌宠「大肥鱼·鲸鲸娘」。永远保持角色，短句回复（≤60字），绝不输出思考过程。' }].concat(shortMemory.slice());
    const r = await fetch(settings.gatewayBase.replace(/\/+$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + settings.gatewayKey },
      body: JSON.stringify({ model: settings.gatewayModel || 'deepseek-chat', messages: msgs, max_tokens: 200, stream: false }),
    });
    if (!r.ok) throw new Error('网关返回 HTTP ' + r.status);
    if (fpNeed) markPersonaSent('gw', fpNeed);
    const j = await r.json();
    const text = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content || '').trim();
    if (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.reasoning_content)
      log('reasoning', '[思考·网关] ' + j.choices[0].message.reasoning_content);
    shortMemory.push({ role: 'assistant', content: text });
    while (shortMemory.length > 28) shortMemory.shift();
    return { text: text || '……（网关没说话）', via: 'gateway' };
  }

  /* ---- 通道 C：模拟模式 ---- */
  function sendViaMock(userText, balanceBlock, balData) {
    let reply;
    const nick = extractNickname(userText);
    const t = userText;
    if (balData && BAL_RE.test(t)) {
      const cr = balData.credits || {};
      const q = balData.companyQuota || {};
      const est = fmtCredits(balData.costCredits || 0);
      let quotaPart;
      if (q.ok) quotaPart = quotaLine(q);
      else if (cr.ok && cr.unlimited) quotaPart = '账户不限额';
      else if (cr.ok) quotaPart = '剩余积分 ' + fmtCredits(cr.remainCredits);
      else quotaPart = Number(settings.quota) > 0 ? '剩余额度 ' + fmtMoney(Number(settings.quota)) : '（额度还没告诉我呢）';
      reply = '哼、自己干的活自己看啦：' + quotaPart + '，今日估算 ' + est + ' 分。别太浪！';
    } else if (/你好|您好|hi|hello|在吗|嗨/i.test(t)) {
      reply = '哼，才不是在等你呢……' + periodGreet() + '呀，有事快说！';
    } else if (nick) {
      reply = '记住了，' + nick + '……才、才不是想记住呢！';
    } else if (/你是谁|你是什么/.test(t)) {
      reply = '本小姐是大肥鱼·鲸鲸娘！你桌上最忠实的鱼！（模拟模式陪聊中）';
    } else {
      const pool = [
        '唔……这个嘛，本小姐考虑一下再告诉你！',
        '真是的，什么问题都丢给我……不过我会认真想的。',
        '好啦好啦，陪你聊两句，快去忙正事！',
        '（尾巴拍了拍水面）嗯哼？继续说，我听着呢。',
      ];
      reply = pool[Math.floor(Math.random() * pool.length)];
    }
    shortMemory.push({ role: 'user', content: userText }, { role: 'assistant', content: reply });
    while (shortMemory.length > 28) shortMemory.shift();
    return Promise.resolve({ text: reply, via: 'mock' });
  }

  /** 统一入口：send(text) → {text, via}；助手不可用自动回落模拟并提示 */
  async function chatSend(userText, opts) {
    const opts2 = opts || {};
    // v2.1.3：昵称提取统一前置（原来只有模拟通道做）——昵称进人设指纹，
    // 必须在 needPersonaFull 判定之前生效，昵称变化才能触发下一类全量重发
    extractNickname(userText);
    let balData = null, balanceBlock = null;
    if (BAL_RE.test(userText) || opts2.withBalance) {
      balData = await todaySpend(true);
      const cr = balData.credits || {};
      const q = balData.companyQuota || {};
      const est = fmtCredits(balData.costCredits || 0);
      let quotaPart;
      if (q.ok) quotaPart = quotaLine(q) + '（助手给出的内部通道额度）';
      else if (cr.ok && cr.unlimited) quotaPart = '网关账户不限额';
      else if (cr.ok) quotaPart = '剩余积分 ' + fmtCredits(cr.remainCredits) + '（网关实时，累计已用 ' + fmtCredits(cr.usedCredits) + ' 分）';
      else quotaPart = Number(settings.quota) > 0 ? '自填剩余额度 ' + fmtMoney(Number(settings.quota)) : '额度未知（助手额度接口不可用，可在聊天设置里自填）';
      balanceBlock = '【余额数据·系统注入，积分制：1000 分 = 1 元】' +
        (balData.realOk ? '今日已用 ' + fmtCredits(balData.realToday || 0) + ' 分（来自额度接口的真实计价' + (balData.realSince ? '，自 ' + balData.realSince + ' 起统计' : '') + '）；' : '') +
        '今日(' + balData.date + ')新建 ' + balData.sessions +
        ' 个会话，估算消耗 ' + est + ' 分（输入 ' + balData.prompt + ' tok（其中缓存命中 ' + (balData.cacheHit || 0) + '）、输出 ' + balData.output +
        ' tok、' + balData.calls + ' 次调用，按' + (balData.valley ? '谷' : '峰') + '时价估算' +
        (balData.staleSessions ? '；另有 ' + balData.staleSessions + ' 个跨天会话的累计用量无法拆到今日，未计入' : '') +
        '）；' + quotaPart + '。回复用户时请直接用「分」作单位，不要解释算法。';
    }
    const channel = settings.channel || 'assistant';
    if (channel === 'gateway') {
      try { return await sendViaGateway(userText, balanceBlock); }
      catch (e) {
        log('error', '网关通道失败: ' + e.message);
        const r = await sendViaMock(userText, balanceBlock, balData);
        // v3.1.0：不再静默回落——网关失败原因摆在回复开头（与助手通道口径一致）
        return { text: '（网关通道走不通：' + e.message + '，先用模拟模式陪你～）' + r.text, via: 'mock-fallback' };
      }
    }
    if (channel === 'mock') return sendViaMock(userText, balanceBlock, balData);
    // assistant：先探活
    if (!(await apiOK())) {
      log('error', '助手 API 不可达，回落模拟模式');
      const r = await sendViaMock(userText, balanceBlock, balData);
      return { text: '（助手不在线，本小姐亲自上！）' + r.text, via: 'mock-fallback' };
    }
    try {
      return await sendViaAssistant(userText, balanceBlock);
    } catch (e) {
      log('error', '助手通道失败: ' + e.message);
      const r = await sendViaMock(userText, balanceBlock, balData);
      // 模型通道级错误（429 余额不足 / 渠道停用 / 连接失败）给明确原因，不装傻
      if (e.channelError || /MODEL_CHANNEL/.test(e.message)) {
        const raw = String(e.channelError || '');
        let why = raw.split(/[：:]/)[0].slice(0, 26) || '模型通道不可用';
        if (/429|余额不足/.test(raw)) why = '模型通道余额不足';
        return { text: '（' + why + '，先用模拟模式陪你～去聊天设置里换个模型或通道吧）' + r.text, via: 'mock-fallback' };
      }
      return { text: '（助手闹脾气了，我来说～）' + r.text, via: 'mock-fallback' };
    }
  }
