import { startSession } from '@aimparency/wrapped-agents-common';
import { geminiProfile } from './profile';

startSession(geminiProfile, { packageDir: __dirname, defaultCompactEvery: 20 });
