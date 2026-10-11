# Ready-made components (engine/lib/)

When you need one, run `node engine/tools/use-extra.mjs <file name>` to copy it into this project and register it (safe in parallel), then Read that file for its usage. If you don't need one, don't use it; drawing by hand is fine. Each file works on its own and they combine freely without name clashes. All data (labels, colours, values) is passed in by the page; no component hard-codes a subject.

The general helpers `P.move(L, fn)` (drive a layer), `P.pathAt(d)` (points along a path), `PV.keys` (keyframes), `PV.mix` (colour mix), `PV.arcAt` (a point on an arc), `PV.mmss` and `PV.tw` (estimated text width) are in the engine: use them directly, no registering.

| File | Components |
|---|---|
| `warm.js` | Metaphor objects for warm illustrated stories: `ground` the ground / `snowball` a snowball that grows / `jar` a glass jar of coins (fill level) / `coin` a coin (can drop) / `tree` a tree that grows and bears fruit / `trail` a mountain path (unrolls, with a walking point) / `hand` a hand, no face / `calendar` a desk calendar / `tag` a number label written on an object (can count up to the spoken word) |
| `gauges.js` | tank a tank that overflows / gauge a semicircular dial / loopRing nodes on a ring + a running dot / stampF a stamp with its backing paper |
| `meters.js` | hist a time histogram with a capacity line / meter a vertical level / clock a stopwatch |
| `switches.js` | breaker a switch that trips / hbar a horizontal bar with a threshold / mtag a monospace label / loopTrack an elliptical loop + stage boxes / door an exit that lights up |
| `waffle.js` | waffle a grid of little figures (proportions) |
| `cells.js` | cells cells that fill in reading order / win a window of cells with a title and a count / place3d one-layer 3D placement / PV.fmt, PV.fmtK number formatting |
| `messages.js` | msgcol a message column (rows shorten, drop, relabel) / flip2 a two-sided 3D flip card / cellgrid squares that fill in order |
| `radar.js` | radar(cx, cy, r, axes, vals) a radar chart / msgs a stack of messages (can collapse into one card) |
| `segments.js` | strip one segmented band (segment widths change over time; can mark kept and redone segments) |
| `terminal.js` | term a terminal / gantt a Gantt chart + playhead / flow packets flowing along a polyline |
| `fsm.js` | fsm a state machine + cursor / plot a line chart drawn over time |
| `gates.js` | stageDots(steps, cur) stage dots / gates3d a 3D receding gateway / pkt a packet that follows a function |
| `pipeline.js` | pipeline packets flow through a column of steps; the output flies into a results panel |
| `flowgraph.js` | graph a node graph + run() a moving state packet / switcher a railway switch / packet an envelope packet / ckstack a 3D stack of cards / PV.hlx, PV.colX code-card column positions |
| `sequence.js` | seq a two-party sequence diagram + flying messages / jsonPanel JSON that types itself in / fold3d a card that folds down into a label / stack3d 3D stacked boards |
| `matrix.js` | matrix a rows × columns grid collapsing into a hub (N×M → N+M) / tape a scrolling one-line message log / editor an editor window / flipc a two-sided flip card / stage3d a 3D receding stage / PV.bytes |
| `dialog.js` | dlg a confirm dialog with two buttons / lock a lock that opens / plates3d coarse-to-fine sieve plates |
| `receipt.js` | receipt a receipt printing line by line / zipper a zipper comparing two columns line by line |
| `filetree.js` | filetree(x, y, rows) a directory tree / ftile a small file card / fly a label flying along an arc |
| `notes.js` | memfile a file card written line by line / mcard a dog-eared note / markLines highlight by rendered line / PV.age colours that age from new to old |
| `layers.js` | netgraph a node network that grows over time / layers3d 3D stacked boards (with a proj screen projection) / fcard a document card you can append to, strike through and highlight / flip a two-sided flip card |
| `tower.js` | tower3d a 3D stacked tower (proj to pin labels) / flipcard a label card that flips / memcard a dog-eared file card (optionally labelled) |
| `pointcloud.js` | space3d a 3D point cloud / chunkText text coloured in chunks / lanes stations on two swim lanes + arrows |
| `ranking.js` | rankList a ranking that reorders smoothly / PV.softPos, PV.orderPos rank positions / tower stacked blocks / PV.proj2d project 2D points into a box |
| `scorecard.js` | scoretubes(x, y, items) score tubes / ruler(x, y, w, items) a colour-banded ruler / badge(x, y, name) logo + name / PV.rise |
| `bookshelf.js` | shelf a 3D bookshelf (spine widths and heights from data; one book can be pulled out) |
| `bots.js` | bot a robot with a name tag / env an envelope flying along an arc / jfile a file card that appends lines / timer a clock + readout |
| `debris.js` | demo a small "illustration" tag / fall falling debris / srv a server box / PV.blink a blinking status light |

## Known engine pitfalls
- `PV.ease` has no `in`; write an accelerating curve by hand as `u*u`.
- `P.line` does not support dashed (only arrows do); the handle `P.line` returns can `.hide()`.
- `code().hl` positions by character column; in JetBrains Mono a character is about 0.6× the font size. If a highlight is off, check it against a screenshot.
- `P.follow` has no left-align option; set `el.style.textAlign` by hand when needed.
- `P.slider` tick labels are fixed at 26px.
- Spaces produced by `text()` are `&nbsp;`; replace ` ` with a space before locating English words for `markSpan`.
- The code-card highlighter treats `//` inside a string (as in `https://`) as a comment; when needed, put a zero-width space between the slashes.
- Hiding a back face with `visibility:hidden` does not work for CSS 3D flips (every stroke carries visibility:visible); use opacity.
- The first frame of a contact sheet is occasionally captured before fonts load and misses content; take that shot again on its own.
- `P.code`'s `label` option is documented in a comment but not implemented.
- After `P.cam` pulls out, the page title is dimmed by the header gradient; when pushing in, take care not to cut text.
