# 画面 API 速查（Frametell）

## 写画面（pages/pNN.js）

```js
ENGINE.visual('p22', (P) => {
  P.title('④ 执行工具，收集结果', { accent: 'green' });
  P.chip(160, 230, 240, '🔧 read_file', { color: 'green', at: P.c(1, 0.2), h: 58, size: 26 });
  P.arrow(420, 340, 560, 340, { at: P.c(2), color: 'soft' });
  P.icon('stack', 650, 340, 110, { at: P.c(2, 0.3) });
  P.box(160, 620, 760, 200, { fill: 'redF', color: 'red', at: P.c(7), dur: 0.6 });
  P.text('`Error: failed`', { x: 200, y: 646, size: 34, color: 'red', at: P.c(7, 0.3), cps: 16 });
});
```

**坐标**：画布 1920×1080，左上为原点；内容区大约 x 140–1780、y 180–880（上方是页标题，下方留给字幕）。
**时间**：页内秒数。`P.c(i, dt)` = 第 i 句开口时刻 + dt；`P.cw(i, '30年', dt)` = 第 i 句念到「30年」的时刻（词级卡点：数字的计数要在念到它时落定，起点写 `P.cw(i, '30年') - 计数时长`）；`P.ce(i)` = 第 i 句结束；`P.endT` = 本页口播结束。
**颜色**：`ink soft muted faint`（墨色由深到浅）、`blue orange red green purple`，加 `F` 是对应浅色填充（`blueF`），另有 `paper yellow`。

| 原语 | 用法 |
|---|---|
| `P.text(str, { x, y, size, color, w, align:'c', font:'hand'\|'latin'\|'mono', weight, at, cps, mode, lh })` | 手写逐字（`cps` 字/秒）；`mode:'fade'` 整块淡入、`'words'` 快写。标记：`{r:红字}`（r/b/g/o/p/m/s/k）、`**粗体**`、`` `等宽` ``、`\n`。`raw:true` 关闭标记 |
| `P.title(str, { accent })` | 左上页标题 + 波浪下划线 |
| `P.box(x,y,w,h,{ fill, color, r, sw, dur, texture:false, rough })` / `rect` / `circle(cx,cy,d)` / `ellipse` / `line` / `path(d)` / `curve(pts)` | 逐笔描绘的形状 |
| `P.arrow(x1,y1,x2,y2,{ bend, head, dashed, single })` | 手绘箭头 |
| `P.ring(cx,cy,w,h)` / `P.underline(x,y,w)` / `P.mark(x,y,w,h)` / `P.check(x,y)` / `P.cross(x,y)` | 圈注、下划线、荧光笔、对勾、叉 |
| `P.markSpan(t,i0,i1)` / `ringSpan` / `underSpan` | 按「第 i0–i1 个字」给已写出的文字加荧光/圈/线 |
| `P.code(lines, { x, y, w, size, at, cps, label })` → `.hl(row, at, { n, color })` | 代码卡片（自动高亮），可按行高亮 |
| `P.icon(name, cx, cy, size, { at, fill, color, rot })` | 图标：person robot wheel file terminal gear magnifier bulb wrench eye clock hourglass scissors warn door flag sun stack bird plug puzzle brain shield rocket fuse spinner chat cpu stop books sparkle |
| `P.liveRough((lt, R) => [R.box(…), R.path(…), R.circle(…), R.line(…)])` | 几何随时间变化的手绘形状（每帧重画，种子固定不抖）：生长的柱子、变粗的光束、移动的块 |
| `P.follow(lt => ({ text, x, y, opacity }), o)` | 内容和位置都跟着时间走的文字（数值标签、计数） |
| `P.bars(items, (i, lt) => v, { x, base, bw, gap, scale, fmt })` | 实时柱状图，支持负值 |
| `P.slider(x, y, w, min, max, lt => v, { ticks, label })` / `P.tex(latex, o)` / `P.canvas(x, y, w, h, (ctx, lt) => …)` | 滑块 / KaTeX 公式（`META.libs` 加 katex）/ 逐帧重画的画布（热力图、密集点阵） |
| `P.tokens(list, { x, y, align, flipAt, idFirst })` → `chips[i].move = lt => ({ dx, dy, s, rot, op })` | token 块行：翻面显示编号、单独移动 |
| `PV.K(lt, a, dur, ease)` / `PV.softmax(z, T)` | 进度 0→1 / 真实 softmax |
| `P.shell3d({ cx, cy, core, step, band, gap, parts: [{ color }], at(i), explode(lt), lift(i, lt), op(i, lt), rot(lt), coreLabel })` → `{ S, z, proj, corner(i, lt), half }` | 模型内核外套 n 层方框壳的 3D 爆炸图；`corner` 给出第 i 层右前角的屏幕坐标，平面标签可以用 liveRough 连线钉上去（例：26/p05、p35）。`PV.tw(str, size)` 估字宽 |
| `P.three(x, y, w, h, setup(T, S), draw(lt, S), { fov, at })` | **three.js 3D 场景**（量子力学系列首用）：`META.vendor: ['three']` + `META.webgl: true`。`setup` 只跑一次，往 `S.scene` 里加东西、引用挂在 `S` 上；`draw` 每帧按 `lt` 摆好物体和 `S.camera`（必须是 lt 的纯函数，随机数用 `PV.rng`）。所有场景共用一个 WebGL 渲染器再拷进各自的 2D canvas，页数再多也不会超出浏览器的 WebGL 上下文上限。例：`quantum/quantum-01` |
| `P.logo(name, cx, cy, size, { at, mono })` | **真实品牌 logo**：先在项目目录跑 `node engine/tools/logos.mjs anthropic openai …` 生成 `extras/logos.js`（simple-icons → iconify logos），并登记到 `META.extras`；`logos:openai` 可强制取横版带字标志 |
| `P.bubble(x,y,w,str,{ side:'l'\|'r' })` / `P.chip` / `P.card(x,y,w,h,{ title })` / `P.keycap(x,y,label,{ press })` / `P.stamp(x,y,str)` / `P.live(x,y,lt=>str)` / `P.pulse(el,t)` | 组件 |
| `P.layer()` → 子 Builder，`.wrap` 可整体移动/淡出；配合 `P.tick(lt => …)` 做分段切换（例：02/p01） | 一页内换场 |
| `handle.hide(t, dur)` | 某元素在 t 时淡出 |
| `P.cam([{ at, x, y, s, dur, ease }])` | 镜头关键帧。`ease`：`'inOut'`（默认，平稳）· `'out'`（脉冲：快动后停住）· `'slam'`（冲过头再回落） |
| `P.push(at, x, y, s=1.25)` / `P.pan(at, x, y)` / `P.slam(at, x, y, s=1.2)` / `P.shake(at, amp=10)` / `P.back(at)` | 脉冲镜头预设，放进 `P.cam([...])`：快推 0.28s、同倍率横移 0.30s、砸入、震镜（每片 ≤ 2 次）、回到全景。停住→快动→停住，不做整页匀速慢推 |
| 所有原语共有 | `at` 开始时刻、`dur` 描绘时长 |

