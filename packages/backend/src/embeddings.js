import fs from 'fs-extra';
import path from 'path';
const PORT = process.env.PORT_EMBEDDER || '3003';
const EMBEDDER_URL = `http://127.0.0.1:${PORT}/embed`;
export async function generateEmbedding(text) {
    try {
        // Basic retry logic could go here, but for now fail fast
        const response = await fetch(EMBEDDER_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text })
        });
        if (!response.ok) {
            console.warn(`Embedder service returned ${response.status}: ${response.statusText}`);
            return null;
        }
        const data = await response.json();
        return data.embedding;
    }
    catch (error) {
        console.warn('Embedder service unreachable. Is it running?');
        return null;
    }
}
async function getVectorStorePath(projectPath) {
    return path.join(projectPath, 'vectors.json');
}
// Cache per project
const vectorCache = new Map();
export async function loadVectorStore(projectPath) {
    if (vectorCache.has(projectPath)) {
        return vectorCache.get(projectPath);
    }
    const storePath = await getVectorStorePath(projectPath);
    let store = {};
    if (await fs.pathExists(storePath)) {
        store = await fs.readJson(storePath);
    }
    vectorCache.set(projectPath, store);
    return store;
}
export async function saveEmbedding(projectPath, aimId, vector) {
    try {
        const store = await loadVectorStore(projectPath);
        store[aimId] = vector;
        // Cache is updated by reference
        const storePath = await getVectorStorePath(projectPath);
        await fs.writeJson(storePath, store);
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            console.warn(`Failed to save embedding: Project directory might have been deleted (${projectPath})`);
        }
        else {
            console.error('Error saving embedding:', error);
        }
    }
}
export async function removeEmbedding(projectPath, aimId) {
    const store = await loadVectorStore(projectPath);
    if (store[aimId]) {
        delete store[aimId];
        const storePath = await getVectorStorePath(projectPath);
        await fs.writeJson(storePath, store);
    }
}
function cosineSimilarity(a, b) {
    if (a.length !== b.length || a.length === 0)
        return 0;
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        const valA = a[i];
        const valB = b[i];
        if (valA !== undefined && valB !== undefined) {
            dotProduct += valA * valB;
            normA += valA * valA;
            normB += valB * valB;
        }
    }
    if (normA === 0 || normB === 0)
        return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
export async function searchVectors(projectPath, queryVector, limit = 10) {
    const store = await loadVectorStore(projectPath);
    const results = [];
    for (const [id, vector] of Object.entries(store)) {
        const score = cosineSimilarity(queryVector, vector);
        results.push({ id, score });
    }
    return results.sort((a, b) => b.score - a.score).slice(0, limit);
}
