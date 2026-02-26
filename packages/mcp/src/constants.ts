import { AIMPARENCY_DIR_NAME, INITIAL_STATES } from 'shared';

export const AIM_STATE_KEYS = INITIAL_STATES.map(s => s.key);
export const AIM_STATES_DESCRIPTION = `Current status of the aim. Options: ${AIM_STATE_KEYS.join(", ")}, archived`;

export const PROJECT_PATH_DESCRIPTION = `Absolute path to the project directory. For a repository it defaults to /path/to/repo/${AIMPARENCY_DIR_NAME}. So be careful to append /${AIMPARENCY_DIR_NAME} to the repo directory if no otherwise specified`

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
