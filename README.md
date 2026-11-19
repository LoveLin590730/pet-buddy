# 余额宠物·大肥鱼（pet-buddy）

住在助手窗口右下角的大肥鱼桌宠：**桌宠常驻 + 傲娇聊天 + 余额显示**三合一。
形象与动作取自 [zhouwu97/ds-pet](https://github.com/zhouwu97/ds-pet) 的官方 v2 精灵图（MIT），
帧时长按官方 `shared/motion.js` 的权威值走。

- 单击 → 余额气泡：**剩余积分**（公司内部通道额度，助手接口直出，剩余/月度/已用/刷新日）＋ 今日消耗两个口径
  （额度接口的当日增量＝真实；token 估算＝参考，已按缓存命中价拆分计价）
- 双击 → 就地输入框聊天；右键 → 窗口化聊天 / **bibo语音（折叠：试听语音·语音闲聊·音效开关·声音设置）** /
  换模型 / 角色设定 / 思考日志 / 隐藏
- 聊天走**助手子对话**（默认，`POST /api/sessions`），备选**网关令牌**（OpenAI 兼容）与**模拟模式**；助手不可用时明确提示并回落
- **网关令牌格式识别**：`sk-…` = 网关 API Key（读网关账单）；`jxai-姓名-设备号` = 公司内部通道身份牌
  （认人用，可一键当昵称，余额不走它）；留空则用助手额度——三种情况都在设置里即时说明
- 40 张贴纸（蓝色大肥鱼档案馆 16 + 微信表情 24）与图片/GIF 自定义表情面板
- **语音播报（v3.2）**：回复念成「哔哔啵啵」的小人声（本地离线合成，声线/音量/语速/字数上限可调；
  默认开启，聊天设置里可关）。合成核心是 vendor/bibibobo.js（MIT）——不联网、不录音、不用 AI 配音
- **语音闲聊（v3.2）**：按住 **右 Alt + M** 说话，松开就发（也可以点右键菜单「语音闲聊」，
  说完静音 2 秒自动收尾）；识别走宿主「语音」组件的本地离线模型，识别结果先回显「你说：…」再发送。
  **左 Alt 保持助手自带的语音听写**（设置 → 语音），插件不占用、不抢键
- **交互音效（v3.3）**：点桌宠「啵」、弹面板「叮」、拖拽吸附「唰」、听写成功「嗯」、出错「哔」——
  和语音同一套合成器造的短音，独立开关与音量（默认开、0.6）
- **可插拔精灵图皮肤（v3.3）**：内置「大肥鱼·社区桌宠包」（社区二创图集，8×11 / 192×208 同规格，
  直接换图即用）；新增社区图集只要把图平铺放插件根目录 + 在 `SPRITE_SKINS` 里加一条 + 登记素材清单与许可
- **BongoCat 猫猫（v3.3.3）**：原版键盘猫画面（MIT 素材），敲键盘 / 动鼠标时**爪子亮一下**
  （切按下帧，110ms 后切回）；素材自带爪子，所以不叠插件的浮空爪图层

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
│  │  ├─ speech.js        #     语音播报：文本清洗 + 单实例播放（合成核心来自 vendor/bibibobo.js）
│  │  ├─ sfx.js           #     交互音效：同一套合成器造的短音（啵/叮/唰/嗯/哔）+ 独立音量
│  │  ├─ voiceinput.js    #     语音听写：16k 采集 + VAD + 宿主本地识别（右 Alt+M 热键）
│  │  └─ chat.js          #     三通道发送、人设指纹、提示词组装
│  ├─ pet.client.js       #   桌宠半边源码（注入 core 后 = client.js）
│  └─ chat.template.html  #   聊天窗口源码（注入 core 后 = chat.html）
├─ build.mjs              # 构建：vendor + core → 两份产物（标记注入，失配即报错）
├─ assets.manifest.json   # 素材清单（42 个：精灵图 / 皮肤 / 图标 / 40 张贴纸）：install 与 pack 按它复制，smoke 按它校验
├─ 一键构建并同步.cmd      # 开发机一条命令：build → smoke → install → pack → pack-oneclick
├─ tools/
│  ├─ smoke.mjs           # 离线冒烟自检（不依赖宿主）
│  ├─ install.ps1         # 同步到宿主插件目录（带备份）
│  ├─ pack.ps1            # 打标准发布包 dist/pet-buddy-v<版本>.zip
│  ├─ pack-oneclick.ps1   # 打一键安装形态（zip + 单文件 .cmd 安装器）
│  └─ oneclick/           # 一键安装器素材：install-plugin.ps1 / 安装.cmd / 卸载.cmd / 安装说明.txt / 单文件头部
├─ vendor/                # 第三方原样引入（bibibobo.js · MIT）：构建期内联，只去掉行首 export
└─ 素材（必须平铺）        # feiyu-spritesheet.png / pet-deepseek.webp / pet-whale-codex.webp / st-*.webp（40 张）/ icon.png
```

**为什么素材平铺、不能放进 `assets/` 子目录**（v3.1.0 实测）：宿主对 `/_plugins/<id>/` **只服务插件根级文件**，
子目录一律 404（`assets/x.png`、`assets/sprites/x.png`、`./assets/x.png`、`assets%2Fx.png` 全 404，
而根级新建文件立即 200）。所以素材按前缀分组平铺（`feiyu-` 形象 / `st-` 贴纸 / `pet-` 皮肤 / `icon` 图标），
由 `assets.manifest.json` 统一登记；将来宿主支持子目录，只需改 `src/core/stickers.js` 里那三个素材常量并搬文件。

**资源路径的两条铁律**（v3.3.1 血的教训，桌面版实测）：

1. **图片一律走 CSS 相对路径**（相对 `client.css` / `chat.html` 自身）——桌面版是用 **file 协议**加载插件的，
   JS 里拼的根相对路径 `/_plugins/pet-buddy/x.png` 在 file 下会变成 `file:///_plugins/…`（不存在）→ 图挂掉。
   换皮肤就是换 CSS 类（`.pb2-skin-codex .pb2-sprite{...}`），别用 `el.style.backgroundImage` 拼路径。
2. **JS 需要路径时，先用 `resolveAssetUrls()` 拿"CSS 解析出来的绝对基准"**——CSS 里 `--pb2-asset-base: url("icon.png")`
   是探针，取 computed style 时浏览器会把它解析成绝对 URL（http / file 都对），再用它拼贴纸、缩略图、窗口路径。

再加上"皮肤图预检失败自动回退 + 气泡说明"，就不会再出现"桌宠整个消失且毫无提示"。

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

- `node tools/smoke.mjs` —— **91 项断言全绿**（配置 / 贴纸解析 / 余额积分 / 聊天组装 / 令牌识别 / 内部额度与计价 / 素材清单 / 语音合成与清洗 / 听写请求与降级 / 音效与社区皮肤）
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
8. **语音（v3.2）**：
   - 点一下桌宠（用户手势，解锁音频）→ 双击聊天发一句话 → 回复应被念出来；
     再连发两句，前一句应立刻被后一句打断（不叠音）
   - 右键 →「试听声音」、聊天设置里的「试听一句」都能出声；改声线/语速/音量后立即生效
   - 按住 **右 Alt + M** 说话：松开后应先看到气泡「你说：…」再发出，随后桌宠念出回复；
     没有说话就松开 → 提示「没听到说话」；点右键菜单「语音闲聊」也能走一轮（静音 2 秒自动收尾）
   - 聊天设置里关掉「语音播报」→ 完全不出声；`设置 → 语音` 里关掉听写组件 → 语音闲聊应提示
     「语音听写不可用：宿主的「语音」组件未开启」，而不是静默失败
   - 页面隐藏/切走再回来，语音仍正常（音频上下文被挂起时会自动重试）
9. **音效与社区皮肤（v3.3）**：
   - 点桌宠/开右键菜单/拖到边缘吸附/开始收音/出错 各有短音；聊天设置里「试听音效」能连着响五个；
     关掉音效开关后完全安静（语音不受影响，两者独立）
   - 右键 →「修改桌宠模型」应看到三张卡：**「大肥鱼·鲸鲸娘」（官方图集）**、**「大肥鱼·社区桌宠包」（社区图集，带署名）**、
     **「BongoCat 猫猫」（键盘猫，带署名 MIT 来源）**；切到社区包后换成该画风、切到 BongoCat 后显示键盘猫，
     拖动/吸附一切照旧；切回官方图集也应正常
   - **BongoCat 皮肤下敲键盘/动鼠标**：应看到猫爪亮一下（切成按下帧再切回）；
     并且**不再有飘在半空的粉色肉垫**（那是旧女仆素材叠加图层造成的，这套素材自带爪子所以不叠）
   - **右键 →「bibo语音」**：悬停向右展开，含「试听语音 / 语音闲聊 / 音效：开·关 / 声音设置…」；
     点「音效：开」应变成「音效：关」并配一声反馈音
   - **兼容回归（v3.3.1 修的坑，务必过一遍）**：贴纸面板里点一张贴纸 → 应正常出图
     （此前桌面版里贴纸与社区皮肤都因路径问题加载失败）

## 四、素材来源与许可

素材清单见 `assets.manifest.json`（install / pack / smoke 三处共用它，改动素材请同步清单）：

| 素材 | 来源 | 许可 |
|---|---|---|
| `feiyu-spritesheet.png`（8×11=88 格，192×208/格） | zhouwu97/ds-pet 官方 v2 精灵图 | MIT（见 `LICENSE-dspet.txt`） |
| `pet-bongocat.png` + `pet-bongocat-down.png`（BongoCat 键盘猫：默认帧 + 爪子按下帧） | kuroni/bongocat-osu（原样未改；作者：kuroni） | MIT（见 `LICENSE-bongocat.txt`） |
| `pet-whale-codex.webp`（社区桌宠包图集，同 8×11 / 192×208 规格） | YunYueSama/codex-deepseek-pet 的 `spritesheet.webp`（原样未改；作者：YunYueSama） | 大肥鱼项目署名许可 1.0：允许使用/修改/分享/商用，**须署名作者与仓库**（见 `LICENSE-deepseekpet.txt`） |
| `st-deepseek-*.webp`、`st-chatgpt-renwu-jieshao.webp` 等 16 张 | 蓝色大肥鱼档案馆（fisharchive.cc） | CC BY-NC-SA 4.0 |
| `st-wx-01..24.webp` | 微信表情包 640.wxpic（wxgf/HEVC）解码后 6×4 网格裁切 | 二创，非商用 |
| `icon.png` | 自有 | MIT（见 `LICENSE`） |
| `vendor/bibibobo.js` | hakihakii/bibibobo（原样引入、保留来源注释） | MIT（该文件头注明）；**v3.2 起已接入**：语音播报的合成核心，由 build.mjs 内联进产物 |
| 本仓库代码 | 坚祥（yzc） | MIT（见 `LICENSE`） |

## 五、打包发布

```powershell
# ① 标准包（包根＝插件目录，自己手动装/给懂行的人）
powershell -ExecutionPolicy Bypass -File tools\pack.ps1              # dist\pet-buddy-v<版本>.zip
powershell -ExecutionPolicy Bypass -File tools\pack.ps1 -WithSource  # 连源码一起打（二次开发用）

# ② 一键安装形态（给不用懂技术的同事）
powershell -ExecutionPolicy Bypass -File tools\pack-oneclick.ps1     # 详见下一节
```

包根 = 插件目录：对方解压到 `…\插件兼容层\`（目录名 `pet-buddy`）后刷新助手即可用，
不需要装 Node、不联网、无第三方依赖。

## 六、一键安装（给对方双击就装好）

`tools\pack-oneclick.ps1` 产出两个"对方不用懂技术"的形态（内容完全一致）：

| 产物 | 给谁 | 怎么用 |
|---|---|---|
| `dist\pet-buddy-v<版本>-一键安装.zip` | 愿意解压的人 | 解压 → 双击 **`安装.cmd`** |
| `dist\一键安装-pet-buddy-v<版本>.cmd` | 只想收**一个文件**的人 | 双击即装（安装包以 base64 内联在文件末尾，运行时自解压到临时目录） |

安装器（`tools\oneclick\install-plugin.ps1`）做的事：**自动找宿主安装目录**（`%LOCALAPPDATA%\Programs\坚祥数字助理GO`，
找不到时在 `Programs` 下按 `坚祥数字助理GO.exe` 兜底搜索）→ 校验来源完整性 → 把旧版本备份到
`%TEMP%\pet-buddy-backup-<时间戳>` → **`robocopy /MIR` 镜像复制**到 `插件兼容层\pet-buddy`
（目标与来源完全一致，不会留旧版残余文件）→ 提示按 F5。

- 不需要管理员权限、不需要 Node、不需要联网；
- 卸载：`卸载.cmd`（把插件目录移到 `%TEMP%\pet-buddy-removed-<时间戳>`，想恢复移回来即可）；
- 找不到宿主时脚本会明说，并提示"手动把 `pet-buddy` 文件夹拷到 `助手安装目录\插件兼容层\` 下"；
- 手动装法也可以指定目录：`install-plugin.ps1 -Source ".\pet-buddy" -Dest "…\插件兼容层"`。

开发机改完代码、要一条命令走完"构建 → 自检 → 同步 → 打两种包"：仓库根双击 **`一键构建并同步.cmd`**。
