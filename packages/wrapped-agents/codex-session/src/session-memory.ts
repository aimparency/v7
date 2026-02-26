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
