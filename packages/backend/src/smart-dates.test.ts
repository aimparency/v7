import { test } from 'node:test';
import assert from 'node:assert';
import path from 'path';
import fs from 'fs-extra';
import { v4 as uuidv4 } from 'uuid';
import { appRouter } from './server.js';

const TMP_DIR = path.join(process.cwd(), '.test-tmp', uuidv4(), '.bowman');
const createCaller = () => appRouter.createCaller({});

test('Smart Subphase Date Calculation - "Departure from Augsburg" Case', async (t) => {
    const caller = createCaller();
    await fs.ensureDir(TMP_DIR);

    const PARENT_FROM = 1767567600000;
    const PARENT_TO = 1768345200000;
    
    // Sib 1 (Montag)
    const SIB1_FROM = 1767567600000;
    const SIB1_TO = 1767654000000;

    // Sib 2 (Dienstag)
    const SIB2_FROM = 1767654000000;
    const SIB2_TO = 1767740400000;

    // Create Parent
    const parent = await caller.phase.create({
        projectPath: TMP_DIR,
        phase: { name: 'Parent', from: PARENT_FROM, to: PARENT_TO }
    });

    // Create Siblings
    await caller.phase.create({
        projectPath: TMP_DIR,
        phase: { name: 'Montag', from: SIB1_FROM, to: SIB1_TO, parent: parent.id }
    });
    
    await caller.phase.create({
        projectPath: TMP_DIR,
        phase: { name: 'Dienstag', from: SIB2_FROM, to: SIB2_TO, parent: parent.id }
    });

    // Request Suggestion
    const suggestion = await caller.phase.suggestSubPhaseConfig({
        projectPath: TMP_DIR,
        parentPhaseId: parent.id
    });

    console.log('Suggestion:', suggestion);
    console.log('Expected Start:', SIB2_TO);
    
    assert.strictEqual(suggestion.from, SIB2_TO, `Expected start at ${SIB2_TO}, got ${suggestion.from}`);

    await fs.remove(path.dirname(TMP_DIR));
});