---
name: verify
description: Use when checking a user-visible change in a real browser by running the playground for the change and its base under identical conditions, comparing frames and measured signals, and reporting what is proven, what is pre-existing, and what could not be verified.
---

# Verification Workflow

Source inspection and unit tests do not prove what a user sees. Verify a UI change by running it beside its base in the playground and treating every difference as a candidate regression until a frame or a measurement explains it.

1. Serve head and base side by side.
   - The base is the commit the change branched from. Check each build out in its own worktree and serve it on its own port with `bun playground/index.html --port=<port>`.
   - `bun dev` runs with `--hot`, which keeps stale modules after a branch switch or rebase. Restart the server whenever its checkout changes, and use plain servers for comparisons.
   - For a fix, first confirm that base reproduces the bug. Otherwise the check proves nothing.

1. Hold everything but the code constant.
   - Drive both builds with one script: the same fixture or pasted markdown, viewport, device scale, color scheme, theme, and input sequence.
   - Pause the page clock and advance it explicitly, so caret blink, animations, and idle work land on the same frame in both runs. Turn off anything random, such as the playground's auto presence.
   - Cover the matrix: Chromium and WebKit, desktop (for example 1000×700 at 2x) and mobile (390×844 at 3x with touch), light and dark. On touch-primary devices (`(pointer: coarse)`, which touch emulation matches), Documint only handles keydown while a completion or search leaf is open, so drive mobile with taps and typed text instead of shortcuts.

1. Capture frames where the change can show.
   - Screenshot the editor after each step at a first frame (about 16ms) and a settled frame taken after the relevant effect finishes. Effect durations live in `src/renderer/effects/kinds.ts` and run up to 1000ms. A difference between the two is either an animation or a late layout correction.
   - When scrolling or motion matters, sweep in small steps so each tall block crosses the top and bottom viewport edges, and capture every step. Long documents refine estimated heights as they scroll, so sweep once to measure before checking for jumps.
   - The canvas only shows pixels. Toolbars, link and comment leaves, selection handles, and the hidden input are DOM (leaves render in shadow roots), so record their rects next to each screenshot.

1. Measure instead of eyeballing.
   - **Caret drift.** The hidden `textarea.documint-input` follows the caret, so its `getBoundingClientRect().top` is the caret's viewport y. It should hold still while typing within a line.
   - **Scroll stability.** Record `scrollTop` and `scrollHeight` of `.documint-scroll-container` around each input, and diff the content above and below the caret against the previous frame. Use a fixture long enough to scroll with the caret already in view, and derive the expected shift from its layout. For example, Enter at the end of a mid-document block should leave content above in place and move content below by the new block's height plus block spacing. Short documents keep `scrollHeight` clamped to the viewport, and revealing an off-screen caret scrolls on purpose.
   - **Paint counts.** Dev builds dispatch `documint:render-frame` on `window` for each content paint. Instrument the overlay canvas to count overlay paints. Compare counts per step to catch extra or missing repaints.
   - **Edge pops.** In a sweep, compare each frame with its neighbor and flag backgrounds, borders, or tints that appear or vanish at a viewport edge.

1. Diff head against base and explain every difference.
   - Compare frames by name with a small noise threshold, view each remaining diff side by side at the same scroll position, and compare recorded geometry exactly.
   - Run one build twice to learn the noise floor. Scrollbar fades, network images like link favicons, and shadow anti-aliasing vary between runs of the same build. Rerun any one-off difference before trusting it.
   - A defect is a regression only when base does not show it. If base shows the same thing on the same frame, report it as pre-existing and keep it out of the change.

1. Report with evidence.
   - Lead with the verdict, then the matrix covered, the numbers, and head and base composites of anything that differs or that the change fixes.
   - Name what you could not verify, such as real devices, IME composition, real-time feel under a paused clock, and network-dependent content. Treat timings from a busy machine as directional only.
   - Stop the servers and remove the worktrees when you finish.
