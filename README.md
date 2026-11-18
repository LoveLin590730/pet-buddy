# 余额宠物·大肥鱼（pet-buddy）

住在助手窗口右下角的大肥鱼桌宠：**桌宠常驻 + 傲娇聊天 + 余额显示**三合一。
形象与动作取自 [zhouwu97/ds-pet](https://github.com/zhouwu97/ds-pet) 的官方 v2 精灵图（MIT），
帧时长按官方 `shared/motion.js` 的权威值走。

- 单击 → 余额气泡：**剩余积分**（公司内部通道额度，助手接口直出，剩余/月度/已用/刷新日）＋ 今日消耗两个口径
  （额度接口的当日增量＝真实；token 估算＝参考，已按缓存命中价拆分计价）
- 双击 → 就地输入框聊天；右键 → 窗口化聊天 / 换模型 / 角色设定 / 思考日志 / 隐藏
- 聊天走**助手子对话**（默认，`POST /api/sessions`），备选**网关令牌**（OpenAI 兼容）与**模拟模式**；助手不可用时明确提示并回落
- **网关令牌格式识别**：`sk-…` = 网关 API Key（读网关账单）；`jxai-姓名-设备号` = 公司内部通道身份牌
  （认人用，可一键当昵称，余额不走它）；留空则用助手额度——三种情况都在设置里即时说明
- 40 张贴纸（蓝色大肥鱼档案馆 16 + 微信表情 24）与图片/GIF 自定义表情面板

---

## 一、目录结构（固定位置，别乱挪）

```
pet-buddy/
├─ manifest.json          # 插件清单：宿主只认这几项（id/name/version/description/client/icon）
├─ client.js              # ★ 产物：桌宠半边（由 build.mjs 生成，勿手改）
├─ chat.html              # ★ 产物：聊天窗口半边（同上）
├─ client.css             # 桌宠样式（手写文件）
├─ src/                   # ★ 源码：唯一真相源
│  ├─ core/               #   两端共用的核心（改这里，桌宠与窗口同时生效）
│  │  ├─ config.js        #     版本号、localStorage 键名、默认设置、默认人设、模型清单
│  │  ├─ util.js          #     $new / clamp / nowStr
│  │  ├─ store.js         #     设置收发、后台日志（思考过程只进这里）
│  │  ├─ stickers.js      #     资产目录推导、贴纸表与白名单解析、富文本渲染（防 XSS）
│  │  ├─ balance.js       #     价目/节假日谷价、今日消耗、网关真实积分
│  │  └─ chat.js          #     三通道发送、人设指纹、提示词组装
│  ├─ pet.client.js       #   桌宠半边源码（注入 core 后 = client.js）
│  └─ chat.template.html  #   聊天窗口源码（注入 core 后 = chat.html）
├─ build.mjs              # 构建：core → 两份产物（标记注入，失配即报错）
├─ assets.manifest.json   # 素材清单（42 个：精灵图 / 皮肤 / 图标 / 40 张贴纸）：install 与 pack 按它复制，smoke 按它校验
├─ tools/
│  ├─ smoke.mjs           # 离线冒烟自检（不依赖宿主）
│  ├─ install.ps1         # 同步到宿主插件目录（带备份）
│  └─ pack.ps1            # 打社区发布包 dist/pet-buddy-v<版本>.zip
├─ vendor/                # 第三方原样引入（bibibobo.js · MIT）：v3.1 语音升级预留，尚未接入
└─ 素材（必须平铺）        # feiyu-spritesheet.png / pet-deepseek.webp / st-*.webp（40 张）/ icon.png
```

**为什么素材平铺、不能放进 `assets/` 子目录**（v3.1.0 实测）：宿主对 `/_plugins/<id>/` **只服务插件根级文件**，
子目录一律 404（`assets/x.png`、`assets/sprites/x.png`、`./assets/x.png`、`assets%2Fx.png` 全 404，
而根级新建文件立即 200）。所以素材按前缀分组平铺（`feiyu-` 形象 / `st-` 贴纸 / `pet-` 皮肤 / `icon` 图标），
由 `assets.manifest.json` 统一登记；将来宿主支持子目录，只需改 `src/core/stickers.js` 里那三个素材常量并搬文件。

宿主只从 `…\坚祥数字助理GO\插件兼容层\pet-buddy\` 加载插件，**产物在那个目录，源码在这个仓库**——
别再去插件目录里直接改代码（会被下次同步覆盖）。

## 二、怎么改

1. 改 `src/core/*.js`（两端共用）或 `src/pet.client.js`（只影响桌宠）/ `src/chat.template.html`（只影响聊天窗口）。
   约束：`src/core/*.js` 只写顶层 `const` / `function`，不 import、不 export、不依赖宿主，
   这样才能被原样内联进两个产物（这套「单一真相源 + 标记注入」的手法借鉴自 [hakihakii/bibibobo](https://github.com/hakihakii/bibibobo)）。
2. 版本号只改一处：`src/core/config.js` 的 `PB_VERSION`（`node build.mjs` 会写回 manifest.json）。
3. 构建并同步：

```powershell
node build.mjs                                   # 生成 client.js 与 chat.html
node tools/smoke.mjs                             # 离线自检（56 项断言）
powershell -ExecutionPolicy Bypass -File tools\install.ps1    # 校验 + 备份 + 同步到插件目录
```

4. 在助手窗口按 **F5** 刷新，即可看到新版本（窗口页可右键 →「窗口化聊天」打开）。

## 三、验证清单（改完过一遍）

离线（不需要宿主）：

- `node tools/smoke.mjs` —— **56 项断言全绿**（配置 / 贴纸解析 / 余额积分 / 聊天组装 / 令牌识别 / 内部额度与计价 / 素材清单）
- `node --check client.js` —— 产物语法
- `node build.mjs --check` —— 产物与源码一致（安装脚本与 CI 用；不一致时退出码 1）

宿主里（F5 之后）：

1. 桌宠出现且位置与上次一致；拖动后甩到边缘能吸附；右键隐藏 → 再右键恢复
2. 单击出余额气泡：首句应是「剩余积分 X 分（月度 Y，已用 Z），每月 1 号刷新」（内部通道额度，无需令牌）；
   后面跟「今日 +N 分（额度接口）」与「估算 M 分」（积分制，1000 分 = 1 元）
3. 双击就地聊天；右键 →「窗口化聊天」开窗口，贴纸面板能插入表情并发送
4. 右键 →「模型选择」「角色设定」「思考日志」三个弹窗都能开合
5. **聊天设置 → 网关令牌**：粘 `jxai-杨镇城-jx-yzc` 应识别为「公司内部通道身份牌」并出现「用「杨镇城」当昵称」按钮；
   粘 `sk-xxx` 应识别为网关 API Key；留空则提示余额走助手额度
6. 贴纸渲染：模型回 `[stick:archive:比心]`、`[bean:smile]`、`[fish:wave]` 都能出图；乱编的名字直接忽略（不出现破碎标记）
7. 断开助手（关掉服务）应提示「助手不在线」并回落模拟模式

## 四、素材来源与许可

素材清单见 `assets.manifest.json`（install / pack / smoke 三处共用它，改动素材请同步清单）：

| 素材 | 来源 | 许可 |
|---|---|---|
| `feiyu-spritesheet.png`（8×11=88 格，192×208/格） | zhouwu97/ds-pet 官方 v2 精灵图 | MIT（见 `LICENSE-dspet.txt`） |
| `pet-deepseek.webp`（内置女仆皮肤） | 上游 ds-pet 素材 | MIT（见 `LICENSE-dspet.txt`） |
| `st-deepseek-*.webp`、`st-chatgpt-renwu-jieshao.webp` 等 16 张 | 蓝色大肥鱼档案馆（fisharchive.cc） | CC BY-NC-SA 4.0 |
| `st-wx-01..24.webp` | 微信表情包 640.wxpic（wxgf/HEVC）解码后 6×4 网格裁切 | 二创，非商用 |
| `icon.png` | 自有 | MIT（见 `LICENSE`） |
| `vendor/bibibobo.js` | hakihakii/bibibobo（原样引入、保留来源注释） | MIT（该文件头注明；v3.1 语音升级预留，当前未接入） |
| 本仓库代码 | 坚祥（yzc） | MIT（见 `LICENSE`） |

## 五、打包发布

```powershell
powershell -ExecutionPolicy Bypass -File tools\pack.ps1              # dist\pet-buddy-v3.0.0.zip
powershell -ExecutionPolicy Bypass -File tools\pack.ps1 -WithSource  # 连源码一起打（二次开发用）
```

包根 = 插件目录：对方解压到 `…\插件兼容层\`（目录名 `pet-buddy`）后刷新助手即可用，
不需要装 Node、不联网、无第三方依赖。
