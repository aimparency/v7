import { AIMPARENCY_DIR_NAME } from 'shared';

export const IDEA_STATES_DESCRIPTION = `Idea status: open (todo), partially (in progress), implemented (complete — include verification evidence in update_idea.reflection or addReflection), cancelled, failed, unclear (needs a human decision — explain in comment), human-dependent (blocked on a human action), archived. Don't leave completed or blocked work as open.`;

export const PROJECT_PATH_DESCRIPTION = `Absolute path of the project root`

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
export const PROJECT_PATH_MISSING_ERROR = `projectPath query parameter is required (e.g., idea://uuid?projectPath=/path/to/project/${AIMPARENCY_DIR_NAME})`;
