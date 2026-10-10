# 现成组件库（engine/lib/）

需要时用 `node engine/tools/use-extra.mjs <文件名>` 拷进本项目并登记（并行安全），再 Read 该文件看用法。用不上就别用，手写也可以。

| 文件 | 组件 |
|---|---|
| `warm.js` | 暖调叙事插画的比喻物：`ground` 地面 / `snowball` 会长大的雪球 / `jar` 装硬币的玻璃罐（水位）/ `coin` 硬币（可下落）/ `tree` 会生长结果的树 / `trail` 山路（可铺开，带行走点）/ `hand` 不露脸的手 / `calendar` 台历 / `tag` 写在物上的数字标签（可计数到念出的那个词） |
| `widgets01.js` | gauge 表盘 / tank 水箱 / stampF / loopRing |
| `runner.js` | pathAt / PV.keys / PV.mix |
| `waffle.js` | 百格图 |
| `stream.js` | term 终端 / gantt 甘特 / flow 流程 |
| `resil.js` | meter 竖向水位 / clock 秒表 / hist 时间直方图 |
| `fuses.js` | mtag 等宽标签 / hbar 带阈值横条 / loopTrack + door / breaker |
| `fc08.js` | fsm 状态机 / plot 带播放头折线 |
| `pipe09.js` | pkt 移动包裹 / gates3d 3D 纵深门廊 |
| `strip10.js` | 请求纸带（段宽随时间变、Cache 命中条、失效波） |
| `mcp11.js` | seq 时序图 + 飞行报文 / jsonPanel / fold3d 翻倒卡片 / stack3d 3D 层叠 |
| `shelf12.js` | 3D 书架（按数据定宽、可抽出） |
| `perm13.js` | dlg 权限弹窗 / move 图层驱动 / plates3d 半透明层叠板 |
| `ctx14.js` | PV.DIMS 五维配色 / radar 雷达图 / msgs 消息叠 |
| `pipe15.js` | pipeline |
| `msgs16.js` | msgcol 消息列 / flip2 双面 3D 翻转卡 / grid16 方格窗口 |
| `cost17.js` | receipt 收据打印机 / zipper 前缀拉链 |
| `jit18.js` | fly 弧线飞行标签 / tree 目录树 / 文件小卡 |
| `rag19.js` | space3d 3D 点云 / chunkText 文本分块上色 / rail 两段式管线 |
| `kc21.js` | layers3d 3D 层叠板（带 proj() 屏幕投影）/ flip 两面翻卡 / fcard Markdown 文件卡（追加/划线/高亮）/ mv / PV.tw 估字宽 / kgraph 按时间生长的节点网 |
| `mem22.js` | tower3d 3D 层叠塔（带 proj 钉标签）/ flipcard 翻面标签卡 / memcard 带类型标签的文件卡 |
| `mem23.js` | markLines 按渲染行分别荧光 / memfile 带表头文件卡 / mcard 折角记忆卡（要传 layer）/ PV.age 泛黄变红配色 |
| `split24.js` | cells / win 1K 格上下文窗口（只改透明度，不抖）/ place3d 分层 3D 摆放 |
| `swarm25.js` | bot 带名牌机器人 / env 弧线飞行信封 / jfile 行追加的 JSON 卡 / timer / PV.AG 角色配色 / PV.arcAt |
| `dep28.js` | B.demo「示意」小标签 / B.fall 碎片下落 |
| `obs27.js` | mv 图层驱动 / PV.tw / PV.mmss / PV.money |
| `acp29.js` | tape 消息纸带（方向+字节数+滚动）/ matrix N×M→N+M 适配格 / stage3d 3D 纵深舞台 / flipc 双面翻卡（用 opacity 隐藏背面）/ PV.bytes |
| `fw31.js` | card6 六管评分卡（可叠第二段）/ ruler 六色尺 / badge logo+名字 / demo「示意」标签 |
| `lg30.js` | graph()+run() LangGraph 风格图与状态包 / switcher 道岔 / ckstack 3D 存档摞 / pillarBar + PV.PILLARS / PV.hlx / PV.colX |
| `ret20.js` | rankList 名次表（行平滑换位）/ PV.softPos / PV.orderPos |

## kit 的已知坑
- `PV.ease` 没有 `in`，加速曲线手写 `u*u`；传 undefined 给 `PV.K` 会静默退回 inOut。
- `P.line` 不支持 dashed（只有箭头支持）；`P.line` 返回的 handle 可以 `.hide()`。
- `code().hl` 字符宽：15 集实测约 0.49× 字号，30 集实测 JetBrains Mono 为 0.6×，结论矛盾，待主控核实；部分高亮偏了就截图对位。
- `P.follow` 没有左对齐选项，需要时手动设 `el.style.textAlign`。
- `P.slider` 刻度标签固定 26px。
- `text()` 生成的空格是 `&nbsp;`，按英文单词 `markSpan` 定位前先把 `\u00a0` 换成空格。
- 代码卡高亮器会把字符串里的 `//`（如 `https://`）当注释，需要时在两个斜杠间插零宽空格。
- CSS 3D 翻面用 `visibility:hidden` 藏背面无效（每一笔自带 visibility:visible），要用 opacity。
- 拼图第一帧偶尔在字体加载前截到，画面会缺内容；单独重截一次即可。
- `P.code` 的 `label` 参数注释里有，但没实现。
- `P.cam` 拉远后页标题会被页眉渐变压淡；推近时注意别切字（见 CLAUDE.md）。

