import { calculateIdeaValues } from 'shared';
import { onChange } from './change-events.js';
import { saveIdeaValues } from './db.js';
import { listIdeas } from './storage/ideas.js';

// Recalculation Queue
const recalculateTimers = new Map<string, NodeJS.Timeout>();

function triggerRecalculation(projectPath: string) {
  if (recalculateTimers.has(projectPath)) {
    clearTimeout(recalculateTimers.get(projectPath)!);
  }
  recalculateTimers.set(projectPath, setTimeout(async () => {
    try {
        const ideas = await listIdeas(projectPath);
        const result = calculateIdeaValues(ideas);
        
        const map = new Map();
        for (const [id, value] of result.values.entries()) {
            map.set(id, {
                value,
                cost: result.costs.get(id) || 0,
                doneCost: result.doneCosts.get(id) || 0,
                priority: result.priorities.get(id) || 0
            });
        }
        saveIdeaValues(projectPath, map);
        // console.log(`[ValueCalc] Updated values for ${projectPath}`);
    } catch (e) {
        console.error(`[ValueCalc] Failed to recalculate for ${projectPath}`, e);
    }
  }, 1000));
}

onChange(({ type, projectPath }) => {
    if (process.env.NODE_ENV === 'test') return;
    if (type === 'idea' || type === 'phase') {
        triggerRecalculation(projectPath);
    }
});
