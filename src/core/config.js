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
const PB_VERSION = '4.17.0';

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
    speechProbeText: '你好，我是坚祥数字助理！哼哼，记住了吗？',   // v4.8 试听语音用的句子（可自己改）
    /* v4.7 自行移动（散步）：桌宠自己走两步——时间/模式/速度都可调 */
    walkOn: true,            // 总开关
    walkMode: 'stroll',      // stroll 走走停停（水平）| roam 逛桌面（随机位置）| off 不自己动
    walkEverySec: 180,       // 出发间隔基准（秒），实际会 ±抖动
    walkSpeed: 'normal',     // slow 慢悠悠 | normal 正常 | fast 小跑
    /* v4.8 表情包：自定义贴纸（本机，可批量导入导出）；元素是 dataUrl，用 custom:<下标> 引用 */
    customStickers: [],
    /* v5.3 设置分类后的新开关：聊天行为 */
    quickChat: true,         // 双击桌宠：就地输入框
    chatSync: true,          // 双击闲聊与气泡面板的聊天记录互通
    chatKeep: 60,            // 气泡面板最多保留几条消息（只影响显示）
    /* v3.2 声音：播报走本地合成（bibibobo 声线），听写走宿主语音组件的本地离线模型 */
    speechOn: true,          // 语音播报开关（聊天回复念出来）
    speechVolume: 0.5,       // 音量 0..1
    speechStep: 0.13,        // 语速（每个字的间隔秒数，0.13 = 默认）
    speechVoice: 'fish',     // 声线：fish（大肥鱼·高）| lumo（路墨·低）
    speechMaxChars: 60,      // 单次朗读上限字数（超出截断加省略号）
    /* v3.4 语调引导：宿主后端 TTS（/api/voice/tts）先把句子真读一遍，
       量出**每一句/每个字的真人音高**，再到声线音阶里挑最接近的那个音——结构与音色仍是经典合成。
       比"完全按字哈希定音高"更贴语调；TTS 不可用时自动回退经典合成 */
    speechFollow: true,      // true=语调引导；false=经典合成（老字段，保留兼容）
    speechMode: 'guided',    // v3.6 朗读模式：guided 语调引导 / classic 经典合成 / tts 普通朗读（真人声）
    ttsVoice: '',            // TTS 音色（空=宿主默认，例如 zh-CN-XiaoxiaoNeural）
    ttsRate: 1,              // TTS 语速 0.5..2
    /* v3.3 音效：点桌宠/弹面板/拖拽吸附/识别成功失败各一声（同一套合成器造的短音） */
    sfxOn: true,             // 交互音效开关
    sfxVolume: 0.6,          // 音效音量 0..1（与语音音量独立）
    hiddenSkins: [],         // v3.7 被移除的内置皮肤 id（可从模型面板恢复）
    deletedSkins: [],        // v3.9 被"彻底删除"的皮肤 id（永久，不再出现在恢复列表）
    /* v3.8 开场白与余额格式 */
    greeting: '',            // 自定义开场白（空=默认；支持 {greet} 时段问候、{nickname} 昵称）
    pokeLines: [],           // v3.10 被戳一戳的反应词（空=用内置默认那几条；单击时随机挑一条 +（余额））
    pokeUpdatedAt: 0,        // 台词上次自动更新时间戳
    pokeAutoDays: 0,         // 台词自动更新周期（0=关闭，1=每天，7=每周）
    balanceStyle: 'short',   // 余额气泡格式：short 简洁 / detail 详细 / playful 傲娇
    /* v3.4 常用语库（右键 → bibo语音 → 常用语…，增删改查；只存本机） */
    phrases: [],
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
