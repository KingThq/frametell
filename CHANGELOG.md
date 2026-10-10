# Changelog

Every change lands as its own commit; this file records them, newest first.

## Unreleased

- **server**: the panel token is kept per data dir (`server-token`, 0600), so restarting the server no longer locks out a panel that is already open.
- `30a1aba` **settings**: Claude (Anthropic) and OpenAI official cards with an optional relay base URL each; 「用这个」 switches the default model to a provider in one click and marks the one in use; an HTTP proxy for every outbound request (Pi, voices, model lists, and the Claude Code / Codex CLIs); Home shows where a run goes (runtime · endpoint · proxy) and blocks a runtime/model mismatch; previews of the built-in Volcengine voices ship with Studio, so listening never spends TTS credit.
- `93eb154` **agent**: Codex talks to gateways over HTTP only (no WebSocket attempts that failed five times per turn).
- `4730d2b` **ui**: a live line shows what the director is doing while you wait; revisions get a 「修改计划」 chapter and a 修改中 status; the ETA counts only the pages being redrawn.
- `ccbc468` **ui**: the workbench is about pages and their words — film view with a page lane, a canvas of page cards with narration, a focus view with one persistent player (turning a page seeks), cost in a popover, playable exports.
- `1f0baff` **engine**: renders no longer stall on a hung browser close; plainer conversation text.
- `105a999` **styles**: whiteboard, chalkboard and tech-dark; page agents get their reference pack up front.
- `3eb551a` **studio**: talk to the director, resumable runs, optional materials, voice samples.
