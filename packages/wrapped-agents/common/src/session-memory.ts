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
  rawReflection: string;
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
   * Extract learning and reflection from worker before compaction
   */
  async extractReflection(worker: Agent, watchdog: Agent): Promise<SessionSummary | null> {
    try {
      // Get recent work context from worker
      const workerContext = worker.getLines(100);

      // Ask watchdog to reflect on the session
      const reflectionPrompt = `
You are reflecting on the autonomous work session that just completed.

Recent work output:
${workerContext}

Please provide a brief reflection in JSON format:
{
  "aimsWorked": ["list of aim IDs or descriptions worked on"],
  "outcomes": "brief summary of what was accomplished",
  "patterns": "any recurring patterns or insights noticed",
  "lessonsLearned": "what would you do differently next time"
}

Respond with ONLY the JSON object, no markdown, no code blocks.`;

      // Note: This is a simplified implementation that captures the context
      // A full implementation would need to wait for watchdog response
      // For now, we'll store the raw context and metadata

      const summary: SessionSummary = {
        sessionId: this.sessionId,
        timestamp: this.sessionStartTime,
        duration: Date.now() - this.sessionStartTime,
        aimsWorked: this.extractAimIds(workerContext),
        outcomes: this.extractOutcomes(workerContext),
        patterns: '',
        lessonsLearned: '',
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

      return [
        '## Recent System Friction',
        '',
        `The autonomous loop hit ${parsed} error event(s) recently — treat these as system limitations to design around or fix at the source:`,
        `- ${items}`,
        '',
        'If one failure dominates, consider opening an aim to address that limitation in the wrapped-agents package rather than just retrying through it.',
        ''
      ].join('\n');
    } catch {
      return '';
    }
  }

  /**
   * Perform recursive compression: compress N session summaries into one meta-summary
   */
  static async compressOldSessions(projectPath: string, threshold: number = 10): Promise<void> {
    try {
      const summaries = await SessionMemory.loadRecentSummaries(projectPath, 100);

      if (summaries.length < threshold) {
        return; // Not enough to compress yet
      }

      // TODO: Implement recursive compression
      // This would use an LLM call to compress multiple summaries into one meta-summary
      // For now, we'll just log that compression is needed
      console.log(`[SessionMemory] ${summaries.length} sessions exist. Compression recommended at ${threshold}.`);
    } catch (error) {
      console.error('[SessionMemory] Failed to compress old sessions:', error);
    }
  }
}
