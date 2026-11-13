import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { askNewPassword, closeQuestions } from './ask.mjs';
import * as accounts from '../packages/backend/src/auth/accounts.ts';
import { serverDir } from '../packages/shared/src/server-config.ts';
import { ADMIN_SHELL_WARNING } from '../packages/shared/src/admin-role.ts';

// Accounts of this server, from its terminal (run through tsx):
//
//   pnpm accounts list
//   pnpm accounts add <name> [--admin] [--creates-graphs]
//   pnpm accounts admin <name> on|off
//   pnpm accounts creates-graphs <name> on|off
//   pnpm accounts password <name>
//   pnpm accounts remove <name>
//   pnpm accounts agent-token   (prints a fresh token of the wrapped agents' account)
//
// They live in the server directory (AIMPARENCY_SERVER_DIR, see .env). A
// password comes from AIMPARENCY_PASSWORD when set (the setup passes it so),
// else it is asked. What an account may do on a graph: `pnpm graphs`.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(repoRoot, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const args = process.argv.slice(2);
const flag = (name) => {
  const index = args.indexOf(name);
  if (index >= 0) args.splice(index, 1);
  return index >= 0;
};
const admin = flag('--admin');
const createsGraphs = flag('--creates-graphs');
const [command, name, value] = args;

const password = async (who) => process.env.AIMPARENCY_PASSWORD || await askNewPassword(who);

function onOff(text) {
  if (text !== 'on' && text !== 'off') throw new accounts.AccountError('Say on or off.');
  return text === 'on';
}

const describe = ({ serverAdmin, canCreateGraphs }) =>
  [serverAdmin && 'server admin', canCreateGraphs && 'creates graphs'].filter(Boolean).join(', ');

async function main() {
  switch (command) {
    case 'list':
      for (const account of accounts.listAccounts()) console.log(`${account.name}\t${describe(account)}`);
      return;
    case 'add':
      await accounts.createAccount(name ?? '', await password(name), { serverAdmin: admin, canCreateGraphs: createsGraphs });
      console.log(`Added ${name}${admin ? ' (server admin)' : ''} in ${serverDir()}.`);
      if (admin) console.warn(`Warning: ${ADMIN_SHELL_WARNING}`);
      return;
    case 'admin':
      await accounts.setRights(name ?? '', { serverAdmin: onOff(value) });
      console.log(`${name} is ${value === 'on' ? 'a server admin now' : 'no server admin any more'}.`);
      if (value === 'on') console.warn(`Warning: ${ADMIN_SHELL_WARNING}`);
      return;
    case 'creates-graphs':
      await accounts.setRights(name ?? '', { canCreateGraphs: onOff(value) });
      console.log(`${name} ${value === 'on' ? 'may create graphs' : 'is no longer selected to create graphs'}.`);
      return;
    case 'password':
      await accounts.setPassword(name ?? '', await password(name));
      console.log(`New password set for ${name}; their logins ended.`);
      return;
    case 'agent-token':
      // The launcher reads stdout: the token and nothing else.
      process.stdout.write(`${await accounts.agentToken()}\n`);
      return;
    case 'remove':
      await accounts.removeAccount(name ?? '');
      console.log(`Removed ${name}.`);
      return;
    default:
      throw new accounts.AccountError('Usage: pnpm accounts list | add <name> [--admin] [--creates-graphs] | admin <name> on|off | creates-graphs <name> on|off | password <name> | remove <name>');
  }
}

main()
  .catch((error) => {
    console.error(error instanceof accounts.AccountError ? error.message : error);
    process.exitCode = 1;
  })
  .finally(closeQuestions);
