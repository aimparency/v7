import { AIMPARENCY_DIR_NAME, INITIAL_STATES } from 'shared';

export const AIM_STATE_KEYS = INITIAL_STATES.map(s => s.key);
export const AIM_STATES_DESCRIPTION = `Aim status: open (todo), partially (in progress), done (complete — then addReflection), cancelled, failed, unclear (needs a human decision — explain in comment), human-dependent (blocked on a human action), archived. Don't leave completed or blocked work as open.`;

export const PROJECT_PATH_DESCRIPTION = `Absolute path to the .bowman dir (append /.bowman to repo root)`

export const PROJECT_PATH_TOOL_PROPERTY = {
  type: "string",
  description: PROJECT_PATH_DESCRIPTION
};

export const PROJECT_PATH_PROMPT_ARGUMENT = {
  name: "projectPath",
  description: PROJECT_PATH_DESCRIPTION,
  required: true
};

export const PROJECT_PATH_PARAMETER = `projectPath=/abs/path/${AIMPARENCY_DIR_NAME}`;
export const PROJECT_PATH_MISSING_ERROR = `projectPath query parameter is required (e.g., aim://uuid?projectPath=/path/to/project/${AIMPARENCY_DIR_NAME})`;
