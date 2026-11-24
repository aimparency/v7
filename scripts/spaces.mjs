import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as accounts from '../packages/backend/src/auth/accounts.ts';
import * as spaces from '../packages/backend/src/spaces/registry.ts';

// The spaces of this server, from its terminal (run through tsx):
//
//   pnpm spaces list
//   pnpm spaces add <path> [--slug <slug>] [--owner <account>]   a repository on this machine
//   pnpm spaces owner <slug> <account>
//   pnpm spaces writers <slug> [<account> ...]                   replaces the list
//   pnpm spaces remove <slug>          (a space created on the server is deleted; a checkout stays)
//   pnpm spaces relocate <slug> <path> [--force]   a checkout whose folder moved; --force takes another space there
//
// `--server <name>` (anywhere in the command) selects another server of this
// machine than "local". Accounts create spaces in the browser; adding a repository that is already
// on the machine is the operator's doing, here. Without --owner it belongs to
// the server admins.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(repoRoot, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const args = process.argv.slice(2);
// Which server of this machine (default: local), as with `pnpm start --server <name>`.
const serverAt = args.indexOf('--server');
if (serverAt >= 0) process.env.AIMPARENCY_SERVER = args.splice(serverAt, 2)[1] ?? '';
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args.splice(index, 2)[1] : undefined;
};
const slug = option('--slug');
const owner = option('--owner');
const forceAt = args.indexOf('--force');
const force = forceAt >= 0 && args.splice(forceAt, 1).length > 0;
const [command, target, ...rest] = args;

function accountId(name) {
  const account = accounts.findAccount(name);
  if (!account) throw new spaces.SpaceError(`No account named "${name}".`);
  return account.id;
}

async function main() {
  switch (command) {
    case 'list':
      for (const space of spaces.listSpaces()) {
        const names = [space.owner ? accounts.accountNames([space.owner])[0] ?? '(gone)' : '(server admins)', ...accounts.accountNames(space.writers)];
        console.log(`${space.slug}\t${space.kind}\t${space.path}${spaces.isMissing(space) ? ' (folder moved)' : ''}\t${names.join(', ')}`);
      }
      return;
    case 'add': {
      // pnpm keeps the caller's directory in INIT_CWD.
      const directory = path.resolve(process.env.INIT_CWD ?? process.cwd(), target ?? '');
      const space = await spaces.addCheckout(directory, owner ? accountId(owner) : null, slug);
      console.log(`Added ${space.path} as /spaces/${space.slug}.`);
      return;
    }
    case 'owner':
      await spaces.setSpaceAccess(target ?? '', { owner: accountId(rest[0] ?? '') });
      console.log(`${rest[0]} owns ${target} now.`);
      return;
    case 'writers':
      await spaces.setSpaceAccess(target ?? '', { writers: rest.map(accountId) });
      console.log(rest.length ? `${rest.join(', ')} may write ${target}.` : `Only its owner writes ${target} now.`);
      return;
    case 'relocate': {
      const directory = path.resolve(process.env.INIT_CWD ?? process.cwd(), rest[0] ?? '');
      const space = await spaces.relocateCheckout(target ?? '', directory, { force });
      console.log(`/spaces/${space.slug} is at ${space.path} now.`);
      return;
    }
    case 'remove':
      await spaces.removeSpaceEntry(target ?? '');
      console.log(`Removed ${target}.`);
      return;
    default:
      throw new spaces.SpaceError('Usage: pnpm spaces list | add <path> [--slug <slug>] [--owner <account>] | owner <slug> <account> | writers <slug> [<account> ...] | remove <slug> | relocate <slug> <path> [--force]');
  }
}

main().catch((error) => {
  console.error(error instanceof spaces.SpaceError ? error.message : error);
  process.exitCode = 1;
});
