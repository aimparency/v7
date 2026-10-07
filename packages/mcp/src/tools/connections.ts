export type ConnectionInput = string | {
  ideaId: string;
  weight?: number;
  hypothesis?: string;
  evaluation?: string;
};

export function connectionInputSchema(description: string) {
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
            weight: { type: "number" },
            hypothesis: { type: "string", description: "Why the child is expected to contribute to the parent" },
            evaluation: { type: "string", description: "How that turned out, once the child idea is settled" },
          },
          required: ["ideaId"],
        },
      ],
    },
  };
}

export function normalizeConnectionInput(input: ConnectionInput): Exclude<ConnectionInput, string> {
  return typeof input === "string" ? { ideaId: input } : input;
}

// Only the given fields, so upserting metadata keeps an existing edge's weight.
export function toStoredConnection(input: ConnectionInput) {
  const conn = normalizeConnectionInput(input);
  return {
    ideaId: conn.ideaId,
    ...(conn.weight !== undefined ? { weight: conn.weight } : {}),
    ...(conn.hypothesis !== undefined ? { hypothesis: conn.hypothesis } : {}),
    ...(conn.evaluation !== undefined ? { evaluation: conn.evaluation } : {}),
  };
}
