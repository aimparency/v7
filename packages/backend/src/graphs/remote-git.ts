// The environment for git commands that talk to the remote of a graph somebody
// added by URL. On a server with accounts that somebody is a stranger, so:
//
// - only https and ssh, and never a host inside the server's own network (the
//   address is resolved once, checked, and git is pinned to it, so a name
//   cannot point elsewhere a moment later; redirects are not followed);
// - none of the server user's own git setup: no credential helpers, no URL
//   rewrites, no SSH agent, no keys from ~/.ssh;
// - the only key is the one the graph's owner selected for it;
// - nothing from the repository runs: no hooks.
//
// A checkout the server admin listed is their own repository and uses the
// server user's git as it is (gitEnvFor).

import dns from 'node:dns/promises';
import net from 'node:net';
import path from 'node:path';
import { hasAccounts, serverDir } from 'shared/server-config';
import { findGraphByPath, type Graph } from './registry.js';
import { privateKeyFile } from './ssh-keys.js';

const INTERNAL = new net.BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 3]
] as const) INTERNAL.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [['::', 127], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]] as const) INTERNAL.addSubnet(address, prefix, 'ipv6');

export function isInternalAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return INTERNAL.check(mapped[1]!, 'ipv4');
  return INTERNAL.check(address, net.isIPv6(address) ? 'ipv6' : 'ipv4');
}

type Remote = { protocol: 'https' | 'ssh' | 'file'; host: string; port: number };

function parseRemote(url: string): Remote {
  const scp = /^[\w.-]+@([\w.-]+):(?!\/\/)/.exec(url.trim()); // git@host:owner/repo
  if (scp) return { protocol: 'ssh', host: scp[1]!, port: 22 };
  const parsed = new URL(url.trim());
  const protocol = parsed.protocol.slice(0, -1);
  if (protocol !== 'https' && protocol !== 'ssh' && protocol !== 'file') throw new Error('Only https and ssh remotes are fetched.');
  // An IPv6 literal comes in brackets; the address itself is what gets checked.
  return { protocol, host: parsed.hostname.replace(/^\[|\]$/g, ''), port: Number(parsed.port) || (protocol === 'ssh' ? 22 : 443) };
}

/** The address git is pinned to: the first one the name resolves to, refused when any is internal. */
async function publicAddress(host: string): Promise<string> {
  const addresses = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map(entry => entry.address);
  if (addresses.length === 0 || addresses.some(isInternalAddress)) {
    throw new Error(`${host} is not a public address: this server does not fetch from its own network.`);
  }
  return addresses[0]!;
}

const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

/** `keyFile`: the private key the graph's owner selected, if any. */
export async function remoteGitEnv(url: string, keyFile: string | null): Promise<NodeJS.ProcessEnv> {
  const remote = parseRemote(url);
  // A file remote exists only in tests and where the operator wrote it into graphs.json.
  const pinned = remote.protocol === 'file' || !hasAccounts() ? null : await publicAddress(remote.host);
  const ssh = [
    'ssh', '-F', '/dev/null', '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'IdentityAgent=none',
    '-o', 'StrictHostKeyChecking=accept-new', '-o', `UserKnownHostsFile=${path.join(serverDir(), 'known_hosts')}`,
    ...(keyFile ? ['-i', keyFile] : ['-o', 'IdentityFile=none']),
    ...(pinned && remote.protocol === 'ssh' ? ['-o', `HostName=${pinned}`, '-o', `HostKeyAlias=${remote.host}`] : [])
  ];
  const config: Array<[string, string]> = [
    ['core.hooksPath', '/dev/null'],
    ['http.followRedirects', 'false'],
    ['credential.helper', ''],
    ...(pinned && remote.protocol === 'https' ? [['http.curloptResolve', `${remote.host}:${remote.port}:${pinned}`] as [string, string]] : [])
  ];
  const { SSH_AUTH_SOCK: _agent, SSH_ASKPASS: _askpass, GIT_ASKPASS: _gitAskpass, ...inherited } = process.env;
  return {
    ...inherited,
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_ALLOW_PROTOCOL: remote.protocol === 'file' ? 'file' : 'https:ssh',
    GIT_SSH_COMMAND: ssh.map(shellQuote).join(' '),
    GIT_CONFIG_COUNT: String(config.length),
    ...Object.fromEntries(config.flatMap(([key, value], index) => [[`GIT_CONFIG_KEY_${index}`, key], [`GIT_CONFIG_VALUE_${index}`, value]]))
  };
}

export async function graphGitEnv(graph: Graph): Promise<NodeJS.ProcessEnv> {
  if (!graph.remote) return { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  const keyFile = graph.remote.key ? await privateKeyFile(graph.remote.key.account, graph.remote.key.id) : null;
  return remoteGitEnv(graph.remote.url, keyFile);
}

/** For git in this directory: a graph added by URL gets the closed environment above. */
export async function gitEnvFor(directory: string): Promise<NodeJS.ProcessEnv> {
  const graph = findGraphByPath(directory);
  return graph ? graphGitEnv(graph) : { ...process.env, GIT_TERMINAL_PROMPT: '0' };
}
