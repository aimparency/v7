import { startSession } from '@aimparency/wrapped-agents-common';
import { codexProfile } from './profile';

startSession(codexProfile, { packageDir: __dirname, defaultCompactEvery: 20 });
