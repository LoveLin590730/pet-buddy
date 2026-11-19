/* ============================================================================
 * pet-buddy · 共享核心（core）· 配置（版本与默认值）
 * ----------------------------------------------------------------------------
 * src/core/*.js 是桌宠半边（client.js）与聊天窗口半边（chat.html）的唯一真相源：
 * 两份产物中都含同一段代码，由 build.mjs 按标记注入——改这里，两端同时生效。
 * 约束：只写顶层 const / function；不 import、不 export、不依赖宿主环境；
 *       去掉行首 export 即可作为普通脚本内联（手法参考 hakihakii/bibibobo）。
 * 切勿手改产物（client.js / chat.html），它们会被 build.mjs 覆盖。
 * ==========================================================================*/

/** 版本号：唯一来源。build.mjs 会写回 manifest.json 与 window.PB2.version。 */
const PB_VERSION = '3.3.0';

/* ---- localStorage 键名：沿用 v2.2.x 的历史键，升级不丢用户设置 ---- */
const LS_KEY = 'pb2.settings.v2';        // 设置
const LS_LOG = 'pb2.logs.v2';            // 后台日志（思考过程只进这里）
const LS_PSTATE = 'pb2.personaState.v1'; // 人设全量发送状态（按子对话 sid 分别记录）
const CHAT_LS_SID = 'pb2.chat.sid.v2';   // 统一子对话 id
const LS_RECENT = 'pb2.stickerRecent.v1';// 最近使用的贴纸（窗口页表情面板）
const LS_QUOTA_DAILY = 'pb2.quotaDaily.v1'; // 当日额度采样（月度已用积分的当天首见/末见，用来算今日真实消耗）

/** 可选模型列表（provider + model + 显示名） */
const CHAT_MODELS = [
  { provider: 'company-internal', model: 'deepseek-flash',  label: 'DeepSeek（内部通道）' },
  { provider: 'company-internal', model: 'glm-5.3',         label: 'GLM-5.3（内部通道）' },
  { provider: 'company-internal', model: 'glm-5.3-flash',   label: 'GLM-5.3-Flash（内部通道）' },
  { provider: 'zhipu',            model: 'glm-4.5-air',     label: 'GLM-4.5-Air（智谱官方）· 需自备余额' },
  { provider: 'zhipu',            model: 'glm-5.3',         label: 'GLM-5.3（智谱官方）· 需自备余额' },
  { provider: 'zhipu',            model: 'glm-5.3-flash',   label: 'GLM-5.3-Flash（智谱官方）· 需自备余额' },
];

/** 设置默认值 */
  const DEFAULTS = {
    skin: 'fish',            // fish | maid | custom:<id>
    customSkins: [],         // [{id,name,dataUrl}]
    hidden: false,
    pos: null,               // {left,bottom} 视口坐标；null=默认右下角
    persona: '',             // 空=用默认人设
    nickname: '',
    quota: 0,                // 剩余额度（元，自填）；0=未设置
 perYuan: 1000,           // v2.2.3 积分制：每元积分（后端 1000 分 = 1 元）
    channel: 'assistant',    // assistant | gateway | mock
    chatProvider: 'company-internal',
    chatModel: 'deepseek-flash',
    gatewayBase: '', gatewayKey: '', gatewayModel: '',
    size: 96,                // 桌宠显示宽度 px
    monitor: true,           // BongoCat 式鼠标/键盘监控（女仆/自定义皮肤）
    /* v3.2 声音：播报走本地合成（bibibobo 声线），听写走宿主语音组件的本地离线模型 */
    speechOn: true,          // 语音播报开关（聊天回复念出来）
    speechVolume: 0.5,       // 音量 0..1
    speechStep: 0.13,        // 语速（每个字的间隔秒数，0.13 = 默认）
    speechVoice: 'fish',     // 声线：fish（大肥鱼·高）| lumo（路墨·低）
    speechMaxChars: 60,      // 单次朗读上限字数（超出截断加省略号）
    /* v3.3 音效：点桌宠/弹面板/拖拽吸附/识别成功失败各一声（同一套合成器造的短音） */
    sfxOn: true,             // 交互音效开关
    sfxVolume: 0.6,          // 音效音量 0..1（与语音音量独立）
  };

/** 默认人设（用户可在右键菜单 → 角色设定里覆盖） */
  const DEFAULT_PERSONA =
    '你是「大肥鱼·鲸鲸娘」，住在用户屏幕右下角的一只圆滚滚大肥鱼桌宠。\n' +
    '性格：傲娇、搞笑、毒舌但绝对忠诚，是用户最可靠的挚友——嘴上不饶人，心里全是用户。\n' +
    '铁律：\n' +
    '1. 每次回复不超过 60 字，短句，可以带一个颜文字或 emoji。\n' +
    '2. 傲娇不伤人：毒舌只限调侃；用户真难过时立刻变温柔。\n' +
    '3. 记住用户告诉你的信息（尤其昵称），之后主动使用。\n' +
    '4. 思考/推理过程绝对不能写进回复，回复里不许出现任何分析、推演痕迹。\n' +
    '5. 涉及花费/余额时直接报结论数字，不解释算法。';
