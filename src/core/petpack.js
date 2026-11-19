/* ============================================================================
 * pet-buddy · 共享核心（core）· 宠物动作包（petpack）
 * ----------------------------------------------------------------------------
 * 「动作包」= 一整套动作视频（VP9-alpha webm，平铺在插件根目录，宿主只服务根级文件）
 *            + 语义角色映射（每个动作属于 idle / 点击 / 拖拽 / 余额档位 / 随机表演 / 睡觉…）。
 * 数据从模型包（dsh-pet 格式 zip：assets/webm + assets/config.jsonc）整合而来，
 * 由 tools/import-petpack.mjs 生成（含转码参数、体积、来源记录）——数据段勿手改，重跑脚本即可。
 * 本文件只放「取值与挑选」（DOM 无关，两端可用）；视频播放与调度在 pet.client.js 的 petpack 段。
 * 约束：只写顶层 const / function；不 import / 不 export。
 * ==========================================================================*/

  /* @@PETPACK-DATA-START@@（由 tools/import-petpack.mjs 生成，勿手改） */
  const PETPACKS = {
   "dshpack": {
    "id": "dshpack",
    "name": "大肥鱼·鲸鲸娘（完整动作包）",
    "source": "dsh-pet-source.zip",
    "importedAt": "2026-11-19 15:26:06",
    "params": {
     "width": 160,
     "fps": 12,
     "crf": 45,
     "crop": [
      0.62,
      0.92
     ],
     "codec": "vp9-alpha"
    },
    "thumb": "dp-thumb.png",
    "srcTotalKB": 56479,
    "outTotalKB": 6639,
    "actions": [
     {
      "file": "dp-001.webm",
      "name": "三球抛接",
      "role": "random",
      "srcKB": 536,
      "outKB": 65
     },
     {
      "file": "dp-002.webm",
      "name": "下五子棋",
      "role": "random",
      "srcKB": 503,
      "outKB": 55
     },
     {
      "file": "dp-003.webm",
      "name": "东张西望",
      "role": "turn",
      "srcKB": 417,
      "outKB": 51
     },
     {
      "file": "dp-004.webm",
      "name": "中秋赏月吃月饼",
      "role": "random",
      "srcKB": 500,
      "outKB": 55
     },
     {
      "file": "dp-005.webm",
      "name": "优雅女仆舞",
      "role": "random",
      "srcKB": 565,
      "outKB": 68
     },
     {
      "file": "dp-006.webm",
      "name": "余额-分文不剩",
      "role": "balance",
      "srcKB": 479,
      "outKB": 57
     },
     {
      "file": "dp-007.webm",
      "name": "余额-数金皱眉",
      "role": "balance",
      "srcKB": 312,
      "outKB": 31
     },
     {
      "file": "dp-008.webm",
      "name": "余额-袋空如洗",
      "role": "balance",
      "srcKB": 374,
      "outKB": 42
     },
     {
      "file": "dp-009.webm",
      "name": "余额-金袋叮当",
      "role": "balance",
      "srcKB": 519,
      "outKB": 68
     },
     {
      "file": "dp-010.webm",
      "name": "余额-钱袋如常",
      "role": "balance",
      "srcKB": 378,
      "outKB": 46
     },
     {
      "file": "dp-011.webm",
      "name": "余额-钱袋满溢",
      "role": "balance",
      "srcKB": 608,
      "outKB": 87
     },
     {
      "file": "dp-012.webm",
      "name": "侧身急躁跑",
      "role": "baifan",
      "srcKB": 718,
      "outKB": 94
     },
     {
      "file": "dp-013.webm",
      "name": "偷吃零食被抓住",
      "role": "random",
      "srcKB": 422,
      "outKB": 47
     },
     {
      "file": "dp-014.webm",
      "name": "写代码",
      "role": "random",
      "srcKB": 375,
      "outKB": 41
     },
     {
      "file": "dp-015.webm",
      "name": "写福字",
      "role": "random",
      "srcKB": 489,
      "outKB": 56
     },
     {
      "file": "dp-016.webm",
      "name": "凭空生花",
      "role": "random",
      "srcKB": 606,
      "outKB": 81
     },
     {
      "file": "dp-017.webm",
      "name": "动物环绕",
      "role": "random",
      "srcKB": 958,
      "outKB": 140
     },
     {
      "file": "dp-018.webm",
      "name": "原地专心玩魔方",
      "role": "random",
      "srcKB": 433,
      "outKB": 47
     },
     {
      "file": "dp-019.webm",
      "name": "原地小憩沉眠",
      "role": "random",
      "srcKB": 424,
      "outKB": 48
     },
     {
      "file": "dp-020.webm",
      "name": "原地左转奔跑",
      "role": "moves",
      "srcKB": 600,
      "outKB": 76
     },
     {
      "file": "dp-021.webm",
      "name": "原地敲击桌面互动",
      "role": "random",
      "srcKB": 394,
      "outKB": 42
     },
     {
      "file": "dp-022.webm",
      "name": "原地漂浮踏步",
      "role": "moves",
      "srcKB": 578,
      "outKB": 63
     },
     {
      "file": "dp-023.webm",
      "name": "原地跳跃抓碎头顶物品",
      "role": "random",
      "srcKB": 605,
      "outKB": 76
     },
     {
      "file": "dp-024.webm",
      "name": "原地蹲下玩玩具汽车",
      "role": "random",
      "srcKB": 493,
      "outKB": 63
     },
     {
      "file": "dp-025.webm",
      "name": "原地重力下蹲压缩",
      "role": "random",
      "srcKB": 210,
      "outKB": 26
     },
     {
      "file": "dp-026.webm",
      "name": "变鸽子",
      "role": "random",
      "srcKB": 498,
      "outKB": 63
     },
     {
      "file": "dp-027.webm",
      "name": "可爱宅舞",
      "role": "random",
      "srcKB": 563,
      "outKB": 59
     },
     {
      "file": "dp-028.webm",
      "name": "吃Token",
      "role": "random",
      "srcKB": 561,
      "outKB": 63
     },
     {
      "file": "dp-029.webm",
      "name": "吃冰淇淋融化",
      "role": "random",
      "srcKB": 498,
      "outKB": 57
     },
     {
      "file": "dp-030.webm",
      "name": "吃午餐",
      "role": "random",
      "srcKB": 484,
      "outKB": 54
     },
     {
      "file": "dp-031.webm",
      "name": "吃大闸蟹",
      "role": "random",
      "srcKB": 533,
      "outKB": 60
     },
     {
      "file": "dp-032.webm",
      "name": "吃年糕",
      "role": "random",
      "srcKB": 441,
      "outKB": 50
     },
     {
      "file": "dp-033.webm",
      "name": "吃早餐",
      "role": "random",
      "srcKB": 431,
      "outKB": 50
     },
     {
      "file": "dp-034.webm",
      "name": "吃晚餐",
      "role": "random",
      "srcKB": 725,
      "outKB": 100
     },
     {
      "file": "dp-035.webm",
      "name": "吃汤圆",
      "role": "random",
      "srcKB": 427,
      "outKB": 47
     },
     {
      "file": "dp-036.webm",
      "name": "吃白饭",
      "role": "random",
      "srcKB": 449,
      "outKB": 47
     },
     {
      "file": "dp-037.webm",
      "name": "吃粽子",
      "role": "random",
      "srcKB": 436,
      "outKB": 47
     },
     {
      "file": "dp-038.webm",
      "name": "吃糖葫芦",
      "role": "random",
      "srcKB": 459,
      "outKB": 51
     },
     {
      "file": "dp-039.webm",
      "name": "吃腊八粥",
      "role": "random",
      "srcKB": 450,
      "outKB": 51
     },
     {
      "file": "dp-040.webm",
      "name": "吃西瓜",
      "role": "random",
      "srcKB": 472,
      "outKB": 54
     },
     {
      "file": "dp-041.webm",
      "name": "吃重阳糕",
      "role": "random",
      "srcKB": 458,
      "outKB": 50
     },
     {
      "file": "dp-042.webm",
      "name": "吃长寿面",
      "role": "random",
      "srcKB": 478,
      "outKB": 56
     },
     {
      "file": "dp-043.webm",
      "name": "吃青团",
      "role": "random",
      "srcKB": 369,
      "outKB": 38
     },
     {
      "file": "dp-044.webm",
      "name": "吃饭·碗饭",
      "role": "baifan",
      "srcKB": 426,
      "outKB": 24
     },
     {
      "file": "dp-045.webm",
      "name": "吃饭团",
      "role": "baifan",
      "srcKB": 410,
      "outKB": 28
     },
     {
      "file": "dp-046.webm",
      "name": "吃饺子",
      "role": "random",
      "srcKB": 542,
      "outKB": 65
     },
     {
      "file": "dp-047.webm",
      "name": "吹气球",
      "role": "random",
      "srcKB": 733,
      "outKB": 88
     },
     {
      "file": "dp-048.webm",
      "name": "吹笛子",
      "role": "random",
      "srcKB": 750,
      "outKB": 98
     },
     {
      "file": "dp-049.webm",
      "name": "哈欠连天",
      "role": "random",
      "srcKB": 414,
      "outKB": 49
     },
     {
      "file": "dp-050.webm",
      "name": "堆雪人",
      "role": "random",
      "srcKB": 507,
      "outKB": 63
     },
     {
      "file": "dp-051.webm",
      "name": "大口吃零食",
      "role": "random",
      "srcKB": 788,
      "outKB": 108
     },
     {
      "file": "dp-052.webm",
      "name": "女仆屈膝礼仪",
      "role": "random",
      "srcKB": 357,
      "outKB": 38
     },
     {
      "file": "dp-053.webm",
      "name": "小幅度原地360度旋转展示",
      "role": "random",
      "srcKB": 572,
      "outKB": 75
     },
     {
      "file": "dp-054.webm",
      "name": "小提琴演奏",
      "role": "random",
      "srcKB": 591,
      "outKB": 71
     },
     {
      "file": "dp-055.webm",
      "name": "工作状态-原地踱步张望",
      "role": "workStatus",
      "srcKB": 461,
      "outKB": 50
     },
     {
      "file": "dp-056.webm",
      "name": "工作状态-垂头叹气冒汗",
      "role": "workStatus",
      "srcKB": 194,
      "outKB": 25
     },
     {
      "file": "dp-057.webm",
      "name": "工作状态-忙碌点按",
      "role": "workStatus",
      "srcKB": 464,
      "outKB": 48
     },
     {
      "file": "dp-058.webm",
      "name": "工作状态-思考冒泡",
      "role": "workStatus",
      "srcKB": 399,
      "outKB": 52
     },
     {
      "file": "dp-059.webm",
      "name": "工作状态-清点归档",
      "role": "workStatus",
      "srcKB": 354,
      "outKB": 37
     },
     {
      "file": "dp-060.webm",
      "name": "工作状态-雀跃庆祝",
      "role": "workStatus",
      "srcKB": 477,
      "outKB": 58
     },
     {
      "file": "dp-061.webm",
      "name": "开心小跑",
      "role": "baifan",
      "srcKB": 521,
      "outKB": 55
     },
     {
      "file": "dp-062.webm",
      "name": "待机呼吸休闲",
      "role": "idle",
      "srcKB": 431,
      "outKB": 49
     },
     {
      "file": "dp-063.webm",
      "name": "悠闲哼歌",
      "role": "random",
      "srcKB": 570,
      "outKB": 68
     },
     {
      "file": "dp-064.webm",
      "name": "扑克魔术",
      "role": "random",
      "srcKB": 451,
      "outKB": 52
     },
     {
      "file": "dp-065.webm",
      "name": "打瞌睡被惊醒",
      "role": "random",
      "srcKB": 443,
      "outKB": 50
     },
     {
      "file": "dp-066.webm",
      "name": "抽陀螺",
      "role": "random",
      "srcKB": 509,
      "outKB": 60
     },
     {
      "file": "dp-067.webm",
      "name": "拆礼物",
      "role": "random",
      "srcKB": 506,
      "outKB": 63
     },
     {
      "file": "dp-068.webm",
      "name": "插茱萸赏菊",
      "role": "random",
      "srcKB": 475,
      "outKB": 55
     },
     {
      "file": "dp-069.webm",
      "name": "摇扇纳凉",
      "role": "random",
      "srcKB": 498,
      "outKB": 60
     },
     {
      "file": "dp-070.webm",
      "name": "撸猫",
      "role": "random",
      "srcKB": 340,
      "outKB": 36
     },
     {
      "file": "dp-071.webm",
      "name": "收红包",
      "role": "random",
      "srcKB": 461,
      "outKB": 49
     },
     {
      "file": "dp-072.webm",
      "name": "放孔明灯",
      "role": "random",
      "srcKB": 580,
      "outKB": 70
     },
     {
      "file": "dp-073.webm",
      "name": "放河灯",
      "role": "random",
      "srcKB": 370,
      "outKB": 38
     },
     {
      "file": "dp-074.webm",
      "name": "放烟花",
      "role": "random",
      "srcKB": 1299,
      "outKB": 165
     },
     {
      "file": "dp-075.webm",
      "name": "放风筝",
      "role": "random",
      "srcKB": 752,
      "outKB": 99
     },
     {
      "file": "dp-076.webm",
      "name": "整体换装试色",
      "role": "random",
      "srcKB": 512,
      "outKB": 70
     },
     {
      "file": "dp-077.webm",
      "name": "是啊，吃什么",
      "role": "random",
      "srcKB": 574,
      "outKB": 62
     },
     {
      "file": "dp-078.webm",
      "name": "晨间刷牙",
      "role": "random",
      "srcKB": 415,
      "outKB": 42
     },
     {
      "file": "dp-079.webm",
      "name": "期待开饭",
      "role": "baifan",
      "srcKB": 399,
      "outKB": 27
     },
     {
      "file": "dp-080.webm",
      "name": "涮火锅",
      "role": "random",
      "srcKB": 456,
      "outKB": 53
     },
     {
      "file": "dp-081.webm",
      "name": "深度思考碎碎念",
      "role": "random",
      "srcKB": 423,
      "outKB": 50
     },
     {
      "file": "dp-082.webm",
      "name": "点击回应-傲娇生气",
      "role": "clicks",
      "srcKB": 383,
      "outKB": 50
     },
     {
      "file": "dp-083.webm",
      "name": "点击回应-元气挥手",
      "role": "clicks",
      "srcKB": 412,
      "outKB": 46
     },
     {
      "file": "dp-084.webm",
      "name": "点击回应-害羞惊讶",
      "role": "clicks",
      "srcKB": 526,
      "outKB": 66
     },
     {
      "file": "dp-085.webm",
      "name": "点击回应-开心跃动",
      "role": "clicks",
      "srcKB": 525,
      "outKB": 62
     },
     {
      "file": "dp-086.webm",
      "name": "点击回应-挠痒咯咯笑",
      "role": "clicks",
      "srcKB": 415,
      "outKB": 43
     },
     {
      "file": "dp-087.webm",
      "name": "照镜子",
      "role": "random",
      "srcKB": 492,
      "outKB": 56
     },
     {
      "file": "dp-088.webm",
      "name": "玩水枪",
      "role": "random",
      "srcKB": 511,
      "outKB": 61
     },
     {
      "file": "dp-089.webm",
      "name": "玩游戏气急败坏",
      "role": "random",
      "srcKB": 513,
      "outKB": 56
     },
     {
      "file": "dp-090.webm",
      "name": "用鲸鱼尾巴拍打地面",
      "role": "random",
      "srcKB": 344,
      "outKB": 35
     },
     {
      "file": "dp-091.webm",
      "name": "睡觉-开始",
      "role": "sleep.start",
      "srcKB": 324,
      "outKB": 39
     },
     {
      "file": "dp-092.webm",
      "name": "睡觉-循环",
      "role": "sleep.loop",
      "srcKB": 231,
      "outKB": 27
     },
     {
      "file": "dp-093.webm",
      "name": "睡觉-起来",
      "role": "sleep.end",
      "srcKB": 371,
      "outKB": 44
     },
     {
      "file": "dp-094.webm",
      "name": "碎碎念-发呆碎碎念",
      "role": "whisper",
      "srcKB": 319,
      "outKB": 31
     },
     {
      "file": "dp-095.webm",
      "name": "碎碎念-对屏碎碎念",
      "role": "whisper",
      "srcKB": 356,
      "outKB": 30
     },
     {
      "file": "dp-096.webm",
      "name": "碎碎念-擦桌碎碎念",
      "role": "whisper",
      "srcKB": 342,
      "outKB": 36
     },
     {
      "file": "dp-097.webm",
      "name": "穿针乞巧",
      "role": "random",
      "srcKB": 470,
      "outKB": 57
     },
     {
      "file": "dp-098.webm",
      "name": "舞狮头",
      "role": "random",
      "srcKB": 617,
      "outKB": 80
     },
     {
      "file": "dp-099.webm",
      "name": "荡秋千",
      "role": "random",
      "srcKB": 629,
      "outKB": 74
     },
     {
      "file": "dp-100.webm",
      "name": "萌化小幽灵",
      "role": "random",
      "srcKB": 412,
      "outKB": 49
     },
     {
      "file": "dp-101.webm",
      "name": "蓝鲸现世",
      "role": "random",
      "srcKB": 472,
      "outKB": 64
     },
     {
      "file": "dp-102.webm",
      "name": "蝴蝶蜜蜂环绕头顶开花",
      "role": "random",
      "srcKB": 833,
      "outKB": 110
     },
     {
      "file": "dp-103.webm",
      "name": "螃蟹走路",
      "role": "moves",
      "srcKB": 583,
      "outKB": 73
     },
     {
      "file": "dp-104.webm",
      "name": "被吓一跳",
      "role": "random",
      "srcKB": 276,
      "outKB": 23
     },
     {
      "file": "dp-105.webm",
      "name": "被落叶淹没",
      "role": "random",
      "srcKB": 749,
      "outKB": 98
     },
     {
      "file": "dp-106.webm",
      "name": "被鼠标拖拽悬空反馈",
      "role": "drag",
      "srcKB": 454,
      "outKB": 50
     },
     {
      "file": "dp-107.webm",
      "name": "装点圣诞树",
      "role": "random",
      "srcKB": 799,
      "outKB": 108
     },
     {
      "file": "dp-108.webm",
      "name": "讨糖南瓜灯",
      "role": "random",
      "srcKB": 472,
      "outKB": 57
     },
     {
      "file": "dp-109.webm",
      "name": "超大伸懒腰",
      "role": "random",
      "srcKB": 388,
      "outKB": 43
     },
     {
      "file": "dp-110.webm",
      "name": "踢毽子",
      "role": "random",
      "srcKB": 519,
      "outKB": 60
     },
     {
      "file": "dp-111.webm",
      "name": "轻快摇摆舞",
      "role": "random",
      "srcKB": 530,
      "outKB": 55
     },
     {
      "file": "dp-112.webm",
      "name": "轻快记录",
      "role": "random",
      "srcKB": 437,
      "outKB": 49
     },
     {
      "file": "dp-113.webm",
      "name": "骑木马",
      "role": "random",
      "srcKB": 681,
      "outKB": 84
     },
     {
      "file": "dp-114.webm",
      "name": "鲸鱼吐泡泡特效",
      "role": "random",
      "srcKB": 442,
      "outKB": 51
     }
    ],
    "roles": {
     "idle": [
      "待机呼吸休闲"
     ],
     "turn": [
      "东张西望"
     ],
     "drag": [
      "被鼠标拖拽悬空反馈"
     ],
     "clicks": [
      "点击回应-开心跃动",
      "点击回应-害羞惊讶",
      "点击回应-傲娇生气",
      "点击回应-挠痒咯咯笑",
      "点击回应-元气挥手"
     ],
     "moves": [
      "螃蟹走路",
      "原地漂浮踏步",
      "原地左转奔跑"
     ],
     "balance": [
      "余额-钱袋满溢",
      "余额-金袋叮当",
      "余额-钱袋如常",
      "余额-数金皱眉",
      "余额-袋空如洗",
      "余额-分文不剩"
     ],
     "whisper": [
      "碎碎念-擦桌碎碎念",
      "碎碎念-发呆碎碎念",
      "碎碎念-对屏碎碎念"
     ],
     "workStatus": [
      "工作状态-思考冒泡",
      "工作状态-忙碌点按",
      "工作状态-清点归档",
      "工作状态-原地踱步张望",
      "工作状态-雀跃庆祝",
      "工作状态-垂头叹气冒汗"
     ],
     "sleep": {
      "start": [
       "睡觉-开始"
      ],
      "loop": [
       "睡觉-循环"
      ],
      "end": [
       "睡觉-起来"
      ]
     },
     "baifan": [
      "开心小跑",
      "侧身急躁跑",
      "期待开饭",
      "吃饭·碗饭",
      "吃饭团"
     ],
     "random": [
      {
       "name": "悠闲哼歌",
       "category": "小动作"
      },
      {
       "name": "超大伸懒腰",
       "category": "小动作"
      },
      {
       "name": "原地敲击桌面互动",
       "category": "小动作"
      },
      {
       "name": "原地重力下蹲压缩",
       "category": "小动作"
      },
      {
       "name": "哈欠连天",
       "category": "小动作"
      },
      {
       "name": "原地小憩沉眠",
       "category": "小动作"
      },
      {
       "name": "女仆屈膝礼仪",
       "category": "小动作"
      },
      {
       "name": "被吓一跳",
       "category": "小动作"
      },
      {
       "name": "小幅度原地360度旋转展示",
       "category": "小动作"
      },
      {
       "name": "偷吃零食被抓住",
       "category": "小动作"
      },
      {
       "name": "用鲸鱼尾巴拍打地面",
       "category": "小动作"
      },
      {
       "name": "打瞌睡被惊醒",
       "category": "小动作"
      },
      {
       "name": "照镜子",
       "category": "小动作"
      },
      {
       "name": "整体换装试色",
       "category": "小动作"
      },
      {
       "name": "轻快记录",
       "category": "小动作"
      },
      {
       "name": "写代码",
       "category": "小动作"
      },
      {
       "name": "摇扇纳凉",
       "category": "小动作"
      },
      {
       "name": "晨间刷牙",
       "category": "小动作"
      },
      {
       "name": "原地专心玩魔方",
       "category": "玩耍"
      },
      {
       "name": "原地蹲下玩玩具汽车",
       "category": "玩耍"
      },
      {
       "name": "鲸鱼吐泡泡特效",
       "category": "玩耍"
      },
      {
       "name": "原地跳跃抓碎头顶物品",
       "category": "玩耍"
      },
      {
       "name": "玩游戏气急败坏",
       "category": "玩耍"
      },
      {
       "name": "玩水枪",
       "category": "玩耍"
      },
      {
       "name": "小提琴演奏",
       "category": "玩耍"
      },
      {
       "name": "蓝鲸现世",
       "category": "玩耍"
      },
      {
       "name": "优雅女仆舞",
       "category": "玩耍"
      },
      {
       "name": "轻快摇摆舞",
       "category": "玩耍"
      },
      {
       "name": "可爱宅舞",
       "category": "玩耍"
      },
      {
       "name": "吹气球",
       "category": "玩耍"
      },
      {
       "name": "动物环绕",
       "category": "玩耍"
      },
      {
       "name": "放风筝",
       "category": "玩耍"
      },
      {
       "name": "拆礼物",
       "category": "玩耍"
      },
      {
       "name": "变鸽子",
       "category": "玩耍"
      },
      {
       "name": "扑克魔术",
       "category": "玩耍"
      },
      {
       "name": "抽陀螺",
       "category": "玩耍"
      },
      {
       "name": "吹笛子",
       "category": "玩耍"
      },
      {
       "name": "蝴蝶蜜蜂环绕头顶开花",
       "category": "玩耍"
      },
      {
       "name": "撸猫",
       "category": "玩耍"
      },
      {
       "name": "凭空生花",
       "category": "玩耍"
      },
      {
       "name": "骑木马",
       "category": "玩耍"
      },
      {
       "name": "三球抛接",
       "category": "玩耍"
      },
      {
       "name": "踢毽子",
       "category": "玩耍"
      },
      {
       "name": "下五子棋",
       "category": "玩耍"
      },
      {
       "name": "荡秋千",
       "category": "玩耍"
      },
      {
       "name": "吃白饭",
       "category": "吃什么"
      },
      {
       "name": "大口吃零食",
       "category": "吃什么"
      },
      {
       "name": "吃Token",
       "category": "吃什么"
      },
      {
       "name": "吃早餐",
       "category": "吃什么"
      },
      {
       "name": "吃午餐",
       "category": "吃什么"
      },
      {
       "name": "吃晚餐",
       "category": "吃什么"
      },
      {
       "name": "吃冰淇淋融化",
       "category": "吃什么"
      },
      {
       "name": "吃大闸蟹",
       "category": "吃什么"
      },
      {
       "name": "吃糖葫芦",
       "category": "吃什么"
      },
      {
       "name": "吃长寿面",
       "category": "吃什么"
      },
      {
       "name": "吃西瓜",
       "category": "吃什么"
      },
      {
       "name": "涮火锅",
       "category": "吃什么"
      },
      {
       "name": "被落叶淹没",
       "category": "时节"
      },
      {
       "name": "中秋赏月吃月饼",
       "category": "时节"
      },
      {
       "name": "堆雪人",
       "category": "时节"
      },
      {
       "name": "放烟花",
       "category": "时节"
      },
      {
       "name": "吃粽子",
       "category": "时节"
      },
      {
       "name": "吃年糕",
       "category": "时节"
      },
      {
       "name": "吃青团",
       "category": "时节"
      },
      {
       "name": "吃腊八粥",
       "category": "时节"
      },
      {
       "name": "吃重阳糕",
       "category": "时节"
      },
      {
       "name": "收红包",
       "category": "时节"
      },
      {
       "name": "写福字",
       "category": "时节"
      },
      {
       "name": "穿针乞巧",
       "category": "时节"
      },
      {
       "name": "舞狮头",
       "category": "时节"
      },
      {
       "name": "讨糖南瓜灯",
       "category": "时节"
      },
      {
       "name": "插茱萸赏菊",
       "category": "时节"
      },
      {
       "name": "放河灯",
       "category": "时节"
      },
      {
       "name": "萌化小幽灵",
       "category": "时节"
      },
      {
       "name": "装点圣诞树",
       "category": "时节"
      },
      {
       "name": "放孔明灯",
       "category": "时节"
      },
      {
       "name": "吃汤圆",
       "category": "时节"
      },
      {
       "name": "吃饺子",
       "category": "时节"
      },
      {
       "name": "是啊，吃什么",
       "category": "文字"
      },
      {
       "name": "深度思考碎碎念",
       "category": "文字"
      }
     ]
    }
   }
  };
  /* @@PETPACK-DATA-END@@ */

  /** 按 id 取动作包；没有返回 null */
  function petpackById(id) {
    return PETPACKS[id] || null;
  }

  /** 全部动作包（数组） */
  function petpackList() {
    return Object.keys(PETPACKS).map(function (k) { return PETPACKS[k]; });
  }

  /** 动作名 → 动作记录（含 file / role） */
  function petpackActionOf(pack, name) {
    if (!pack || !name) return null;
    for (let i = 0; i < pack.actions.length; i++) if (pack.actions[i].name === name) return pack.actions[i];
    return null;
  }

  /** 某角色的动作名池（数组）；balance / workStatus 这类分档池返回「数组的数组」 */
  function petpackRolePool(pack, role) {
    if (!pack || !pack.roles) return [];
    return pack.roles[role] || [];
  }

  /** 从角色池随机挑一个动作名（avoid = 刚播过的，尽量不连着重复）；池空返回 '' */
  function petpackPick(pack, role, avoid, rnd) {
    const pool = petpackRolePool(pack, role);
    if (!pool.length) return '';
    const r = (typeof rnd === 'number' && isFinite(rnd)) ? rnd : Math.random();
    if (pool.length === 1) return pool[0];
    let idx = Math.floor(Math.max(0, Math.min(0.999999, r)) * pool.length);
    if (pool[idx] === avoid) idx = (idx + 1) % pool.length;
    return pool[idx];
  }

  /** 分档池（如余额 6 档）按档位挑：pool 是数组的数组，index 越界则夹到最后一档 */
  function petpackPickTier(pack, role, tier, avoid, rnd) {
    const pool = petpackRolePool(pack, role);
    if (!pool.length) return '';
    const i = Math.max(0, Math.min(pool.length - 1, Math.round(Number(tier) || 0)));
    const seg = pool[i];
    if (!seg || !seg.length) return '';
    return petpackPick({ roles: { _t: seg }, pick: null }, '_t', avoid, rnd);
  }

  /** 随机表演池：{name, category} 数组（自带分类，供界面与权重用） */
  function petpackRandomPool(pack) {
    return (pack && pack.roles && pack.roles.random) || [];
  }

  /** 从随机表演池挑一个动作名（可按分类过滤；pool 过滤后为空则退回全量） */
  function petpackPickRandom(pack, category, avoid, rnd) {
    let pool = petpackRandomPool(pack);
    if (category) {
      const f = pool.filter(function (x) { return x.category === category; });
      if (f.length) pool = f;
    }
    if (!pool.length) return '';
    const r = (typeof rnd === 'number' && isFinite(rnd)) ? rnd : Math.random();
    const names = pool.map(function (x) { return x.name; });
    let idx = Math.floor(Math.max(0, Math.min(0.999999, r)) * names.length);
    if (names[idx] === avoid) idx = (idx + 1) % names.length;
    return names[idx];
  }

  /** 动作包素材文件 → 插件内可用 URL（走 assetUrl：宿主只服务根级文件，故平铺） */
  function petpackFileUrl(file) {
    return assetUrl(file);
  }
