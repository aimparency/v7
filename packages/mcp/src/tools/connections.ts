export type ConnectionInput = string | {
  ideaId: string;
  weight?: number;
  explanation?: string;
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
          properties: { ideaId: { type: "string" }, weight: { type: "number" }, explanation: { type: "string" } },
          required: ["ideaId"],
        },
      ],
    },
  };
}

export function normalizeConnectionInput(input: ConnectionInput): Exclude<ConnectionInput, string> {
  return typeof input === "string" ? { ideaId: input } : input;
}

export function toStoredConnection(input: ConnectionInput) {
  const conn = normalizeConnectionInput(input);
  return {
    ideaId: conn.ideaId,
    weight: conn.weight ?? 1,
    ...(conn.explanation !== undefined ? { explanation: conn.explanation } : {}),
  };
}
