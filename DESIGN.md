# Frametell · Design system

Follows **Ink & Paper**: warm paper, ink text and a single caramel accent; the quality comes from type and detail, not neon, glass or gradients. Studio is dark by default (the dark set) and can switch to light.

## Scene

Evening. A knowledge creator sits at the computer, hands a video to the director agent, glances at the progress now and then and signs off at the storyboard. The room is dark; the brightest thing on screen is the video (warm illustrations are themselves light paper), and the interface is a quiet ring of ink around it.

## Tokens (`web/src/styles/tokens.css`, RGB triplets so Tailwind can add opacity)

| Token | Dark (default) | Light | Use |
|---|---|---|---|
| `paper` | `#0C0A09` | `#F5F5F0` | Page background |
| `paper-2` | `#141210` | `#EFECE4` | Recessed panels (left column) |
| `surface` | `#181513` | `#FFFFFF` | Cards, inputs |
| `surface-2` | `#1F1C19` | `#FAF8F3` | Hover, selected |
| `ink` / `ink-2` / `ink-3` | `#F5F5F4` / `#B0A9A3` / `#8F8780` | `#1C1917` / `#57534E` / `#7A736C` | Primary / secondary / faint text |
| `line` / `line-2` | `#292522` / `#3D3834` | `#E7E5E2` / `#D6D3CF` | Hairlines / hover lines |
| `accent` | `#E0B88A` | `#D4A574` | Caramel: the primary action, the current item, what the agent is doing now |
| `accent-ink` | `#E4C096` | `#9C6A3A` | Caramel text |
| `jade` | `#6FBF8E` | `#3E8E5E` | Passed, done |
| `seal` | `#E2765E` | `#C0442B` | Errors, needs attention; use sparingly |

Never hard-code colour values, and never write paired classes like `bg-white dark:bg-…`: the tokens already switch with the theme.

## Type

- Interface: `Inter` + `PingFang SC` (the system Chinese fallback); body 14px, secondary 12–13px.
- Brand: `Playfair Display` italic, only for the Studio wordmark and the one-line headline on the home screen.
- Numbers (cost, duration, tokens): `JetBrains Mono` + `tabular-nums`.

## Layout

- Top bar 52px: the mark + the "Studio" wordmark, project title, status, spent so far, model, export.
- Workspace: a left column with the conversation and the agent's process (400–440px, collapsible), and on the right the workbench (16:9 player centred + the page timeline strip + storyboard / narration / export).
- 4px spacing base; card radius 16px, controls 10px, tags 6px. Hairlines plus very faint shadows.

## Motion

- Feedback 120–150ms, state changes 200–250ms, panels in and out 320ms; easing `cubic-bezier(.16,1,.3,1)`, no bounce.
- **The signature motion**: the page timeline strip. Each page goes from a dashed frame (queued) → a caramel stroke tracing round its border (being drawn) → its thumbnail fading in (done). It maps directly to what the agent is doing and is the only motion in the interface designed for emphasis.
- New messages in the conversation rise 6px and fade in; with `prefers-reduced-motion`, only the fade remains.

## Rules

- One primary action per area; caramel goes only to the single most important thing right now.
- State is never shown by colour alone: pair it with text or an icon.
- No modals for storyboard sign-off or errors: handle them in place, in the conversation.
- Settings is a centred modal: categories on the left (a registry: adding a kind of setting adds one entry), a list in the middle when needed (providers, voices), details on the right. Providers always use their official marks (`assets/providers`).
- No native `<select>`: choices use custom pop-up lists (`ModelPicker`, `VoicePicker`): 44px-tall fields, a caramel focus ring, a layered shadow on the pop-over, groups with logos, search, and a complete keyboard path.
