# Layout ratings

Each session: pairs of layout settings, rated blind on all four projects in
the session page (`pnpm layout-lab:session <design>`, designs in
`../sessions/`). Per session: the pasted report (`<id>.json`), the metrics
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
