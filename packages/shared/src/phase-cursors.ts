// The current phase path is root → the phase marked with `c`. Older metas also stored an
// auto-filled first-child chain below it; levels deeper than phaseActiveLevel are ignored.
export function currentPhaseCursors(
  meta: { phaseCursors?: Record<string, string>; phaseActiveLevel?: number } | null | undefined
): Record<string, string> {
  const activeLevel = meta?.phaseActiveLevel ?? 0;
  return Object.fromEntries(
    Object.entries(meta?.phaseCursors ?? {}).filter(([level]) => Number(level) <= activeLevel)
  );
}
