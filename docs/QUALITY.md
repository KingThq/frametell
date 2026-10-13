# Quality system

The first-priority users are **knowledge creators**: people who explain investing, psychology, history, science, books or technology. What they want is a video that explains clearly, is pleasant to watch and is ready to publish.

Quality does not come from ever-longer prompts but from four parts: **standards + benchmarks + gates + evaluation**.

- Standards tell the agent how to work;
- benchmarks show it what good looks like;
- gates use machines to stop known bad films;
- evaluation gives every change numbers to compare, instead of a feeling.

Some of the methods are borrowed from [huashu-art-motion](https://github.com/alchaincyf/huashu-art-motion) (MIT). Its thresholds were calibrated on 15-second art shorts, while we make 1–10 minute explainers: **we take only the methods, and recalibrate every number on our own films**.

## 1. Storyboard: the layer with the most leverage

If the storyboard is wrong, however well the pages are drawn the result is a slide deck. The storyboard moves from "one description per page" to "a string of **beats** per page":

```json
{
  "style": "warm-story",
  "palette": "warm-story/default",
  "cast": "none | hands | silhouette",
  "pages": [{
    "id": "p03", "section": "Compounding: time matters more than principal",
    "say": "What this page is about (2–3 sentences)",
    "beats": [
      { "at": "c0", "object": "a snowball", "action": "rolls down from the top of the slope, growing as it goes", "camera": "tracking", "text": "" },
      { "at": "c2:thirty", "object": "the snowball", "action": "hits the tree at the foot of the hill and stops", "camera": "slam in", "text": "30 years ×17" }
    ]
  }]
}
```

`at` can land on a sentence (`c2`) or on a word (`c2:thirty`, placed by the narration's per-character timestamps).

**Storyboard lint** (deterministic, costs no tokens; when it fails the agent fixes it itself, at most 2 rounds, so the storyboard the user sees has already passed):

| Rule | Level |
|---|---|
| `object` must be a concrete thing, not a layout word such as "title, key points, card, background, icon, text" | Red |
| `action` must be a real action, not a catch-all such as "appears, shows, fades in, lists one by one" | Red |
| Each on-screen text element ≤ 8 characters | Red |
| The first and last pages must not be text-led; the ending lands on an action of the main object, not on a centred quote card | Red |
| Text-led beats ≤ 30% | Red |
| Every number shown on screen must be findable in the material or the narration ("sixty percent" = 60%) | Red |
| At least one beat every ≤ 6 seconds on each page (explainer pace; to be finalised after calibration) | Yellow |
| Three consecutive beats with the same camera | Yellow |
| Characters: with no usable illustration material, never draw faces; show only hands, backs or silhouettes, or let an object be the protagonist | Red |

The default structure for a knowledge narrative: **hook** (a counter-intuitive fact or question) → **intuition** → **mechanism** → **example and numbers** → **close on an action**.

## 2. Pages: components first, style packs as the safety net

A **style pack** is a folder containing:
- tokens (palette, fonts, strokes, ground texture);
- component skins;
- a motion grammar (camera presets, transitions, pacing);
- a **grammar card** that says what the style does and never does;
- a **benchmark project**: a demonstration film of about 2 minutes. It is both the agent's example and a regression test.

The first five: quiet study, whiteboard, chalkboard, dark technical and **warm narrative illustration** (the "investing 101" kind).

**Page lint** (run by the orchestrator every time; the results go straight to the agent):
- Already in place: off-canvas, touching the edge, sitting in the subtitle band, overlapping text, **small text (rendered < 24px)**.
- New:
  - **empty frame**: a box has been drawn but its text not yet written;
  - **text-led area**: text takes up too much of the frame;
  - **fullness**: the main elements don't fill the content area;
  - **text cut during camera moves**: denser sampling while the camera moves;
  - **determinism**: render the same moment twice and compare pixel by pixel.

**Camera presets** (pulse-style: hold, move fast, hold): quick push 0.28s, pan 0.30s, slam in 0.17s (1.55 → 0.94 → 1.0), shake ≤ 2 times per film. No slow constant push by default.

**Word-level sync**: the narration returns per-character timestamps, so a number counts up and settles exactly as it is spoken.

**Screenshot self-check**: each round, the orchestrator runs lint and makes the contact sheet; given "the issue list + the contact sheet", the agent fixes only the specific problems. If problems remain after 3 rounds, the page is marked "needs attention" and the run is not blocked.

## 3. Film gates

Reads only the mp4, implemented in Node + ffmpeg, so users don't need Python.

- **Gates** (a red light automatically finds the worst page and fixes it once; if it is still red after that, the quality report tells the user, never letting it pass silently):
  - blank frames mid-film (judged by edges, not by colour);
  - share of fast-motion frames (a measure of slide-deck feel; threshold to be calibrated).
- **Reported, never blocking**: text-led duration, similar layouts on adjacent pages, the longest gap without an event. Stillness metrics are never gates, because a good film that "holds, moves hard, holds" would be judged the wrong way round.

Only a single metric that cleanly separates the "approved" and "rejected" groups of films may become a gate.

## 4. Evaluation and feeding lessons back

- **Evaluation set**: 6 pieces of material (investing, psychology, history, science, books, technology) × 2 styles. After changing prompts, the engine or a style pack, run it first with a cheap model, then spot-check with Opus.
- **Scoring**: gate results + a visual review (a fixed scoring sheet) + periodic blind picks by the author.
- **Calibration set**: films the author has judged (approved / rejected), used to set gate thresholds; recalibrate whenever new judgements come in.
- **Lessons** `docs/quality/lessons.md`: each entry is written as "practice + evidence + why + when to use it", not just a conclusion.
- **The checking tools are checked too**: every check is made to fail on purpose once, to confirm it really goes red.
- **Transfer tests**: send an agent that has read only the docs to do a topic the docs don't cover, and have it report "what helped and where it got stuck".

## 5. Warm narrative illustration (the "investing 101" kind)

The pictures explain through warm, flat illustrations: one metaphor object runs through the whole film (a snowball, a balance, a piggy bank, a sapling, a mountain road), actions are slow and weighty, and numbers land on the object instead of on separate text cards.

Illustrations come from two layers:
- **Default: a library of illustration components drawn in code.** Free, stable and animatable, including common metaphor objects such as a snowball, a balance, a stack of coins, trees, houses, a curved hill and a calendar.
- **Optional: illustration assets from an image model.** Through the image API of the provider the user chooses. The style prompt is locked, the background removed, and the agent then lays them out and animates them.

Measure sample films before writing the grammar: take a few original episodes and measure, frame by frame, the average shot length, share of motion and palette, then write this style's grammar card.
