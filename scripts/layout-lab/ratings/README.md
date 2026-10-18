# Layout ratings

Each session: pairs of layout settings (since session 2, one hypothesis per pair), rated blind on all four projects in
the session page (`pnpm layout-lab:session <design>`, designs in
`../sessions/`; past designs are removed when a mechanic they used goes,
the reports keep every side's full settings). Per session: the pasted report (`<id>.json`), the metrics
of every layout (`<id>.metrics.json`) and the conclusions below.

## session-20261018-1527: extremes (`01-extremes`)

Each setting from far below to far above its slider range; three random
settings against the defaults (length 6, spacing 4, memory 1, spread 1,
outward 1.5, semantic 0, isolated semantic 1).

What the eye rejects:
- **Overlaps and children bunched on one side of their parent**: pull to
  spacing 52 (130 overlaps on v7), outward 20 (a 60° stream, 777 overlaps on
  ideas), spread 0.03.
- **Too sparse**: spacing 6.8 lost to 3.1 on every project.
- **Very long weak connections**: spread 5.6 makes small graphs round but
  sends low-value ideas far out on large ones.

What it likes: spread-out, round graphs (small graphs liked spread 4–5),
pull to spacing 1.6 over 52 everywhere, keep as is 0.15 over 10, outward 0.26
over 20.

No visible effect: unconnected toward similar (0.12 vs 7.7). Similar
together 0.11 lost to 0 on the large graphs.

Metrics against the votes (35 votes for a side): overlaps agree 17 of 20
where they differ; crossings 25/35, angle median 24/35; crowding, length
misfit and displacement are near chance (≈ 19/35).

Viewer feedback, done for the next session: both layouts centred at one
scale, zoomed out further; a note per project; Tab through the ratings
with h / j / l.

## session-20261018-1609: hypotheses (7 of 10 rated)

- **Control** (pull 6 vs 6.2): "same" on every project, so a vote for a
  side means something.
- **Strength floor 0.3**: no visible effect, rightly: every connection
  strength is 0.4–0.6 (the simulation compresses flow into 0.25–0.75), so
  important connections barely pull harder than minor ones. The floor is
  removed (no thresholds on importance: keep it continuous).
- **Combination** (pull 3, spacing 3.5, outward 0.5, spread 1.5, memory
  0.5): won on three projects; on v7 "no arrow chaos". On ideas the
  cross-links pulled the graph to one side of the root; defaults rounder.
- **Pull 3 vs 6**: 3 for small graphs, 6 for large ones.
- **Outward 0.4 vs 1.5**: 0.4 on the small graphs, unclear on large.
- **Separation 8 vs 4**: same, except an-der-rax.
- Unrated: keep as is 0.3, spread 2.5, strength floor.

Further feedback: connections are arcs (measure them as such: done); v7
mostly shows arrows, no background ("more spread or fewer arrows"); ideas
should keep room from all ideas, not only connected ones (minimum space,
session 3); s for same; fit the whole graph.

## session-20261018-1721: minimum space (2 of 10 rated)

- **Space push 16 vs 4** (at space 5): 4 on both large graphs, "better
  distributed and more compact at the same time".
- **Keep as is 0.3 vs 1** (at space 3): no clear winner; on both large
  graphs ideas sit almost touching, "very bad".

Then: everything goes into the Layout panel as sliders to try live:
minimum space (reach, default now 5), space push, space curve and
importance. Importance is a blend, strength = 1 − importance + importance ·
flow share, not a power of the share: flow shares span orders of magnitude,
so any power starved weak connections (ideas: mean length 6 → 25 radius
sums at power 0.3). Default 0.5 with pull to spacing 3 (the strengths are
now about twice the simulation's).

## One similarity force

"Unconnected toward similar" barely mattered: for an unconnected idea the
similarity pull is nearly its only term, so its size hardly changes where
the idea goes. Merged with "similar together" into one weight for every
idea, connected or not (default 0.1). One weight trades closeness to similar
ideas against a calm network (median radius sums from an unconnected idea
to its closest similar one, and crossings):

| weight | v7 similar | v7 crossings | ideas similar | ideas crossings |
|---|---|---|---|---|
| split (0 / 1) | 41 | 1656 | 7 | 1421 |
| 0.03 | 34 | 1602 | 30 | 708 |
| 0.1 | 21 | 1785 | 18 | 968 |
| 0.3 | 10 | 2194 | 11 | 1537 |

A softer hold on start positions (anchor) changed nothing.
