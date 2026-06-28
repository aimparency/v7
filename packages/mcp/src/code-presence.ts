// Pure core of the code-presence reconciliation heuristic (aim da1291e5):
// decide whether an OPEN aim's described work already appears in the codebase by
// extracting identifier-like tokens from its text and checking how many are
// present in code. Precision-first: only code-SHAPED tokens count (camelCase,
// snake_case, dotted calls, file names), generic prose is ignored, and an aim
// needs >= 2 such tokens to be scorable at all. Kept side-effect-free (the git
// search lives in the tool handler) so the token rules are unit-testable.

// Code-ish words that are too generic to be evidence of a specific aim.
const STOPWORDS = new Set([
  "true", "false", "null", "undefined", "const", "function", "return", "async",
  "await", "import", "export", "string", "number", "boolean", "object", "array",
  "value", "result", "error", "props", "state", "type", "interface", "default",
  "this", "self", "node_modules",
]);

/**
 * A token is "code-shaped" — specific enough to be a useful search term — when it
 * looks like a real identifier or file rather than an English word: internal
 * caps (camelCase/PascalCase), an underscore, a dotted member/file, or a known
 * source-file extension. Length >= 4, not purely numeric.
 */
export function isCodeShaped(token: string): boolean {
  if (token.length < 4) return false;
  if (/^\d+$/.test(token)) return false;
  return /[a-z][A-Z]/.test(token)                 // camelCase / PascalCase
    || /_/.test(token)                            // snake_case
    || /\w\.\w/.test(token)                       // dotted member or file
    || /\.(ts|tsx|js|jsx|vue|json|md|css|scss|html|sh|yml|yaml)$/i.test(token); // file
}

/**
 * Extract the deduped set of code-shaped tokens from free text, including
 * code-shaped segments of dotted/slashed tokens (so "trpc.aim.linkRepo" also
 * yields "linkRepo", and "AimEditModal.vue" yields "AimEditModal").
 */
export function extractCodeTokens(text: string): string[] {
  if (!text) return [];
  const out = new Set<string>();
  const raw = text.match(/[A-Za-z_][A-Za-z0-9_./-]*[A-Za-z0-9_]/g) ?? [];
  const keep = (t: string) => {
    if (isCodeShaped(t) && !STOPWORDS.has(t.toLowerCase())) out.add(t);
  };
  for (const tok of raw) {
    keep(tok);
    for (const seg of tok.split(/[./]/)) keep(seg);
  }
  return [...out];
}

export interface CodePresenceScore {
  scorable: boolean;   // had enough specific tokens to judge at all
  score: number;       // fraction of tokens found in code (0..1)
  total: number;
  matched: string[];
  missing: string[];
}

/**
 * Score an aim's tokens against the set found in code. `scorable` is false when
 * the aim has fewer than 2 code-shaped tokens — too vague to reason about, which
 * is "unknown", not "implemented".
 */
export function scoreCodePresence(tokens: string[], presentInCode: Set<string>): CodePresenceScore {
  const total = tokens.length;
  const matched = tokens.filter((t) => presentInCode.has(t));
  const missing = tokens.filter((t) => !presentInCode.has(t));
  return {
    scorable: total >= 2,
    score: total > 0 ? matched.length / total : 0,
    total,
    matched,
    missing,
  };
}
