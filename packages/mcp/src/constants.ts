import { AIMPARENCY_DIR_NAME } from 'shared';

export const IDEA_STATES_DESCRIPTION = `Idea status: open (todo), partially (in progress), implemented (complete — put the verification evidence in the status comment), cancelled, failed, unclear (needs a human decision — explain in comment), human-dependent (blocked on a human action), ai-proposition (proposed by an AI, waiting for a human to accept it as open or reject it as cancelled; never worked on), archived. Don't leave completed or blocked work as open.`;

// A graph's address: on this machine the absolute path of its project; on a
// server with accounts its name there (the <slug> of /g/<slug>).
export const GRAPH_TOOL_PROPERTY = {
  type: "string",
  description: "The graph: the absolute path of the project root, or the graph's name on a server with accounts"
};

// Optional so prompts like `/mcp__aimparency__dream` work without typing a path.
export const PROJECT_PATH_PROMPT_ARGUMENT = {
  name: "graph",
  description: "The graph: absolute path of the project (or its name on a server with accounts); defaults to the current repository",
  required: false
};

export const PROJECT_PATH_PARAMETER = `graph=/abs/path/${AIMPARENCY_DIR_NAME}`;
export const PROJECT_PATH_MISSING_ERROR = `graph query parameter is required (e.g., idea://uuid?graph=/path/to/project/${AIMPARENCY_DIR_NAME})`;
