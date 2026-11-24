#!/usr/bin/env node
// What an agent session's last turn cost, added to the ideas the turn changed
// (idea.addRealizedCost, data model 8). The Stop hook starts it in the
// background with the Stop event on stdin; it never blocks or fails the hook.
//
//   node record-session-cost.mjs <repo root>  < stop-event.json
//
// Tokens come from the transcript (Claude Code JSONL: assistant lines with
// message.usage; one API message spans several lines with the same id), only
// those written since the last Stop of this session. Prices come from
// .bowman/harness.json `prices` by model: inputPerMTok, outputPerMTok and, for
// prompt caching, cacheReadPerMTok, cacheWritePerMTok (5 minutes) and
// cacheWrite1hPerMTok (1 hour; Claude Code writes those). A model without a
// price (or with cache tokens but no cache price) is logged as unpriced and
// nothing is recorded: a cost too low would mislead more than none. The turn
// changed the ideas whose files changed since the last Stop (commits and the
// working tree); the cost is split evenly between them.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** Usage per model in transcript lines, each API message counted once. */
export function usageByModel(lines) {
  const seen = new Set();
  const byModel = {};
  for (const line of lines) {
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    const message = entry?.type === 'assistant' ? entry.message : null;
    if (!message?.usage || !message.model || seen.has(message.id)) continue;
    if (message.id) seen.add(message.id);
    const usage = (byModel[message.model] ??= { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0 });
    // Writes are split by lifetime where the transcript says so; otherwise they count as 5-minute writes.
    const written = message.usage.cache_creation_input_tokens ?? 0;
    const longLived = Math.min(written, message.usage.cache_creation?.ephemeral_1h_input_tokens ?? 0);
    usage.input += message.usage.input_tokens ?? 0;
    usage.output += message.usage.output_tokens ?? 0;
    usage.cacheRead += message.usage.cache_read_input_tokens ?? 0;
    usage.cacheWrite += written - longLived;
    usage.cacheWrite1h += longLived;
  }
  return byModel;
}

/** USD of that usage, or the models that have no (complete) price. */
export function priceUsage(byModel, prices) {
  let usd = 0;
  const unpriced = [];
  for (const [model, usage] of Object.entries(byModel)) {
    const price = prices?.[model];
    const needsCache = (usage.cacheRead > 0 && price?.cacheReadPerMTok === undefined)
      || (usage.cacheWrite > 0 && price?.cacheWritePerMTok === undefined)
      || (usage.cacheWrite1h > 0 && price?.cacheWrite1hPerMTok === undefined);
    if (!price || needsCache) {
      unpriced.push(model);
      continue;
    }
    usd += (usage.input * price.inputPerMTok + usage.output * price.outputPerMTok
      + usage.cacheRead * (price.cacheReadPerMTok ?? 0) + usage.cacheWrite * (price.cacheWritePerMTok ?? 0)
      + usage.cacheWrite1h * (price.cacheWrite1hPerMTok ?? 0)) / 1_000_000;
  }
  return { usd, unpriced };
}

const IDEA_FILE = /^\.bowman\/ideas\/([0-9a-f-]{36})\.json$/;

/**
 * Ideas the turn changed since `since` (ISO time): their files differ from the
 * state at that time, in commits or in the working tree. A change of
 * realizedCostUsd or of a connection's reflection alone is not the turn's work on it.
 */
export function changedIdeas(repoRoot, since) {
  const git = (...args) => execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const committed = git('log', `--since=${since}`, '--name-only', '--format=', '--', '.bowman/ideas').split('\n');
  const working = git('status', '--porcelain', '--untracked-files=all', '--', '.bowman/ideas').split('\n').map(line => line.slice(3));
  const candidates = [...new Set([...committed, ...working].map(file => file.trim()).filter(file => IDEA_FILE.test(file)))];
  const before = git('rev-list', '-1', `--before=${since}`, 'HEAD').trim();
  // Neither the recorder's own write nor a reflection on a connection (stored
  // in the parent's file while the turn worked on the child) is work on the idea.
  const withoutCost = (text) => {
    try {
      const { realizedCostUsd: _cost, supportingConnections, ...rest } = JSON.parse(text);
      const connections = (supportingConnections ?? []).map(({ reflection: _reflection, ...connection }) => connection);
      return JSON.stringify({ ...rest, supportingConnections: connections });
    } catch {
      return text;
    }
  };
  const read = (file) => { try { return fs.readFileSync(path.join(repoRoot, file), 'utf8'); } catch { return ''; } };
  const earlier = (file) => { try { return before ? git('show', `${before}:${file}`) : ''; } catch { return ''; } };
  return candidates.filter(file => withoutCost(read(file)) !== withoutCost(earlier(file))).map(file => IDEA_FILE.exec(file)[1]);
}

async function main() {
  const repoRoot = process.argv[2];
  const event = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  const transcript = event.transcript_path;
  const session = event.session_id;
  if (!repoRoot || !transcript || !session || !fs.existsSync(transcript)) return;

  const runtime = path.join(repoRoot, '.bowman', 'runtime');
  const stateFile = path.join(runtime, 'session-costs.json');
  const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : {};
  const previous = state[session];
  const content = fs.readFileSync(transcript, 'utf8');
  const fresh = content.slice(previous?.offset ?? 0);
  const firstTime = JSON.parse(content.split('\n').find(Boolean) ?? '{}').timestamp;
  const since = previous?.stoppedAt ?? firstTime ?? new Date().toISOString();
  state[session] = { offset: content.length, stoppedAt: new Date().toISOString() };
  fs.mkdirSync(runtime, { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n');

  const byModel = usageByModel(fresh.split('\n'));
  if (Object.keys(byModel).length === 0) return;
  const prices = (() => {
    try { return JSON.parse(fs.readFileSync(path.join(repoRoot, '.bowman', 'harness.json'), 'utf8')).prices; } catch { return undefined; }
  })();
  const { usd, unpriced } = priceUsage(byModel, prices);
  const ideas = changedIdeas(repoRoot, since);
  const log = (text) => fs.appendFileSync(path.join(runtime, 'session-costs.log'), `${new Date().toISOString()} ${session} ${text}\n`);
  const tokens = Object.entries(byModel).map(([model, u]) => `${model} ${u.input}+${u.cacheRead}r+${u.cacheWrite}w+${u.cacheWrite1h}w1h in/${u.output} out`).join(', ');
  if (unpriced.length > 0) return log(`${tokens}; no price in .bowman/harness.json for ${unpriced.join(', ')}: nothing recorded`);
  if (ideas.length === 0 || usd <= 0) return log(`${tokens}; $${usd.toFixed(4)}, no idea changed: nothing recorded`);

  const base = `http://localhost:${process.env.PORT_BACKEND_HTTP || '3000'}`;
  const share = usd / ideas.length;
  for (const ideaId of ideas) {
    const response = await fetch(`${base}/idea.addRealizedCost`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ space: repoRoot, ideaId, usd: share })
    }).catch(error => ({ ok: false, statusText: String(error) }));
    if (!response.ok) log(`could not record $${share.toFixed(4)} on ${ideaId}: ${response.status ?? ''} ${response.statusText}`);
  }
  log(`${tokens}; $${usd.toFixed(4)} split over ${ideas.length} idea(s): ${ideas.join(' ')}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(() => {});
