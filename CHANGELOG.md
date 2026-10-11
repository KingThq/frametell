# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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

- A revised page is changed with targeted edits: the page agent is handed the current code and told not to rewrite the file (a one-line change had taken a 10k-token, three-minute rewrite).
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
