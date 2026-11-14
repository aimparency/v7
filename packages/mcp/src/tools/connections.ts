export type ConnectionInput = string | {
  ideaId: string;
  weight?: number;
  /** Percent of the parent's value this child carries; becomes the weight. */
  share?: number;
  /** Parent edges only: percent for other children of that parent. */
  siblingShares?: Record<string, number>;
  /** Parent edges only: percent that parent keeps for its own work. */
  loopShare?: number;
  hypothesis?: string;
  reflection?: string;
};

// `parentEdge`: entries name parents of the idea, so they may also set that
// parent's other shares (siblingShares, loopShare).
export function connectionInputSchema(description: string, parentEdge = false) {
  return {
    type: "array",
    description,
    items: {
      anyOf: [
        { type: "string" },
        {
          type: "object",
          properties: {
            ideaId: { type: "string" },
            weight: { type: "number", description: "Raw relative weight; prefer share" },
            share: { type: "number", description: "Percent of the parent's value this child carries (0-100]; sets the weight. Other children keep their proportions, the parent keeps what children don't take as its loop share" },
            ...(parentEdge ? {
              siblingShares: { type: "object", additionalProperties: { type: "number" }, description: "Percent for other children of this parent, by idea id" },
              loopShare: { type: "number", description: "Percent this parent keeps for its own work [0-100]" },
            } : {}),
            hypothesis: { type: "string", description: "A claim that could fail: the effect the child should have on the parent. Omit it for mere grouping or a restatement of the child" },
            reflection: { type: "string", description: "Whether the hypothesis held: how the child actually contributed, once it is settled" },
          },
          required: ["ideaId"],
        },
      ],
    },
  };
}

export function normalizeConnectionInput(input: ConnectionInput): Exclude<ConnectionInput, string> {
  const conn = typeof input === "string" ? { ideaId: input } : input;
  if (conn.weight !== undefined && conn.share !== undefined) {
    throw new Error(`Give either weight or share for ${conn.ideaId}, not both.`);
  }
  return conn;
}

/** Whether the entry sets any share in percent. */
export function setsShares(conn: Exclude<ConnectionInput, string>) {
  return conn.share !== undefined || conn.loopShare !== undefined || Object.keys(conn.siblingShares ?? {}).length > 0;
}

// Only the given fields, so upserting metadata keeps an existing edge's weight.
export function toStoredConnection(input: ConnectionInput) {
  const conn = normalizeConnectionInput(input);
  return {
    ideaId: conn.ideaId,
    ...(conn.weight !== undefined ? { weight: conn.weight } : {}),
    ...(conn.hypothesis !== undefined ? { hypothesis: conn.hypothesis } : {}),
    ...(conn.reflection !== undefined ? { reflection: conn.reflection } : {}),
  };
}
