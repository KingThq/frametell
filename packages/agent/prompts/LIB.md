# 现成组件库（engine/lib/）

需要时用 `node engine/tools/use-extra.mjs <文件名>` 拷进本项目并登记（并行安全），再 Read 该文件看用法。用不上就别用，手写也可以。每个文件都能单独用、可以任意组合，名字互不覆盖。数据（标签、颜色、数值）都由页面传进去，组件里不写死任何题材。

通用的 `P.move(L, fn)`（驱动图层）、`P.pathAt(d)`（沿路径取点）、`PV.keys`（关键帧）、`PV.mix`（混色）、`PV.arcAt`（弧线上的点）、`PV.mmss`、`PV.tw`（估字宽）在引擎里，直接用，不用登记。

| 文件 | 组件 |
|---|---|
| `warm.js` | 暖调叙事插画的比喻物：`ground` 地面 / `snowball` 会长大的雪球 / `jar` 装硬币的玻璃罐（水位）/ `coin` 硬币（可下落）/ `tree` 会生长结果的树 / `trail` 山路（可铺开，带行走点）/ `hand` 不露脸的手 / `calendar` 台历 / `tag` 写在物上的数字标签（可计数到念出的那个词） |
| `gauges.js` | tank 会溢出的水箱 / gauge 半圆表盘 / loopRing 环上节点 + 跑动的点 / stampF 带底纸的印章 |
| `meters.js` | hist 带容量线的时间直方图 / meter 竖向水位 / clock 秒表 |
| `switches.js` | breaker 会跳闸的开关 / hbar 带阈值的横条 / mtag 等宽标签 / loopTrack 椭圆循环 + 阶段框 / door 会亮的出口 |
| `waffle.js` | waffle 小人方阵（占比） |
| `cells.js` | cells 按阅读顺序填满的格子 / win 带标题和计数的格子窗口 / place3d 单层 3D 摆放 / PV.fmt、PV.fmtK 数字格式 |
| `messages.js` | msgcol 消息列（行会缩短、掉落、改标签）/ flip2 双面 3D 翻卡 / cellgrid 按顺序填的方格 |
| `radar.js` | radar(cx, cy, r, axes, vals) 雷达图 / msgs 消息叠（可收成一张卡） |
| `segments.js` | strip 一整条分段带（段宽随时间变，可标保留段和重做段） |
| `terminal.js` | term 终端 / gantt 甘特图 + 播放头 / flow 沿折线流动的小包 |
| `fsm.js` | fsm 状态机 + 游标 / plot 随时间画出的折线图 |
| `gates.js` | stageDots(steps, cur) 阶段圆点 / gates3d 3D 纵深门廊 / pkt 跟着函数走的小包 |
| `pipeline.js` | pipeline 小包流过一列步骤，产出飞进结果面板 |
| `flowgraph.js` | graph 节点图 + run() 走动的状态包 / switcher 道岔 / packet 信封小包 / ckstack 3D 卡片摞 / PV.hlx、PV.colX 代码卡列位 |
| `sequence.js` | seq 双方时序图 + 飞行消息 / jsonPanel 打字出现的 JSON / fold3d 翻倒成标签的卡片 / stack3d 3D 层叠板 |
| `matrix.js` | matrix 行×列格子收拢到中枢（N×M → N+M）/ tape 滚动的单行消息日志 / editor 编辑器窗口 / flipc 双面翻卡 / stage3d 3D 纵深舞台 / PV.bytes |
| `dialog.js` | dlg 带两个按钮的确认框 / lock 会打开的锁 / plates3d 粗到细的筛板 |
| `receipt.js` | receipt 一行行打印的小票 / zipper 两列逐行比对的拉链 |
| `filetree.js` | filetree(x, y, rows) 目录树 / ftile 文件小卡 / fly 弧线飞行标签 |
| `notes.js` | memfile 逐行写入的文件卡 / mcard 折角便签 / markLines 按渲染行荧光 / PV.age 由新变旧的配色 |
| `layers.js` | netgraph 按时间生长的节点网 / layers3d 3D 层叠板（带 proj 屏幕投影）/ fcard 可追加、划线、高亮的文档卡 / flip 两面翻卡 |
| `tower.js` | tower3d 3D 层叠塔（带 proj 钉标签）/ flipcard 翻面标签卡 / memcard 折角文件卡（可带标签） |
| `pointcloud.js` | space3d 3D 点云 / chunkText 文本按块上色 / lanes 两条泳道的站点 + 箭头 |
| `ranking.js` | rankList 平滑换位的名次表 / PV.softPos、PV.orderPos 名次位置 / tower 叠层方块 / PV.proj2d 二维点投到框里 |
| `scorecard.js` | scoretubes(x, y, items) 评分管 / ruler(x, y, w, items) 分色尺 / badge(x, y, name) logo + 名字 / PV.rise |
| `bookshelf.js` | shelf 3D 书架（书脊宽高来自数据，可抽出一本） |
| `bots.js` | bot 带名牌的机器人 / env 弧线飞行信封 / jfile 行追加的文件卡 / timer 时钟 + 读数 |
| `debris.js` | demo「示意」小标签 / fall 碎片掉落 / srv 服务器框 / PV.blink 状态灯闪烁 |

## 引擎的已知坑
- `PV.ease` 没有 `in`，加速曲线手写 `u*u`。
- `P.line` 不支持 dashed（只有箭头支持）；`P.line` 返回的 handle 可以 `.hide()`。
- `code().hl` 按字符列定位，JetBrains Mono 每个字符约 0.6× 字号；高亮偏了就截图对位。
- `P.follow` 没有左对齐选项，需要时手动设 `el.style.textAlign`。
- `P.slider` 刻度标签固定 26px。
- `text()` 生成的空格是 `&nbsp;`，按英文单词 `markSpan` 定位前先把 `\u00a0` 换成空格。
- 代码卡高亮器会把字符串里的 `//`（如 `https://`）当注释，需要时在两个斜杠间插零宽空格。
- CSS 3D 翻面用 `visibility:hidden` 藏背面无效（每一笔自带 visibility:visible），要用 opacity。
- 拼图第一帧偶尔在字体加载前截到，画面会缺内容；单独重截一次即可。
- `P.code` 的 `label` 参数注释里有，但没实现。
- `P.cam` 拉远后页标题会被页眉渐变压淡；推近时注意别切字。

