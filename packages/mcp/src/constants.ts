import { AIMPARENCY_DIR_NAME } from 'shared';

export const IDEA_STATES_DESCRIPTION = `Idea status: open (todo), partially (in progress), implemented (complete — put the verification evidence in the status comment), cancelled, failed, unclear (needs a human decision — the question in the comment, each possible answer as an ai-proposition child: the human's inbox shows them as numbered options and picks one with a key), human-dependent (blocked on a human action), ai-proposition (proposed by an AI, waiting for a human to accept it as open or reject it as cancelled; never worked on), archived. Don't leave completed or blocked work as open.`;

// Agents work downstream: from their space into the spaces that contribute to
// it (its linked repos), not up into the spaces it contributes to. A hint, not
// a rule; the tools accept any space.
export const SPACE_DIRECTION = "Work in your own space; you may descend into spaces that contribute to it (its linked repos, see list_linked_repos), rather than rising into spaces it contributes to.";

// A space's address: on this machine the absolute path of its project; on a
// server with accounts its name there (the <slug> of /spaces/<slug>).
export const SPACE_TOOL_PROPERTY = {
  type: "string",
  description: `The space: the absolute path of the project root, or the space's name on a server with accounts. ${SPACE_DIRECTION}`
};

// Optional so prompts like `/mcp__aimparency__dream` work without typing a path.
export const SPACE_PROMPT_ARGUMENT = {
  name: "space",
  description: "The space: absolute path of the project (or its name on a server with accounts); defaults to the current repository",
  required: false
};

export const SPACE_URI_PARAMETER = `space=/abs/path/${AIMPARENCY_DIR_NAME}`;
export const SPACE_MISSING_ERROR = `space query parameter is required (e.g., idea://uuid?space=/path/to/project/${AIMPARENCY_DIR_NAME})`;
