# Contributing to Frametell

Thanks for helping. Bug reports, ideas, new styles and pull requests are all welcome.

## Before you start

- **Found a bug?** Open an [issue](../../issues/new/choose) and include the steps to reproduce it. If the bug shows up in a film, include the project's log too. For security problems, see [SECURITY.md](SECURITY.md) and don't open a public issue.
- **Planning a larger change?** Open an issue first so we can agree on the approach before you write the code.
- **Just want to chat?** Join us on [Discord](https://discord.gg/GKz3McPPXx).

## Development setup

You need Node.js 22.19 or later, pnpm 10, and Chrome, Edge or Chromium installed. FFmpeg is bundled.

```bash
git clone https://github.com/sitor-ai/frametell.git && cd frametell
pnpm install
pnpm build

# start the studio in your browser
node apps/cli/dist/cli.js serve
```

To make a film you need a key for a model provider and, for voiceover, a Volcengine TTS or ElevenLabs key. You can add them under Settings in the studio, or set them as environment variables (see the README).

Your projects, settings and keys are stored in `~/.frametell`. Nothing in that directory belongs in the repository.

## The codebase

| Package | What it does |
|---|---|
| `apps/cli` | The `frametell` command and the local HTTP server for the studio |
| `apps/desktop` | The Electron desktop app |
| `packages/ui` | The studio interface (React, Vite, Tailwind) |
| `packages/core` | Projects, settings, runs and exports |
| `packages/agent` | The director agent and its prompts |
| `packages/engine` | The video engine: styles, components, checks and rendering |
| `packages/models` | The model provider catalog |
| `packages/voice` | Text-to-speech providers and voices |

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) explains how the pieces fit together.

## Before you open a pull request

```bash
pnpm build
pnpm typecheck
pnpm test
```

CI runs the same three commands on every pull request.

- **Keep each pull request to one change.** Small pull requests get reviewed faster.
- **Write the code like the code around it.** Match its naming, comment density and idioms.
- **Interface text goes in both languages.** Strings live in `packages/ui/src/i18n/<locale>/`. Chinese is the source and English is typed against it, so a string missing from either one fails the build.
- **Add a line to [CHANGELOG.md](CHANGELOG.md)** under `[Unreleased]` for anything a user would notice. Describe what changed for them, not how you changed it.
- **Commit messages** follow [Conventional Commits](https://www.conventionalcommits.org/), with the package as the scope, for example `fix(engine): …` or `feat(ui): …`.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
