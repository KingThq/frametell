# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.2] - 2026-10-12

### Fixed

- The preview keeps its place while the film is being made. A page that changed (drawn, checked, redrawn) used to reload the preview: it flashed and went back to the start. Now the new version loads behind the one on screen, at the moment you were watching, and takes its place once it is drawn; while the preview plays, it waits until you pause.
- The preview's play hint and button tips are in the film's language. A Chinese film showed "Click the picture or press Space to play" in English.
- Play on the "Your video is ready" card plays the film. Without an up-to-date mp4, the film is the live preview, and both Play buttons only switched to it without starting it.
- A page check's findings are a warning, not an error, and read in the panel's language. A page drawn with a finding was marked in red, with the finding in English ("text-dominated page: …"); it is now amber, and a Chinese panel says it in Chinese.

## [0.2.1] - 2026-10-12

### Added

- A film can draw its pages with another model than its director's. The director (storyboard, narration, planning a change) and the pages (drawing them, checking the whole film) each have a model in the new-film form, remembered for the next film; the pages are most of a film's tokens, so a faster, cheaper model there saves the most. Unset, the pages use the director's; the page model must be able to see images, and each turn is priced at the model that took it.
- My voices: any Volcengine voice by its id (the 1.0 and 2.0 libraries, and cloned voices), pasted at the foot of a voice list or added in Settings. Adding one speaks a sample with it, so a wrong id or a voice the account hasn't enabled is said right there. 1.0 voices get word timings too. The built-in list is 18 explainer voices of TTS 2.0, with samples.
- A film's voice can be switched from the composer: pick another under This film and send; the whole film is narrated again in that voice and nothing is redrawn (going back to a voice you had costs nothing).
- A Volcengine key can also be an older app's `AppID:Access Token`.
- The model picker lists providers on the left and their models on the right; search spans every provider, and arrow keys and Tab move between them.
- `studio.resumeInterrupted()` continues the runs and exports a restart cut short, for a hosted service that restarts on every deploy. The desktop app and the CLI still leave it to you: the film shows as paused, with Continue.
- `new Studio({ review: 'defects' })` runs the whole-film check only for what breaks a film (a frame that flickers, page code that fails), once and briefly. The default is unchanged.
- The engine can split an export across machines (`render.mjs --plan` / `--segments`); a run that finds every segment already drawn only joins them and adds the sound.

### Fixed

- A change to a finished film that never reached the page is no longer shown as done. When the page model's edits didn't land (or it only said it had made the change), the page passed its checks and showed "done", and the preview and the export kept the old picture. Now a page whose code is unchanged is asked once more, every check round restates the change, and if it still didn't land the page is marked for you to look at and the director says which page was not changed.
- Continue answers at once. A paused film shows that it is getting ready the moment you continue, instead of staying paused until its next step began: getting ready fetched the model list of every provider with a key (12 seconds was seen, and a provider that hung held the film back with no end), so Continue seemed to do nothing until you left and came back. Now only the film's own providers' lists are fetched, and they get 15 seconds.
- Relay is reached at relay.example.com.
- Exports on a small machine no longer run out of memory adding subtitles: they are added to two segments at a time, not all at once.
- Pause stops the film whenever you press it. Pressed while an agent was between two requests (checking a page, taking screenshots), it used to be missed, and the film went on for minutes.

## [0.2.0] - 2026-10-11

### Added

- A film can have no voice. The voice picker leads with "No voice"; it is the default when no voice service is connected, so a film can be made without one. The director then writes the storyboard so the picture tells the story on its own (key words and numbers on screen) and the narration as captions that read well alone. Subtitles stay your choice: a film can be just animation.
- With a Volcengine voice, the narration has a tone on every page (curious in the hook, slower and firmer on a key page, calm at the close), and its own on the rare line that turns: a question to the viewer, a punchline, a quote.
- The panel can run hosted: a `studioBridge` that sets `hosted` (Frametell Cloud) gets the account and a sign-out in the top bar instead of Settings, no model picker (the service chooses), and only the voices the service can speak with. Home also takes `?topic=` to start with an idea typed elsewhere.

