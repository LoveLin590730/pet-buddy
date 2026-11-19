# 模型包整合记录 · 大肥鱼·鲸鲸娘（完整动作包）（dshpack）

- 源包：`dsh-pet-source.zip`（136.9 MB）
- 导入时间：2026-11-19 15:26:06
- 转码参数：ffmpeg fps=12,crop=iw*0.62:ih*0.92:(iw-iw*0.62)/2:(ih-ih*0.92)/2,scale=160:-2:flags=lanczos,format=yuva420p，libvpx-vp9 crf45，VP9-alpha
- 体积：动作素材 55.2 MB → 6.48 MB（-88%）；共 114 个动作
- 素材文件：插件根目录 `dp-001.webm` … `dp-114.webm`（宿主只服务根级文件，必须平铺）

## 语义角色映射（来自包内 assets/config.jsonc 的 animations）

- **idle**（1）：待机呼吸休闲
- **turn**（1）：东张西望
- **drag**（1）：被鼠标拖拽悬空反馈
- **clicks**（5）：点击回应-开心跃动、点击回应-害羞惊讶、点击回应-傲娇生气、点击回应-挠痒咯咯笑、点击回应-元气挥手
- **balance**（6）：余额-钱袋满溢、余额-金袋叮当、余额-钱袋如常、余额-数金皱眉、余额-袋空如洗、余额-分文不剩
- **whisper**（3）：碎碎念-擦桌碎碎念、碎碎念-发呆碎碎念、碎碎念-对屏碎碎念
- **workStatus**（6）：工作状态-思考冒泡、工作状态-忙碌点按、工作状态-清点归档、工作状态-原地踱步张望、工作状态-雀跃庆祝、工作状态-垂头叹气冒汗
- **moves**（3）：螃蟹走路、原地漂浮踏步、原地左转奔跑
- **baifan**（5）：开心小跑、侧身急躁跑、期待开饭、吃饭·碗饭、吃饭团
- **sleep**：入睡 睡觉-开始 / 循环 睡觉-循环 / 醒来 睡觉-起来
- **随机表演**（80，分 5 类）：悠闲哼歌、超大伸懒腰、原地敲击桌面互动、原地重力下蹲压缩、哈欠连天、原地小憩沉眠、女仆屈膝礼仪、被吓一跳、小幅度原地360度旋转展示、偷吃零食被抓住 …

## 动作清单

