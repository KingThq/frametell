# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Models: Studio's own provider list — Relay (recommended), Claude, OpenAI, Gemini, Grok, OpenRouter, DeepSeek, Kimi, Zhipu GLM, Qwen, MiniMax, SiliconFlow, Doubao, Hunyuan, Xiaomi MiMo and Ollama — each with its endpoint and where to get a key. Every provider can point at the user's own base URL, and model ids it does not list can be added by hand; the OpenAI-compatible ones (GLM, Qwen, SiliconFlow, Doubao, Hunyuan, Ollama) list their models from `/models`.
- Rebrand to 画说 · Showtell (by Sitor): a new mark (「」 corners, which are both Chinese quotation marks and a viewfinder, around a recording dot), a wordmark that reads 画说 in Chinese and SHOWTELL in English, a new favicon and desktop app name, and a brand handbook in `docs/brand`. The README is now in English and Chinese, with banners for each language in light and dark.
- The interface in Chinese or English. Settings → Language: follow system, 中文 or English. The choice is saved with the other settings and the core, CLI and server use it too for their errors, checks and notes. Dictionaries are in `packages/ui/src/i18n/<locale>/`; Chinese is the source and English is typed against it, so a missing string fails the build.
- Live progress while a response is still being written: the status line says what is being written and how far it has got (「第 1 页 · 在写画面 · 已写 212 行」) with the line it is on, and the page list shows it too. Progress is streamed from the Pi runtime about once a second and never written to the log. Providers that hand a tool call over only when it is whole (Gemini) show the phase instead — 「在想」, then 「在写画面」 once the thinking goes quiet — and check rounds say 「在截图自检」 / 「在看自检截图」.
- Page canvas: each page card offers 「引用」 on hover, to hand that page to the director without opening it.
- Composer: a reference tray above the message. Hand the director exactly what you mean — a page (「改这一页」), a narration line or a frame from the workbench (「引用」), or files and images you attach, paste (⌘V) or drop. References show as chips with thumbnails; image and frame chips open full size; Backspace in an empty box removes the last one; the page you are looking at is offered as a one-click chip.
- Agent: references reach the director as a `<references>` block ahead of the message, with film times and project paths it can open (frames and images with its read tool). Attached documents are parsed to Markdown under `refs/`.
- API: `POST /api/projects/:id/attach` (and the desktop `attach` method) saves a file for a message; `say` takes `refs`.
- Page focus: a strip of full-resolution key frames, one per narration line, linked both ways with the lines and the player — whatever is on screen is highlighted in both.
- Page focus: a lightbox to read any frame or the self-check sheet in detail (click to zoom where you point, drag to pan, wheel zoom, ←/→ to step), and a full-screen button on the player.
- API: `GET /api/projects/:id/frame?t=` (and the desktop `frame` method) cuts a full-resolution 1920×1080 frame from the finished film, cached until the film changes.
- Workbench: drag the divider between the conversation and the stage to resize them, like VS Code; double-click resets, arrow keys nudge, and the width is remembered.
- Settings: dedicated cards for the official Claude (Anthropic) and OpenAI APIs, each with an optional relay base URL.
- Settings: a 「用这个」 button switches the default model to a connected provider in one click; the provider in use is marked.
- Settings: an HTTP proxy for every outbound request — Pi, voices, model lists, and the Claude Code / Codex CLIs. Local addresses always go direct; the proxy password is never shown to the panel.
- Home: the model field shows where a run goes (runtime · endpoint · proxy), links to settings, and blocks a runtime/model mismatch.
- Voice: previews of the built-in Volcengine voices ship with Studio, so listening to a voice never spends TTS credit.
- Workbench: a live line shows what the director is doing while you wait; revisions get a 「修改计划」 chapter and a 修改中 status.
- Workbench: film view with a page lane, a canvas of page cards with their narration, and a focus view for one page.
- Workbench: playable exports with a subtitles on/off toggle; cost, model and token usage in a popover.
- Styles: whiteboard, chalkboard and tech-dark.
- Agent runtimes: Claude Agent SDK and Codex, both API-key only.
- Conversation with the director, runs that resume after the app is closed, optional materials, voice samples.

