import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as accounts from '../packages/backend/src/auth/accounts.ts';
import * as graphs from '../packages/backend/src/graphs/registry.ts';

// The graphs of this server, from its terminal (run through tsx):
//
//   pnpm graphs list
//   pnpm graphs add <path> [--slug <slug>] [--owner <account>]   a repository on this machine
//   pnpm graphs owner <slug> <account>
//   pnpm graphs writers <slug> [<account> ...]                   replaces the list
//   pnpm graphs remove <slug>          (a graph created on the server is deleted; a checkout stays)
//
// `--server <name>` (anywhere in the command) selects another server of this
// machine than "local". Accounts create graphs in the browser; adding a repository that is already
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
const [command, target, ...rest] = args;

function accountId(name) {
  const account = accounts.findAccount(name);
  if (!account) throw new graphs.GraphError(`No account named "${name}".`);
  return account.id;
}

async function main() {
  switch (command) {
    case 'list':
      for (const graph of graphs.listGraphs()) {
        const names = [graph.owner ? accounts.accountNames([graph.owner])[0] ?? '(gone)' : '(server admins)', ...accounts.accountNames(graph.writers)];
        console.log(`${graph.slug}\t${graph.kind}\t${graph.path}\t${names.join(', ')}`);
      }
      return;
    case 'add': {
      // pnpm keeps the caller's directory in INIT_CWD.
      const directory = path.resolve(process.env.INIT_CWD ?? process.cwd(), target ?? '');
      const graph = await graphs.addCheckout(directory, owner ? accountId(owner) : null, slug);
      console.log(`Added ${graph.path} as /g/${graph.slug}.`);
      return;
    }
    case 'owner':
      await graphs.setGraphAccess(target ?? '', { owner: accountId(rest[0] ?? '') });
      console.log(`${rest[0]} owns ${target} now.`);
      return;
    case 'writers':
      await graphs.setGraphAccess(target ?? '', { writers: rest.map(accountId) });
      console.log(rest.length ? `${rest.join(', ')} may write ${target}.` : `Only its owner writes ${target} now.`);
      return;
    case 'remove':
      await graphs.removeGraph(target ?? '');
      console.log(`Removed ${target}.`);
      return;
    default:
      throw new graphs.GraphError('Usage: pnpm graphs list | add <path> [--slug <slug>] [--owner <account>] | owner <slug> <account> | writers <slug> [<account> ...] | remove <slug>');
  }
}

main().catch((error) => {
  console.error(error instanceof graphs.GraphError ? error.message : error);
  process.exitCode = 1;
});