### Changed

- English films no longer offer Volcengine's voices, which speak only Chinese. Since a film's language follows the panel's, the English panel doesn't show them by default, and its Settings list ElevenLabs first.

## [0.1.2] - 2026-10-11

### Changed

- Films are made faster. Pages are drafted at medium thinking (a draft took 37–74 s instead of 170–220 s, and the pages were no worse); the director writes the storyboard from what it is given instead of browsing the engine first (the first storyboard came in about 50 s instead of 100 s); a check round's fixes go out in one reply and end the round, instead of two or three more model turns; and `frametell run` draws up to ten pages at once, like the studio.
- The director's prompts, the style cards, the engine's tools and the docs are in English. Films are still made in Chinese or English, and every stage names the film's language. Reports, notes and failures follow the language of your latest message, or the interface's.
- Material parsed from PDF and PowerPoint follows the film's language too: page and notes labels are in Chinese for a Chinese film, "Page N" and "Notes:" for an English one.

### Added

- `new Studio({ renderer })` hands exports to another renderer, such as a render service, instead of rendering in the same process.
- Releases are built by GitHub Actions from a version tag: the macOS app and its dmg are signed with the Developer ID, notarized and checked, and wait in a draft release.

### Fixed

- Pages kept their fonts, and exports worked, when the engine was installed as a pnpm dependency; it used to look for its modules in the wrong folder.
- The engine's tests no longer leave a link inside the package that points at its own parent folder. A tool that followed links could walk it forever (one scan grew to 43 GB).
- The storyboard stage asks again when a model turn ends without a storyboard.

## [0.1.1] - 2026-10-11

### Fixed

- The macOS app opens after it is downloaded. It was left with a signature that no longer matched the app, and Apple silicon Macs called it damaged with no way to open it. It is now signed with Sitor's Developer ID and notarized by Apple, so it opens like any other app. A build made without a Developer ID certificate is signed ad hoc instead, and macOS asks once before opening it.

## [0.1.0] - 2026-10-11

The first release of Frametell: a local, open-source studio that turns an idea or your material into an explainer video. A director agent drafts a storyboard for you to approve, then writes the narration, voices it, draws every page in a chosen style, checks its own work, and renders a 1080p film with subtitles.

### Added

#### Making a film

- Start from one sentence or from material: PDF, Word, PowerPoint, EPUB, Markdown and images, parsed to Markdown beforehand (headings, lists, tables, pictures, slide notes).
- A storyboard of pages and beats (a concrete object, what it does, the camera, the text on screen) that you approve or change before anything is drawn. It is checked before you see it: layout words instead of things, catch-all verbs, too much text on screen, an opening or ending carried by text, and numbers on screen that the material does not contain.
- Narration written for the voice, voiced with word-level timing, and animations cued to the words they belong to.
- Pages drawn up to 10 at once. Each page checks itself against lint (out of frame, the subtitle band, overlapping or too-small text, empty boxes, text-heavy or sparse pages, frames that differ depending on playback, LaTeX left in plain text) and against screenshots of itself, with up to three rounds to fix what it finds. A final pass then reviews the whole film.
- A page whose code breaks shows its name in place while the rest of the film plays. The error, with the line it came from, goes back to that page's agent, and an export refuses a film with a broken page.
- The film is previewed live as soon as its pages are drawn. An mp4 is rendered only when you export, and incrementally: after a one-page change, only the segments that page appears in are rendered again.
- Changes by conversation: a request that names pages goes straight to them, and anything that may touch the narration is planned first. Pages are fixed with edits, not rewrites, and every revision says where its time went (a one-page picture change takes about half a minute).
- Hand the director exactly what you mean: a page, a narration line, a frame, or files and images you attach, paste or drop. They show as chips above the message.
- Runs pick up where they stopped after the app is closed. Cost, model and token use are shown for every film.

#### Languages

- Films in Chinese or English. Home asks for the film's language (the panel's by default). The director writes the storyboard, narration and on-screen text in it and talks to you in the panel's language; English storyboards are checked in English, and English text wraps between words.
- The interface in Chinese or English, following the system or chosen in Settings; the core, CLI and server messages follow it too.

