export type ConnectionInput = string | {
  ideaId: string;
  weight?: number;
  hypothesis?: string;
  reflection?: string;
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
            reflection: { type: "string", description: "Whether the hypothesis held: how the child actually contributed, once it is settled" },
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
    ...(conn.reflection !== undefined ? { reflection: conn.reflection } : {}),
  };
}
