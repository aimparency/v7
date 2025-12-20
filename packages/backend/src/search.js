import { Document } from 'flexsearch';
// FlexSearch indices per project
const aimIndices = new Map();
const phaseIndices = new Map();
// ... existing getAimIndex ...
function getAimIndex(projectPath) {
    if (!aimIndices.has(projectPath)) {
        const index = new Document({
            document: {
                id: 'id',
                index: ['text', 'status.state']
            },
            tokenize: 'full',
            cache: true
        });
        aimIndices.set(projectPath, index);
    }
    return aimIndices.get(projectPath);
}
// ... existing getPhaseIndex ...
function getPhaseIndex(projectPath) {
    if (!phaseIndices.has(projectPath)) {
        const index = new Document({
            document: {
                id: 'id',
                index: ['name']
            },
            tokenize: 'forward',
            context: {
                resolution: 9,
                depth: 3,
                bidirectional: true
            }
        });
        phaseIndices.set(projectPath, index);
    }
    return phaseIndices.get(projectPath);
}
// ... existing index/update/remove functions ...
export function indexAims(projectPath, aims) {
    const index = getAimIndex(projectPath);
    for (const aim of aims)
        index.remove(aim.id);
    for (const aim of aims)
        index.add(aim);
}
export function indexPhases(projectPath, phases) {
    const index = getPhaseIndex(projectPath);
    for (const phase of phases)
        index.remove(phase.id);
    for (const phase of phases)
        index.add(phase);
}
export function addAimToIndex(projectPath, aim) {
    const index = getAimIndex(projectPath);
    index.add(aim);
}
export function updateAimInIndex(projectPath, aim) {
    const index = getAimIndex(projectPath);
    index.update(aim);
}
export function removeAimFromIndex(projectPath, aimId) {
    const index = getAimIndex(projectPath);
    index.remove(aimId);
}
export function addPhaseToIndex(projectPath, phase) {
    const index = getPhaseIndex(projectPath);
    index.add(phase);
}
export function updatePhaseInIndex(projectPath, phase) {
    const index = getPhaseIndex(projectPath);
    index.update(phase);
}
export function removePhaseFromIndex(projectPath, phaseId) {
    const index = getPhaseIndex(projectPath);
    index.remove(phaseId);
}
// Search aims by text (FlexSearch)
export async function searchAims(projectPath, query, allAims) {
    if (!query.trim()) {
        return []; // Return empty if no query, consistent with search behavior
    }
    const index = getAimIndex(projectPath);
    const results = await index.searchAsync(query, { limit: 100 });
    // FlexSearch returns array of results with field name
    const aimIds = new Set();
    const scores = new Map();
    // Aggregate results and assign scores based on rank
    let rank = 0;
    for (const result of results) {
        if (Array.isArray(result.result)) {
            result.result.forEach(id => {
                const aimId = id;
                if (!aimIds.has(aimId)) {
                    aimIds.add(aimId);
                    // Synthetic score: 1.0 for top result, decaying by 0.05
                    scores.set(aimId, Math.max(0.1, 1.0 - (rank * 0.05)));
                    rank++;
                }
            });
        }
    }
    // Return aims in order of search results with scores
    return allAims
        .filter(aim => aimIds.has(aim.id))
        .map(aim => ({
        ...aim,
        score: scores.get(aim.id)
    }))
        .sort((a, b) => (b.score || 0) - (a.score || 0));
}
// Search phases by name (FlexSearch)
export async function searchPhases(projectPath, query, allPhases) {
    if (!query.trim()) {
        return allPhases;
    }
    const index = getPhaseIndex(projectPath);
    const results = await index.searchAsync(query, { limit: 100 });
    // FlexSearch returns array of results with field name
    const phaseIds = new Set();
    for (const result of results) {
        if (Array.isArray(result.result)) {
            result.result.forEach(id => phaseIds.add(id));
        }
    }
    // Return phases in order of search results
    return allPhases.filter(phase => phaseIds.has(phase.id));
}
// Clear indices for a project (e.g., when project is closed)
export function clearIndices(projectPath) {
    aimIndices.delete(projectPath);
    phaseIndices.delete(projectPath);
}
