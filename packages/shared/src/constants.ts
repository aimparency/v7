if (!process.env.AIMPARENCY_DIR_NAME) {
  throw new Error('AIMPARENCY_DIR_NAME has to be defined in env');
}

export const AIMPARENCY_DIR_NAME = process.env.AIMPARENCY_DIR_NAME;