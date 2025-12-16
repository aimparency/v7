export const AIM_STATES = ["open", "done", "cancelled", "partially", "failed"];
export const AIM_STATES_DESCRIPTION = `Current status of the aim. Options: ${AIM_STATES.join(", ")}`;

export const SUBDIR_NAME = ".bowman"
export const PROJECT_PATH_DESCRIPTION = `Absolute path to the project directory. For a repository it defaults to /path/to/repo/${SUBDIR_NAME}. So be careful to append /${SUBDIR_NAME} to the repo directory if no otherwise specified`

export const PROJECT_PATH_TOOL_PROPERTY = {
  type: "string",
  description: PROJECT_PATH_DESCRIPTION
};

export const PROJECT_PATH_PROMPT_ARGUMENT = {
  name: "projectPath",
  description: PROJECT_PATH_DESCRIPTION,
  required: true
};

export const PROJECT_PATH_PARAMETER = `projectPath=/abs/path/${SUBDIR_NAME}`;
export const PROJECT_PATH_MISSING_ERROR = `projectPath query parameter is required (e.g., aim://uuid?projectPath=/path/to/project/${SUBDIR_NAME})`;
