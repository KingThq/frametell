# @frametell/engine

Frametell 的视频引擎。一条视频是一个项目目录，引擎负责把它播放、截图和渲染成 MP4。

## 项目目录

```
<project>/
├── index.html        加载 script.js 和 engine/boot.js
├── engine -> …       指向本包的目录链接（Studio 创建项目时自动建好）
├── script.js         口播脚本：唯一真相源。META + PAGES（每页一组字幕句 cue）
├── voice.js          真实配音时间戳（SCRIPT.VOICE），由配音模块生成
├── audio/            每页一段配音
├── pages/pNN.js      每页画面：ENGINE.visual(id, P => …)，必须是时间 t 的纯函数
├── extras/           本项目用到的组件（从 lib/ 拷入，登记在 META.extras）
└── out/              截图、成片、字幕
```

## 运行时

- `runtime/timing.js`：按 cue 与配音排出整条时间线，`P.c(i, dt)` 拿到第 i 句开口的时刻。
- `runtime/engine.js`：页面切换、镜头、字幕；`ENGINE.renderAt(t)` 渲染任意时刻。
- `runtime/core.js`、`text.js`、`doodles.js`、`widgets.js`、`live.js`：画面 API（见 `packages/agent/prompts/API.md`）。
- `lib/`：可复用组件；`node engine/tools/use-extra.mjs <name>` 拷入项目并登记。

## 工具（在项目目录里运行）

| 命令 | 作用 |
|---|---|
| `node engine/tools/script.mjs` | 检查口播脚本，估算时长 |
| `node engine/tools/pages.mjs [--json]` | 每页的真实时间范围与每句 cue 的时刻 |
| `node engine/tools/lint.mjs [--only pNN]` | 布局检查：出画、贴边、占用字幕区、文字重叠 |
| `node engine/tools/snap.mjs --only pNN --sheet name t1 t2 …` | 指定时刻截图并拼成一张图 |
| `node engine/tools/render.mjs [--fps 30] [--workers 4]` | 渲染成片（可选烧录字幕） |
| `node engine/tools/publish.mjs` | 生成各平台发布信息（标题、简介、标签、章节时间码） |

浏览器默认使用本机已安装的 Chrome / Edge（或 `CHROME_PATH`），视频编码使用内置的 ffmpeg（或 `FFMPEG_PATH`）。