### Changed

- Every project runs on the Studio Agent (Pi), which works with any provider. The Claude Agent SDK and Codex runtimes are parked: their code stays in `packages/agent`, but Studio no longer offers them. The user's own base URL and hand-added model ids now apply to every provider, through the model catalog.
- A change to the picture of the page(s) it names goes straight to those pages, without a planning step; anything that may touch the narration, or names no page, is still planned first. Every revision ends with where its time went (「这次改了 27 秒：画和自检 24 秒 · 全片检查 3 秒」). On the sample film: a one-page picture change in 27 s.
- An existing page can no longer be rewritten whole: the write tool (and the Claude Agent runtime's Write, through its hook) refuses to overwrite a page of 40+ lines and points the agent to edit; new pages and other files are written as before.
- Pages are fixed with targeted edits: a revised page's agent is handed the current code, and every check round (and the film review) asks for edits instead of rewriting the file. On the sample film a one-page change had spent 5½ of its 7 minutes on three whole-file rewrites of ~10k tokens each.
- Revisions are faster and cheaper. Each change is planned in a fresh, small session that is handed the storyboard, the script and the code of the pages the request names (instead of resuming the session that made the whole film and reading files one round trip at a time), and a revised page gets two check rounds instead of three. On the sample film a one-page change went from about 8 minutes plus a render to under a minute to preview; deciding what to change went from 43 s to 16 s.
- Export renders incrementally. The video is cut into segments that follow the pages, each cached under a key of what draws it (the pages on screen in it with their timing, the episode's settings, the engine); an export renders only the segments whose key changed, each worker drawing its list in one browser. On a 53-second film: a cold export takes as long as before, an export after changing one page renders 6 of 20 segments (video 29.6 s → 9.1 s).
- Film view: a quieter page lane — page names sit beneath the pictures instead of over them, the page on screen is lit with a fine outline while the others rest a step back, the playhead is a thin line inside the current page, and only pages that need a look carry a mark.
- **A finished film is previewed live; mp4 is made only on export.** Making a film or revising one now ends once the pages are drawn and checked — the live player is the film, with its voice. 「导出 mp4」 renders on request (「导出最新版」 once a revision has changed the film); change requests sent during an export wait for it. A revision therefore no longer waits for a full render. The CLI's `run` still ends with an mp4.
- Page focus: key frames come from the exported mp4 when it is current, else straight from the live film in one headless pass, so a revised page shows its new pictures without an export.
- API: `GET /api/projects/:id/frames?t=` (batch) replaces `/frame`; `POST /api/projects/:id/export` starts an export; project summaries carry `stale` when the mp4 is older than the film.
- Composer: rebuilt as a card with the reference tray, an attach button, a drop target and a toolbar, instead of a single line.
- The CLI server keeps its panel token per data directory, so a restart no longer locks out a panel that is already open.
- Page agents receive their component reference and a worked example up front instead of searching the engine.
- The ETA during a revision counts only the pages being redrawn.

### Fixed

- Conversation: every edit reads as what it changes (「修改口播稿」「修改分镜」「修改第 5 页」) — tool summaries now lead with the path before any file content, and older logs whose path was cut off are recognised from the text they change; repeats read 「2 次」 instead of 「×2」.
- The finished-film card times the latest round (a revision counts from the change request), not the whole life of the project.
- Page focus: opening a page no longer flashes the start of the film — the player boots on that page, with the page's picture standing in until it is ready.
- Page focus: narration times are positions in the film, matching the frames and the player, instead of offsets within the page; the time column is no longer clipped and the stray scrollbar corner is gone.
- Codex talks to gateways over HTTP only, instead of failing five WebSocket attempts per turn.
- Turning a page in the focus view seeks the film instead of reloading the player.
- Renders no longer stall when the browser hangs on close.
- Electron no longer wraps main-process errors in its own text before they reach the panel.

[Unreleased]: https://github.com/sitor-ai/frametell/commits/main
