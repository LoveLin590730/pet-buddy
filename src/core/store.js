/* ============================================================================
 * pet-buddy · 共享核心（core）· 设置与日志
 * ----------------------------------------------------------------------------
 * src/core/*.js 是桌宠半边（client.js）与聊天窗口半边（chat.html）的唯一真相源：
 * 两份产物中都含同一段代码，由 build.mjs 按标记注入——改这里，两端同时生效。
 * 约束：只写顶层 const / function；不 import、不 export、不依赖宿主环境；
 *       去掉行首 export 即可作为普通脚本内联（手法参考 hakihakii/bibibobo）。
 * 切勿手改产物（client.js / chat.html），它们会被 build.mjs 覆盖。
 * ==========================================================================*/

  /* ================= 设置存取（localStorage） ================= */
  let settings;
  try { settings = Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(LS_KEY) || '{}')); }
  catch (e) { settings = Object.assign({}, DEFAULTS); }
  const saveSettings = () => { try { localStorage.setItem(LS_KEY, JSON.stringify(settings)); } catch (e) { /* 忽略 */ } };


  /* ================= 后台日志（思考过程只进这里） ================= */
  let logs = [];
  try { logs = JSON.parse(localStorage.getItem(LS_LOG) || '[]'); } catch (e) { logs = []; }
  function log(type, text) {
    logs.push({ t: nowStr(), type, text: String(text).slice(0, 4000) });
    if (logs.length > 200) logs = logs.slice(-200);
    try { localStorage.setItem(LS_LOG, JSON.stringify(logs)); } catch (e) { /* 忽略 */ }
  }
  log('info', 'pet-buddy v' + PB_VERSION + ' 初始化');
