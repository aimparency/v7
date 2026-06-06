import { startSession } from '@aimparency/wrapped-agents-common';
import { claudeProfile } from './profile';

startSession(claudeProfile, { packageDir: __dirname, defaultCompactEvery: 20 });
