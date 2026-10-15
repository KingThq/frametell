**English** · [简体中文](ARCHITECTURE.zh-CN.md)

# Frametell architecture

Frametell is an open-source product that runs locally. One command starts it and opens a full studio in your browser. The user uploads materials and picks a length and a style. The director agent first drafts a storyboard for the user to approve. Then it writes the narration, voices it, draws each page and checks its own work. Finally it renders a 1080p video, with SRT subtitles and publishing notes. The user never touches code.

```bash
node apps/cli/dist/cli.js serve    # start the local server and open the studio (see the README for setup)
```

## Design principles

- **A finished product, not a developer tool.** Installation, model setup, environment checks and error recovery all happen in the studio.
- **Any model works.** The model layer is built on Pi (`@earendil-works/pi-ai`). It supports OpenAI, Anthropic, Google, DeepSeek, OpenRouter, Vercel AI Gateway, Volcengine Ark and any OpenAI-compatible API. The default recommendation is Claude Opus 5.5.
- **Engineering guardrails, not model discipline.** The orchestrator enforces layout checks, screenshot self-checks and the full-film check, and hands the results to the agent. Weaker models can still produce a film reliably.
- **Local first.** Materials, projects and keys stay on the user's computer. Keys are only sent to the provider the user picked.
- **Every step can be undone.** Each project is a git repository. Every agent change is a commit, so undo is `git revert`.

## Repository layout

```
frametell/
├── packages/
│   ├── engine/    @frametell/engine   video engine (from kit): page runtime, style packs, component library,
│   │                                         rendering (Playwright + ffmpeg), lint / snap / pages tools
│   ├── agent/     @frametell/agent    director agent: built on pi-agent-core; staged orchestration, tools, prompts
│   ├── models/    @frametell/models   model catalog and providers: pi-ai built-ins + Volcengine Ark
│   └── voice/     @frametell/voice    voiceover: Volcengine TTS 2.0, ElevenLabs; alignment of user recordings
└── apps/
    └── studio/    frametell           local server (HTTP + SSE) + web studio + CLI entry point
```

## Runtime

| Part | Choice | Notes |
|---|---|---|
| Runtime | Node ≥ 22.19 | Matches Pi's requirement |
| Local server | Hono + `@hono/node-server` | REST + SSE, single process |
| Studio | React 19 + Vite + Tailwind | Uses the Ink & Paper design language, dark by default |
| Browser | `playwright-core` + system Chrome / Edge | If none is found, install Chromium with one click in the studio |
| Video encoding | `ffmpeg-static` | Users don't need to install ffmpeg themselves |
| Data directory | `~/.frametell/` | `config.json` (0600, holds keys), `projects/<id>/` (each one is a git repository) |

## Production pipeline

```
New project (materials + length + style + voice + model + subtitles on/off)
  → Parse materials (md / txt / pdf / docx / pptx / images)
  → ① Storyboard agent    → storyboard.json            ◆ user approves / edits (in place, in the studio)
  → ② Narration agent     → script.js (continues in the same session)
  → ③ Voiceover           → voice.js + audio/ (real timestamps, or the user records page by page)
  → ④ Page agent × pages  → pages/pNN.js (in parallel, one session per page)
        Each round the orchestrator enforces: lint → screenshot contact sheet → agent looks and fixes (up to 3 rounds)
        Still broken: marked "needs attention", does not block
  → ⑤ Full-film check     → orchestrator runs lint + contact sheet on the whole film; the agent only fixes cross-page issues
  → ⑥ Render              → MP4 1080p (subtitles optionally burned in) + SRT + publishing notes
```

Each stage is a separate agent run. Context stays short, cache hit rates stay high, and a failure only reruns that stage.

## Director agent (packages/agent)

- Built on the `Agent` from `pi-agent-core`. Its event stream (`message_update` / `tool_execution_*`) is turned directly into the studio's SSE events.
- Only the tools the current stage needs are exposed: `read` (including images), `write`, `edit`, `bash` (limited to the project directory), `lint`, `snap` (returns a contact sheet image), `timeline`, `use_component`, `logos`.
- `beforeToolCall` enforces the boundaries: no writing outside the project directory, no changes to the engine, no network access, no running the render.
- After each round of tool calls, changes are committed to git automatically. Session messages are saved to `projects/<id>/.studio/sessions/`, so an interrupted run can resume.
- The page stage needs a model that accepts image input. In the studio, models that can't read images show a "can't self-check pages" warning.

## Models (packages/models)

- All of `pi-ai`'s built-in providers are available. The user enters keys on the settings page.
- **Volcengine Ark**: OpenAI-compatible, added through `createProvider`.
- **Custom**: any OpenAI- or Anthropic-compatible URL.
- Usage and cost: token usage for each request is added up using the model's price table, and the studio shows the project's spend so far in real time.

## Voiceover (packages/voice)

- Volcengine TTS 2.0 (seed-tts-2.0, preset voices). One request per page, which returns real character-level timestamps.
- ElevenLabs (the with-timestamps API), which also outputs subtitle timing.
- User recordings: record page by page with a teleprompter → speech recognition aligns the timestamps → tracks are merged.

## Studio (packages/ui)

- Home: one sentence on what it does + a new-project box (drop in materials, pick length / style / voice / model) + recent projects.
- Workspace: on the left, the chat and the agent's process (thinking summaries, tool steps, stage markers, storyboard approval card). On the right, the workbench (player, page timeline with each page's status, storyboard / narration / materials / export).
- Settings: models and keys, voiceover, environment checks (browser, ffmpeg, disk).
- Preview: project pages play in a sandboxed iframe on a separate origin (`allow-scripts`, with seek / play / pause controlled over postMessage).

## Security

- The local server only listens on `127.0.0.1`. Each launch generates a random token, and the studio uses it to call the API.
- Keys are only stored in the local `config.json` (permissions 0600) and are always masked in logs and events.
- Page code generated by the agent only runs in the sandboxed iframe and the headless browser.
