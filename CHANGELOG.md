# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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

- The CLI server keeps its panel token per data directory, so a restart no longer locks out a panel that is already open.
- Page agents receive their component reference and a worked example up front instead of searching the engine.
- The ETA during a revision counts only the pages being redrawn.

### Fixed

- Page focus: narration times are positions in the film, matching the frames and the player, instead of offsets within the page; the time column is no longer clipped and the stray scrollbar corner is gone.
- Codex talks to gateways over HTTP only, instead of failing five WebSocket attempts per turn.
- Turning a page in the focus view seeks the film instead of reloading the player.
- Renders no longer stall when the browser hangs on close.
- Electron no longer wraps main-process errors in its own text before they reach the panel.

[Unreleased]: https://github.com/sitor-ai/frametell/commits/main
