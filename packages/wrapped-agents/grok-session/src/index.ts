import { startSession } from '@aimparency/wrapped-agents-common';
import { grokProfile } from './profile';

startSession(grokProfile, { packageDir: __dirname, defaultCompactEvery: 20 });