#### Styles and engine

- Five styles, each with a grammar card and a benchmark film used as a regression test: warm illustration (`warm-story`), quiet study (`study`), chalkboard, whiteboard and tech-dark.
- An engine where every page is a function of time: shapes, text, charts, KaTeX, three.js scenes, camera presets (quick push, pan, slam, shake), brand logos from simple-icons, and a component library of 28 files (gauges, timelines, flows, sequence diagrams, 3D stacks, file trees, rankings and more) that take their data from the page. A gallery project draws every component and is a test.
- A film check on the rendered mp4 that blocks blank frames and reports motion.

#### Models and voices

- Any model: Claude, OpenAI, Gemini, Grok, OpenRouter, DeepSeek, Kimi, Zhipu GLM, Qwen, MiniMax, SiliconFlow, Doubao, Hunyuan, Xiaomi MiMo and Ollama, each with its own base URL if you have one. Models a provider does not list can be typed in, and your own OpenAI- or Anthropic-compatible endpoints can be added. An optional HTTP proxy applies to every request.
- Voices from Volcengine TTS (Chinese) and ElevenLabs (English and more). Every voice can be heard before you choose it, and the built-in Volcengine previews ship with Frametell, so listening costs nothing.
- Keys stay on your computer, in a settings file only you can read, and the panel only ever sees them masked.

#### Workbench

- A conversation with the director beside the stage, with a live line saying what is being written and how far it has got.
- A film view with a page lane, a canvas of every page with its narration, and a focus view for one page: key frames linked both ways with its narration lines and the player, a lightbox to read any frame or self-check sheet in detail.
- Settings in one dialog: model providers with their marks, voices, general settings, the network proxy and a check of this computer (Chrome, ffmpeg, git).
- Exports with and without burned-in subtitles. In the desktop app, Show in Finder reveals the file; in a browser, its path can be copied.

#### Apps and API

- A desktop app for macOS (Apple silicon), built with `pnpm package:desktop`. It contains the engine and a redistributable GPLv3 ffmpeg, and needs neither Node nor anything else installed except Chrome.
- A command line: `frametell` opens the studio in your browser; `frametell run <material…> [--style] [--duration] [--model] [--lang]` makes a film straight through.
- A Linux render image (`docker/render.Dockerfile`): draws a finished project to mp4 with no desktop, GPU or Mac — Debian's Chromium and ffmpeg, Noto CJK and emoji fonts, the engine with its own modules. `docker run … frametell-render /project --fps 30 --workers 4`. Tried on the Pomodoro technique film (54.5 s, warm-story): frames identical to the Mac export; 75 s on 4 cores, 123 s on 2.
- One core behind every client (`@frametell/core`), with an HTTP + SSE server in the CLI and IPC in the desktop app. A `Studio` can take its own data directory and settings store, and keeps its data in `~/.frametell` (or `FRAMETELL_HOME`) by default.
- Open-source groundwork: MIT licence, CI on Linux, macOS and Windows, contributing and security guides, issue forms and a pull request checklist, READMEs and docs in English and Chinese.

### Known limitations

- The desktop app is not signed with a Developer ID or notarized (fixed in 0.1.1). Only an Apple-silicon macOS build is provided; Windows is not packaged yet.
- Chrome, Edge or Chromium must be installed; Frametell draws and renders with it.
- Undoing a change uses git; without it a film is still made, but its versions are not kept.
- The npm packages are not published yet; install from source (see the README).
- The Claude Agent SDK and Codex runtimes are in the code but not offered; every film runs on the built-in agent, which works with any provider.

[Unreleased]: https://github.com/sitor-ai/frametell/compare/v0.2.2...HEAD
[0.2.2]: https://github.com/sitor-ai/frametell/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/sitor-ai/frametell/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/sitor-ai/frametell/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/sitor-ai/frametell/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/sitor-ai/frametell/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/sitor-ai/frametell/releases/tag/v0.1.0
