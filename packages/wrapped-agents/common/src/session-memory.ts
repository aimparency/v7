import * as fs from 'fs-extra';
import * as path from 'path';
import { Agent } from './agent';

export interface SessionSummary {
  sessionId: string;
  timestamp: number;
  duration: number;
  aimsWorked: string[];
  outcomes: string;
  patterns: string;
  lessonsLearned: string;
  /** What system/tooling limitations held the session back. Optional: older
   * summaries predate this field. */
  systemLimitations?: string;
  rawReflection: string;
}

/**
 * Reflection fields the supervisor can attach to its compact decision (approach
 * B: folded into the WRAPPING_UP/compact action JSON, no extra round-trip). All
 * optional — when omitted, extractReflection falls back to its heuristic
 * scrollback capture so the live path is unchanged.
 */
export interface ReflectionInput {
  patterns?: string;
  lessonsLearned?: string;
  systemLimitations?: string;
}

export class SessionMemory {
  private projectPath: string;
  private sessionId: string;
  private sessionStartTime: number;

  constructor(projectPath: string) {
    this.projectPath = projectPath;
    this.sessionId = this.generateSessionId();
    this.sessionStartTime = Date.now();
  }

  private generateSessionId(): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const random = Math.random().toString(36).slice(2, 8);
    return `${timestamp}-${random}`;
  }

  private getMemoryDir(): string {
    return path.join(this.projectPath, '.bowman', 'memory', 'sessions');
  }

  private getSessionPath(): string {
    return path.join(this.getMemoryDir(), `${this.sessionId}.json`);
  }

  /**
   * Build the session summary saved at compaction time.
   *
   * aimsWorked / outcomes / rawReflection are heuristically extracted from the
   * worker's terminal scrollback. patterns / lessonsLearned / systemLimitations
   * come from the supervisor's own reflection when it attaches them to the
   * compact decision (approach B) — far higher signal than scrollback. When the
   * supervisor omits them they stay '' (the previous behavior), so the live path
   * is never blocked by a missing or malformed reflection.
   */
  async extractReflection(
    worker: Agent,
    watchdog: Agent,
    reflection?: ReflectionInput
  ): Promise<SessionSummary | null> {
    try {
      const workerContext = worker.getLines(100);

      const summary: SessionSummary = {
        sessionId: this.sessionId,
        timestamp: this.sessionStartTime,
        duration: Date.now() - this.sessionStartTime,
        aimsWorked: this.extractAimIds(workerContext),
        outcomes: this.extractOutcomes(workerContext),
        patterns: reflection?.patterns?.trim() ?? '',
        lessonsLearned: reflection?.lessonsLearned?.trim() ?? '',
        systemLimitations: reflection?.systemLimitations?.trim() ?? '',
        rawReflection: workerContext.slice(-2000) // Last 2000 chars
      };

      return summary;
    } catch (error) {
      console.error('[SessionMemory] Failed to extract reflection:', error);
      return null;
    }
  }

  /**
   * Extract aim IDs from worker output
   */
  private extractAimIds(context: string): string[] {
    const aimIds: string[] = [];
    // Match UUID patterns (aim IDs)
    const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
    const matches = context.match(uuidRegex);
    if (matches) {
      // Deduplicate
      return Array.from(new Set(matches));
    }
    return aimIds;
  }

  /**
   * Extract outcome summary from worker output
   */
  private extractOutcomes(context: string): string {
    // Look for markers of completed work
    const lines = context.split('\n').slice(-50); // Last 50 lines

    // Look for test results, completion messages, etc.
    const outcomeMarkers = [
      /tests? (?:passed|failed|complete)/i,
      /successfully/i,
      /completed/i,
      /implemented/i,
      /fixed/i,
      /updated aim status/i,
      /marked aim .* as done/i
    ];

    const relevantLines = lines.filter(line =>
      outcomeMarkers.some(marker => marker.test(line))
    );

    return relevantLines.slice(-5).join(' | ').slice(0, 500);
  }

  /**
   * Save session summary to disk
   */
  async saveSummary(summary: SessionSummary): Promise<void> {
    try {
      const memoryDir = this.getMemoryDir();
      await fs.ensureDir(memoryDir);

      const sessionPath = this.getSessionPath();
      await fs.writeJson(sessionPath, summary, { spaces: 2 });

      console.log(`[SessionMemory] Saved session summary: ${sessionPath}`);

      // Wire the (previously dead) compression: after each save, opportunistically
      // compress old sessions to keep memory bounded. Errors are non-fatal.
      SessionMemory.compressOldSessions(this.projectPath).catch(err =>
        console.error('[SessionMemory] Post-save compression failed (non-fatal):', err)
      );
    } catch (error) {
      console.error('[SessionMemory] Failed to save summary:', error);
    }
  }

  /**
   * Load recent session summaries
   */
  static async loadRecentSummaries(projectPath: string, limit: number = 5): Promise<SessionSummary[]> {
    try {
      const memoryDir = path.join(projectPath, '.bowman', 'memory', 'sessions');

      if (!await fs.pathExists(memoryDir)) {
        return [];
      }

      const files = await fs.readdir(memoryDir);
      const jsonFiles = files
        .filter(f => f.endsWith('.json'))
        .sort()
        .reverse()
        .slice(0, limit);

      const summaries: SessionSummary[] = [];
      for (const file of jsonFiles) {
        try {
          const filePath = path.join(memoryDir, file);
          const summary = await fs.readJson(filePath);
          summaries.push(summary);
        } catch (error) {
          console.warn(`[SessionMemory] Failed to load ${file}:`, error);
        }
      }

      return summaries;
    } catch (error) {
      console.error('[SessionMemory] Failed to load recent summaries:', error);
      return [];
    }
  }

  /**
   * Format recent summaries for injection into INSTRUCT.md context
   */
  static formatForContext(summaries: SessionSummary[]): string {
    if (summaries.length === 0) {
      return '';
    }

    const lines = ['## Previous Session Insights\n'];

    for (const summary of summaries) {
      const date = new Date(summary.timestamp).toISOString().slice(0, 16).replace('T', ' ');
      const durationMins = Math.round(summary.duration / 60000);

      if (summary.sessionId.startsWith('meta-')) {
        lines.push(`**Meta-summary from ${summaries.length} sessions** (${date}):`);
        if (summary.rawReflection) {
          lines.push(`  - ${summary.rawReflection.slice(0, 300)}`);
        }
        lines.push('');
        continue;
      }

      lines.push(`**Session ${date}** (${durationMins}min):`);

      if (summary.outcomes) {
        lines.push(`  - Outcomes: ${summary.outcomes.slice(0, 200)}`);
      }

      if (summary.aimsWorked.length > 0) {
        lines.push(`  - Aims: ${summary.aimsWorked.slice(0, 3).join(', ')}`);
      }

      if (summary.patterns) {
        lines.push(`  - Pattern: ${summary.patterns.slice(0, 200)}`);
      }

      if (summary.lessonsLearned) {
        lines.push(`  - Lesson: ${summary.lessonsLearned.slice(0, 200)}`);
      }

      if (summary.systemLimitations) {
        lines.push(`  - System limitation: ${summary.systemLimitations.slice(0, 200)}`);
      }

      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Resolve the durable supervisor-errors.log directory. Mirrors the path used
   * by WatchdogService.logErrorDiagnostics so the reader and writer agree.
   */
  static getErrorLogDir(): string {
    return process.env.WATCHDOG_LOG_DIR || path.resolve(__dirname, '../../logs');
  }

  /**
   * Collapse a raw ERROR-state reason into a stable bucket so recurring
   * failures aggregate instead of fragmenting on per-incident detail (elapsed
   * seconds, ids, etc.). Unknown reasons fall back to a trimmed snippet.
   */
  static normalizeFrictionReason(reason: string): string {
    const r = reason.toLowerCase();
    if (/quota|usage limit|rate.?limit/.test(r)) return 'quota / usage-limit';
    if (/model switch|model.?switch|downgrad|wrong model/.test(r)) return 'model switch';
    if (/busy|frozen|static screen/.test(r)) return 'busy-timeout (worker frozen)';
    if (/stuck|no response|unresponsive/.test(r)) return 'worker stuck / unresponsive';
    if (/timeout/.test(r)) return 'timeout';
    if (/parse|invalid json|malformed/.test(r)) return 'supervisor response parse failure';
    if (/max.?retries|retry ceiling/.test(r)) return 'retry ceiling reached';
    const trimmed = reason.trim().replace(/\s+/g, ' ');
    return trimmed.length > 48 ? `${trimmed.slice(0, 48)}…` : (trimmed || 'unknown');
  }

  /**
   * Aggregate the recent ERROR-state records from supervisor-errors.log into a
   * compact "system friction" block the next session can learn from. Unlike the
   * heuristic scrollback reflection, this is real structured limitation data
   * (busy timeouts, stuck workers, quota hits, parse failures) — the input a
   * recursive self-improvement loop needs to decide what to fix about itself.
   * Returns '' when there is nothing useful to report.
   */
  static async summarizeRecentFriction(
    logDir: string = SessionMemory.getErrorLogDir(),
    limit: number = 30
  ): Promise<string> {
    try {
      const logPath = path.join(logDir, 'supervisor-errors.log');
      if (!await fs.pathExists(logPath)) return '';

      const raw = await fs.readFile(logPath, 'utf8');
      const lines = raw.split('\n').filter(line => line.trim().length > 0);
      const recent = lines.slice(-limit);

      const byReason = new Map<string, number>();
      let parsed = 0;
      for (const line of recent) {
        try {
          const record = JSON.parse(line) as { reason?: string };
          const bucket = SessionMemory.normalizeFrictionReason(record.reason || 'unknown');
          byReason.set(bucket, (byReason.get(bucket) ?? 0) + 1);
          parsed++;
        } catch {
          // Skip a malformed/partial line rather than failing the whole summary.
        }
      }

      if (parsed === 0) return '';

      const ranked = [...byReason.entries()].sort((a, b) => b[1] - a[1]);
      const items = ranked.map(([reason, count]) => `${reason} ×${count}`).join(', ');

      let summaryText = [
        '## Recent System Friction',
        '',
        `The autonomous loop hit ${parsed} error event(s) recently — treat these as system limitations to design around or fix at the source:`,
        `- ${items}`,
        ''
      ].join('\n');

      // Auto-propose improvement aim for dominant friction (implements the "Close the recursive loop" aim).
      // When retry ceiling (or other dominant) is top, direct the loop (LLM agent) to use create_aim MCP tool
      // to propose a concrete fix in wrapped-agents instead of just retrying. This closes identify→apply.
      const top = ranked[0];
      if (top && top[0] === 'retry ceiling reached') {
        summaryText += '\n\n**AUTO-PROPOSE ACTION**: Dominant friction "retry ceiling reached". Use the create_aim MCP tool to create an improvement aim under the self-reflection/system-limitation aim (b03ad58e-4518-455f-8a35-36f58eb8ee7d) or "Close the recursive loop" parent. Suggested text: "Fix recurring retry ceiling friction in supervisor by extending BACKOFF_SCHEDULE=[1,2,4,8,15] or adding circuit-breaker/reset logic after N consecutive ERRORs in supervisor-state.ts + prompts. Avoid hitting ceiling by better recovery." Cost: 2. This addresses the limitation at the source in wrapped-agents.';
      } else if (top) {
        summaryText += '\n\nIf one failure dominates, use create_aim MCP tool to open a specific aim in wrapped-agents/common or kennel to fix the root cause rather than just retrying.';
      }

      return summaryText;
    } catch {
      return '';
    }
  }

  /**
   * Perform recursive compression: compress N session summaries into one meta-summary.
   * Heuristic implementation (real LLM summarization can be injected by the
   * autonomous loop using MCP/LLM tools when this detects the need). Keeps the
   * most recent summaries uncompressed; creates meta-summaries for older batches
   * and prunes the originals. This bounds .bowman/memory/sessions growth.
   */
  static async compressOldSessions(projectPath: string, threshold: number = 10, llmSummarizer?: (summaries: SessionSummary[]) => Promise<Partial<Pick<SessionSummary, 'outcomes' | 'patterns' | 'lessonsLearned' | 'systemLimitations' | 'rawReflection'>>> ): Promise<void> {
    try {
      let summaries = await SessionMemory.loadRecentSummaries(projectPath, 100);

      if (summaries.length < threshold) {
        return; // Not enough to compress yet
      }

      // Sort oldest first
      summaries = summaries.sort((a, b) => a.timestamp - b.timestamp);

      const keepUncompressed = 5;
      if (summaries.length <= keepUncompressed) {
        return;
      }

      const toCompress = summaries.slice(0, summaries.length - keepUncompressed);
      if (toCompress.length === 0) return;

      const memoryDir = path.join(projectPath, '.bowman', 'memory', 'sessions');
      await fs.ensureDir(memoryDir);

      // Use LLM summarizer if provided (via existing agent or MCP tools to produce
      // coherent meta from the batch). Otherwise heuristic.
      let metaOutcomes = toCompress.map(s => s.outcomes || '').filter(Boolean).join(' || ').slice(0, 600);
      let metaPatterns = toCompress.map(s => s.patterns || '').filter(Boolean).join(' | ').slice(0, 400);
      let metaLessons = toCompress.map(s => s.lessonsLearned || '').filter(Boolean).join(' | ').slice(0, 400);
      let metaLimits = toCompress.map(s => s.systemLimitations || '').filter(Boolean).join(' | ').slice(0, 400);
      let metaRaw = `Meta-summary compressed from ${toCompress.length} prior sessions (oldest first). Key signals aggregated from outcomes/patterns/lessons/limitations.`;

      if (llmSummarizer) {
        try {
          const llmMeta = await llmSummarizer(toCompress);
          metaOutcomes = llmMeta.outcomes || metaOutcomes;
          metaPatterns = llmMeta.patterns || metaPatterns;
          metaLessons = llmMeta.lessonsLearned || metaLessons;
          metaLimits = llmMeta.systemLimitations || metaLimits;
          metaRaw = llmMeta.rawReflection || metaRaw;
        } catch (e) {
          console.error('[SessionMemory] LLM summarizer failed, falling back to heuristic', e);
        }
      }

      // Build a meta-summary (LLM or heuristic "compression")
      const meta: SessionSummary = {
        sessionId: `meta-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: Date.now(),
        duration: toCompress.reduce((sum, s) => sum + (s.duration || 0), 0),
        aimsWorked: Array.from(new Set(toCompress.flatMap(s => s.aimsWorked || []))),
        outcomes: metaOutcomes,
        patterns: metaPatterns,
        lessonsLearned: metaLessons,
        systemLimitations: metaLimits,
        rawReflection: metaRaw
      };

      const metaPath = path.join(memoryDir, `${meta.sessionId}.json`);
      await fs.writeJson(metaPath, meta, { spaces: 2 });

      // Prune the compressed originals
      for (const old of toCompress) {
        const oldPath = path.join(memoryDir, `${old.sessionId}.json`);
        if (await fs.pathExists(oldPath)) {
          await fs.remove(oldPath);
        }
      }

      console.log(`[SessionMemory] Compressed ${toCompress.length} old sessions into meta-summary ${meta.sessionId}.`);

      // Recursive: check again after pruning
      await SessionMemory.compressOldSessions(projectPath, threshold, llmSummarizer);
    } catch (error) {
      console.error('[SessionMemory] Failed to compress old sessions:', error);
    }
  }
}
