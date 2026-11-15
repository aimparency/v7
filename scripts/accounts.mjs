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
//   pnpm accounts invite [--once] [--days <n>] [--admin] [--creates-graphs]   (prints the link's path)
//   pnpm accounts invitations
//   pnpm accounts uninvite <id>
//   pnpm accounts agent-token   (prints a fresh token of the wrapped agents' account)
//
// They live in the server directory; `--server <name>` (anywhere in the
// command) selects another server of this machine than "local". A
// password comes from AIMPARENCY_PASSWORD when set (the setup passes it so),
// else it is asked. What an account may do on a graph: `pnpm graphs`.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(repoRoot, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const args = process.argv.slice(2);
// Which server of this machine (default: local), as with `pnpm start --server <name>`.
const serverAt = args.indexOf('--server');
if (serverAt >= 0) process.env.AIMPARENCY_SERVER = args.splice(serverAt, 2)[1] ?? '';
const flag = (name) => {
  const index = args.indexOf(name);
  if (index >= 0) args.splice(index, 1);
  return index >= 0;
};
const admin = flag('--admin');
const createsGraphs = flag('--creates-graphs');
const once = flag('--once');
const daysAt = args.indexOf('--days');
const days = daysAt >= 0 ? Number(args.splice(daysAt, 2)[1]) : undefined;
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
    case 'invite': {
      if (days !== undefined && !(days > 0)) throw new accounts.AccountError('--days needs a number of days.');
      const code = await accounts.createInvitation({
        kind: once ? 'once' : 'permanent',
        serverAdmin: admin,
        canCreateGraphs: createsGraphs,
        expiresAt: days ? new Date(Date.now() + days * 24 * 60 * 60_000).toISOString() : undefined,
      });
      console.log(`Append this to the server's address; it is shown only now:\n/?invitation=${code}`);
      return;
    }
    case 'invitations':
      for (const invitation of accounts.listInvitations()) {
        const state = invitation.redeemedBy ? `used by ${invitation.redeemedBy}` : invitation.expiresAt ? `until ${invitation.expiresAt}` : 'no end';
        console.log(`${invitation.id}\t${invitation.kind}\t${state}${invitation.serverAdmin ? '\tserver admin' : ''}${invitation.canCreateGraphs ? '\tcreates graphs' : ''}`);
      }
      return;
    case 'uninvite':
      await accounts.removeInvitation(name ?? '');
      console.log('Removed the invitation.');
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
      throw new accounts.AccountError('Usage: pnpm accounts list | add <name> [--admin] [--creates-graphs] | admin <name> on|off | creates-graphs <name> on|off | password <name> | remove <name> | invite [--once] [--days <n>] [--admin] [--creates-graphs] | invitations | uninvite <id>');
  }
}

main()
  .catch((error) => {
    console.error(error instanceof accounts.AccountError ? error.message : error);
    process.exitCode = 1;
  })
  .finally(closeQuestions);
