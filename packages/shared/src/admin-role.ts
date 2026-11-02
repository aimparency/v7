// What making someone admin of a hosted instance hands over. Shown wherever an
// admin is created or promoted (setup, `pnpm accounts`, the Accounts dialog).
export const ADMIN_SHELL_WARNING =
  'Admin means a shell on this server: admins can run any command as the user Aimparency runs as, ' +
  'read whatever that user can (/etc, the served repository, other files) and every secret in Aimparency\'s .env. ' +
  'Make admin only people you would give an SSH login.';