需要新图标：在 `doodles.js` 的 `F` 里加一个 `name: (u, o) => [...]`（100×100、中心为原点的单位框）。
参考写法：`agent-fundamentals/agent-fundamentals-02/pages/` 里 39 页覆盖了上面所有用法。

## 真实素材：截图、视频片段、浏览器窗口（runtime/media.js）

讲开源项目、产品演示时，把真东西放进手绘画面：

| 原语 | 用法 |
|---|---|
| `P.img(src, x, y, w, h, { fit, pos, r, border, mask, blend, at })` | 静态图（插图、渲染图），建页时预加载 |
| `P.clip(name, x, y, w, h, { at, fps, speed, from, to, loop, pingpong, timeMap })` | 帧序列片段：`assets/clips/<name>/f000.jpg…`；`timeMap: [[lt, 片段秒数], …]` 让片段时间跟着口播走 |
| `P.cameo(kind, cx, cy, size, o)` | 角色表演片段 `clips/c-<kind>`，柔边 + 正片叠底融进纸面 |
| `P.browser(x, y, w, h, { src, url, crop, pan, at })` → `.mark(rect, o)` / `.ring(rect, o)` / `.toStage(rect)` | 浏览器窗口 + 真实网页截图（2× 截图，rect 用页面 CSS 像素）；`pan: [{ at, y }]` 滚动 |

- 片段帧放好后运行 `node engine/tools/clips.mjs` 生成 `extras/clips.js`（帧数登记），并放在 `META.extras` 第一个。
- 片段帧**按需加载**、有上限的缓存：12 个出片进程也不会撑爆内存。页面可设 `window.__frameReady(t)`（media.js 已设好），`render-chunk` / `snap` 截图前会等它，保证每帧图片都解码完，输出确定。
- 网页截图：截完整链接对应的页面，避开导航栏和吸顶栏；圈注的位置要按截图实际量出来，不要估。

