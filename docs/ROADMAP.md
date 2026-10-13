**English** · [简体中文](ROADMAP.zh-CN.md)

# Roadmap

We go one step at a time, and each step can be verified on its own. Finished items are checked. Unfinished items say what's still missing.

## M1 · Engine (packages/engine)
- [x] Move the runtime, templates and tools over from kit; remove personal content (course workflow, personal voices, private paths)
- [x] Rendering switched to `playwright-core` + system browser detection + `ffmpeg-static`
- [x] lint adds a font size check (body text < 28px is an error) and an empty box check
- [x] Component library `lib/` no longer tied to courses: components are named after what they draw, data comes from the page, names don't overwrite each other, and the index is in `packages/agent/prompts/LIB.md`
- [x] Regression: reference projects for each style (storyboard-lint + lint + deterministic double render) and a component sample gallery `test/gallery` (all components loaded together, no runtime errors)
- [x] Page isolation: a page that errors only shows a placeholder, and the error, with its code location, goes to the page agent to fix
- [x] Incremental export: segments are cached per page, so changing one page only re-renders the affected segments

## M1.5 · Quality system (see QUALITY.md)
- [x] Storyboard switched to a beat structure + storyboard lint (layout words, catch-all verbs, on-screen text, first and last pages, number sourcing, pacing)
- [x] Page lint completed: empty boxes, text-dominated area, frame fullness, push/pull and cut text, deterministic double render
- [x] Final-film gate (Node + ffmpeg): blank frames are a gate; motion metrics are reported only (no calibration set yet)
- [x] Camera presets (quick push / pan / slam-in / shake) and word-level sync to beats
- [x] Warm narrative illustration: grammar card → illustration component library → reference project (compound interest, 61 seconds)
- [x] Whiteboard, chalkboard, tech dark: grammar card + reference project
- [ ] Quiet study (the default style): still missing a grammar card and a reference project
- [ ] Eval set and lessons library: numbers to compare before and after prompt changes; record the pitfalls the agent has hit
- [ ] When a page is still broken after two rounds of fixes, fall back to a stronger model

## M2 · Agent and models (packages/agent, packages/models, packages/voice)
- [x] Model catalog: 15 providers + custom model ids + custom OpenAI- / Anthropic-compatible endpoints + proxy
- [x] Director agent (built on Pi): storyboard → narration → pages (up to 10 in parallel) → full-film check, with the orchestrator enforcing lint / screenshots
- [x] Edits are incremental: only the pages you point at change, the preview updates instantly, and the mp4 is only produced on export
- [x] Voiceover: Volcengine TTS 2.0 (with built-in preview)
- [ ] Voiceover: ElevenLabs is integrated but hasn't yet run a full film with a real key
- [x] Headless run works end to end: `frametell run <materials>` produces a video
- Claude Agent SDK and Codex runtimes: code kept, not enabled for now

## M3 · Studio (packages/ui, apps/cli, apps/desktop)
- [x] Local server: projects, material upload and parsing, SSE event stream, resume from where a run stopped
- [x] Home, workspace (chat + film / pages / single-page focus), storyboard approval, export (show in Finder / copy path)
- [x] Settings: models and keys, voiceover, general (language), network proxy, local environment
- [x] Chinese and English interface
- [x] Desktop app (Electron, dev mode)
- [ ] Desktop packaging: .app / .dmg, signing and notarization, auto-update

## M4 · Release
- [ ] `npx frametell`: install and launch with one command
- [ ] Add a sample film to the README
- [ ] Tag version 0.1.0 and make the repo public (MIT)

## M5 · Canvas (phase two)
- [x] Keyframes for each narration line, linked both ways with the player and the narration
- [x] Reference a specific page / line / frame so the director changes only that part
- [ ] Change one narration line and re-voice only that line
- [ ] Circle an area on a page and have the agent change it