| 文件 | 动作名 | 角色 | 原 KB | 转后 KB |
|---|---|---|---|---|
| dp-001.webm | 三球抛接 | random | 536 | 65 |
| dp-002.webm | 下五子棋 | random | 503 | 55 |
| dp-003.webm | 东张西望 | turn | 417 | 51 |
| dp-004.webm | 中秋赏月吃月饼 | random | 500 | 55 |
| dp-005.webm | 优雅女仆舞 | random | 565 | 68 |
| dp-006.webm | 余额-分文不剩 | balance | 479 | 57 |
| dp-007.webm | 余额-数金皱眉 | balance | 312 | 31 |
| dp-008.webm | 余额-袋空如洗 | balance | 374 | 42 |
| dp-009.webm | 余额-金袋叮当 | balance | 519 | 68 |
| dp-010.webm | 余额-钱袋如常 | balance | 378 | 46 |
| dp-011.webm | 余额-钱袋满溢 | balance | 608 | 87 |
| dp-012.webm | 侧身急躁跑 | baifan | 718 | 94 |
| dp-013.webm | 偷吃零食被抓住 | random | 422 | 47 |
| dp-014.webm | 写代码 | random | 375 | 41 |
| dp-015.webm | 写福字 | random | 489 | 56 |
| dp-016.webm | 凭空生花 | random | 606 | 81 |
| dp-017.webm | 动物环绕 | random | 958 | 140 |
| dp-018.webm | 原地专心玩魔方 | random | 433 | 47 |
| dp-019.webm | 原地小憩沉眠 | random | 424 | 48 |
| dp-020.webm | 原地左转奔跑 | moves | 600 | 76 |
| dp-021.webm | 原地敲击桌面互动 | random | 394 | 42 |
| dp-022.webm | 原地漂浮踏步 | moves | 578 | 63 |
| dp-023.webm | 原地跳跃抓碎头顶物品 | random | 605 | 76 |
| dp-024.webm | 原地蹲下玩玩具汽车 | random | 493 | 63 |
| dp-025.webm | 原地重力下蹲压缩 | random | 210 | 26 |
| dp-026.webm | 变鸽子 | random | 498 | 63 |
| dp-027.webm | 可爱宅舞 | random | 563 | 59 |
| dp-028.webm | 吃Token | random | 561 | 63 |
| dp-029.webm | 吃冰淇淋融化 | random | 498 | 57 |
| dp-030.webm | 吃午餐 | random | 484 | 54 |
| dp-031.webm | 吃大闸蟹 | random | 533 | 60 |
| dp-032.webm | 吃年糕 | random | 441 | 50 |
| dp-033.webm | 吃早餐 | random | 431 | 50 |
| dp-034.webm | 吃晚餐 | random | 725 | 100 |
| dp-035.webm | 吃汤圆 | random | 427 | 47 |
| dp-036.webm | 吃白饭 | random | 449 | 47 |
| dp-037.webm | 吃粽子 | random | 436 | 47 |
| dp-038.webm | 吃糖葫芦 | random | 459 | 51 |
| dp-039.webm | 吃腊八粥 | random | 450 | 51 |
| dp-040.webm | 吃西瓜 | random | 472 | 54 |
| dp-041.webm | 吃重阳糕 | random | 458 | 50 |
| dp-042.webm | 吃长寿面 | random | 478 | 56 |
| dp-043.webm | 吃青团 | random | 369 | 38 |
| dp-044.webm | 吃饭·碗饭 | baifan | 426 | 24 |
| dp-045.webm | 吃饭团 | baifan | 410 | 28 |
| dp-046.webm | 吃饺子 | random | 542 | 65 |
| dp-047.webm | 吹气球 | random | 733 | 88 |
| dp-048.webm | 吹笛子 | random | 750 | 98 |
| dp-049.webm | 哈欠连天 | random | 414 | 49 |
| dp-050.webm | 堆雪人 | random | 507 | 63 |
| dp-051.webm | 大口吃零食 | random | 788 | 108 |
| dp-052.webm | 女仆屈膝礼仪 | random | 357 | 38 |
| dp-053.webm | 小幅度原地360度旋转展示 | random | 572 | 75 |
| dp-054.webm | 小提琴演奏 | random | 591 | 71 |
| dp-055.webm | 工作状态-原地踱步张望 | workStatus | 461 | 50 |
| dp-056.webm | 工作状态-垂头叹气冒汗 | workStatus | 194 | 25 |
| dp-057.webm | 工作状态-忙碌点按 | workStatus | 464 | 48 |
| dp-058.webm | 工作状态-思考冒泡 | workStatus | 399 | 52 |
| dp-059.webm | 工作状态-清点归档 | workStatus | 354 | 37 |
| dp-060.webm | 工作状态-雀跃庆祝 | workStatus | 477 | 58 |
| dp-061.webm | 开心小跑 | baifan | 521 | 55 |
| dp-062.webm | 待机呼吸休闲 | idle | 431 | 49 |
| dp-063.webm | 悠闲哼歌 | random | 570 | 68 |
| dp-064.webm | 扑克魔术 | random | 451 | 52 |
| dp-065.webm | 打瞌睡被惊醒 | random | 443 | 50 |
| dp-066.webm | 抽陀螺 | random | 509 | 60 |
| dp-067.webm | 拆礼物 | random | 506 | 63 |
| dp-068.webm | 插茱萸赏菊 | random | 475 | 55 |
| dp-069.webm | 摇扇纳凉 | random | 498 | 60 |
| dp-070.webm | 撸猫 | random | 340 | 36 |
| dp-071.webm | 收红包 | random | 461 | 49 |
| dp-072.webm | 放孔明灯 | random | 580 | 70 |
| dp-073.webm | 放河灯 | random | 370 | 38 |
| dp-074.webm | 放烟花 | random | 1299 | 165 |
| dp-075.webm | 放风筝 | random | 752 | 99 |
| dp-076.webm | 整体换装试色 | random | 512 | 70 |
| dp-077.webm | 是啊，吃什么 | random | 574 | 62 |
| dp-078.webm | 晨间刷牙 | random | 415 | 42 |
| dp-079.webm | 期待开饭 | baifan | 399 | 27 |
| dp-080.webm | 涮火锅 | random | 456 | 53 |
| dp-081.webm | 深度思考碎碎念 | random | 423 | 50 |
| dp-082.webm | 点击回应-傲娇生气 | clicks | 383 | 50 |
| dp-083.webm | 点击回应-元气挥手 | clicks | 412 | 46 |
| dp-084.webm | 点击回应-害羞惊讶 | clicks | 526 | 66 |
| dp-085.webm | 点击回应-开心跃动 | clicks | 525 | 62 |
| dp-086.webm | 点击回应-挠痒咯咯笑 | clicks | 415 | 43 |
| dp-087.webm | 照镜子 | random | 492 | 56 |
| dp-088.webm | 玩水枪 | random | 511 | 61 |
| dp-089.webm | 玩游戏气急败坏 | random | 513 | 56 |
| dp-090.webm | 用鲸鱼尾巴拍打地面 | random | 344 | 35 |
| dp-091.webm | 睡觉-开始 | sleep.start | 324 | 39 |
| dp-092.webm | 睡觉-循环 | sleep.loop | 231 | 27 |
| dp-093.webm | 睡觉-起来 | sleep.end | 371 | 44 |
| dp-094.webm | 碎碎念-发呆碎碎念 | whisper | 319 | 31 |
| dp-095.webm | 碎碎念-对屏碎碎念 | whisper | 356 | 30 |
| dp-096.webm | 碎碎念-擦桌碎碎念 | whisper | 342 | 36 |
| dp-097.webm | 穿针乞巧 | random | 470 | 57 |
| dp-098.webm | 舞狮头 | random | 617 | 80 |
| dp-099.webm | 荡秋千 | random | 629 | 74 |
| dp-100.webm | 萌化小幽灵 | random | 412 | 49 |
| dp-101.webm | 蓝鲸现世 | random | 472 | 64 |
| dp-102.webm | 蝴蝶蜜蜂环绕头顶开花 | random | 833 | 110 |
| dp-103.webm | 螃蟹走路 | moves | 583 | 73 |
| dp-104.webm | 被吓一跳 | random | 276 | 23 |
| dp-105.webm | 被落叶淹没 | random | 749 | 98 |
| dp-106.webm | 被鼠标拖拽悬空反馈 | drag | 454 | 50 |
| dp-107.webm | 装点圣诞树 | random | 799 | 108 |
| dp-108.webm | 讨糖南瓜灯 | random | 472 | 57 |
| dp-109.webm | 超大伸懒腰 | random | 388 | 43 |
| dp-110.webm | 踢毽子 | random | 519 | 60 |
| dp-111.webm | 轻快摇摆舞 | random | 530 | 55 |
| dp-112.webm | 轻快记录 | random | 437 | 49 |
| dp-113.webm | 骑木马 | random | 681 | 84 |
| dp-114.webm | 鲸鱼吐泡泡特效 | random | 442 | 51 |

## 复用说明

```powershell
node tools/import-petpack.mjs <另一个模型包.zip> --id mypack --prefix mp
```

任何「dsh-pet 格式」的模型包（assets/webm/*.webm + assets/config.jsonc）都能这样整合；
脚本会复用 core/zipread.js 读包、按 config.jsonc 建立语义映射、用 ffmpeg 统一转码，
并自动更新 src/core/petpack.js 与 assets.manifest.json，最后写出本记录。
