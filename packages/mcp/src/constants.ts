import { AIMPARENCY_DIR_NAME } from 'shared';

export const IDEA_STATES_DESCRIPTION = `Idea status: open (todo), partially (in progress), implemented (complete — put the verification evidence in the status comment), cancelled, failed, unclear (needs a human decision — explain in comment), human-dependent (blocked on a human action), archived. Don't leave completed or blocked work as open.`;

export const PROJECT_PATH_DESCRIPTION = `Absolute path of the project root`

export const PROJECT_PATH_TOOL_PROPERTY = {
  type: "string",
  description: PROJECT_PATH_DESCRIPTION
};

// Optional so prompts like `/mcp__aimparency__dream` work without typing a path.
export const PROJECT_PATH_PROMPT_ARGUMENT = {
  name: "projectPath",
  description: "Absolute path to the .bowman dir; defaults to the current repository",
  required: false
};

export const PROJECT_PATH_PARAMETER = `projectPath=/abs/path/${AIMPARENCY_DIR_NAME}`;
export const PROJECT_PATH_MISSING_ERROR = `projectPath query parameter is required (e.g., idea://uuid?projectPath=/path/to/project/${AIMPARENCY_DIR_NAME})`;
