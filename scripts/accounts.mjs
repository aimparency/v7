import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { askNewPassword, closeQuestions } from './ask.mjs';
import * as accounts from '../packages/backend/src/auth/accounts.ts';

// Accounts of the hosted project, from the server's terminal (run through tsx):
//
//   pnpm accounts list
//   pnpm accounts add <name> <read|write|admin>
//   pnpm accounts role <name> <read|write|admin>
//   pnpm accounts password <name>
//   pnpm accounts remove <name>
//
// The project is AIMPARENCY_PROJECT from .env, or --project <path>. A password
// comes from AIMPARENCY_PASSWORD when set (the setup passes it so), else it is asked.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(repoRoot, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const args = process.argv.slice(2);
const projectFlag = args.indexOf('--project');
const project = projectFlag >= 0 ? args.splice(projectFlag, 2)[1] : process.env.AIMPARENCY_PROJECT;
const [command, name, role] = args;

const password = async (who) => process.env.AIMPARENCY_PASSWORD || await askNewPassword(who);

function checkRole(value) {
  if (!accounts.ROLES.includes(value)) throw new accounts.AccountError(`The role is one of: ${accounts.ROLES.join(', ')}.`);
  return value;
}

async function main() {
  if (!project) throw new accounts.AccountError('No project: set AIMPARENCY_PROJECT in .env (pnpm start --setup) or pass --project <path>.');
  switch (command) {
    case 'list':
      for (const user of await accounts.listUsers(project)) console.log(`${user.name}\t${user.role}`);
      return;
    case 'add':
      await accounts.createUser(project, name ?? '', checkRole(role), await password(name));
      console.log(`Added ${name} (${role}).`);
      return;
    case 'role':
      await accounts.setRole(project, name ?? '', checkRole(role));
      console.log(`${name} is ${role} now.`);
      return;
    case 'password':
      await accounts.setPassword(project, name ?? '', await password(name));
      console.log(`New password set for ${name}; their logins ended.`);
      return;
    case 'remove':
      await accounts.removeUser(project, name ?? '');
      console.log(`Removed ${name}.`);
      return;
    default:
      throw new accounts.AccountError('Usage: pnpm accounts list | add <name> <role> | role <name> <role> | password <name> | remove <name>');
  }
}

main()
  .catch((error) => {
    console.error(error instanceof accounts.AccountError ? error.message : error);
    process.exitCode = 1;
  })
  .finally(closeQuestions);
