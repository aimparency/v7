// What making someone server admin hands over. Shown wherever a server admin is
// created or promoted (setup, `pnpm accounts`, the Accounts dialog).
export const ADMIN_SHELL_WARNING =
  'Where agents are switched on ("agents" in server.json), a server admin holds a shell on this server: ' +
  'they can run any command as the user Aimparency runs as, read whatever that user can (/etc, the repositories, other files) ' +
  'and every secret in Aimparency\'s .env. Make server admin only people you would give an SSH login.';
