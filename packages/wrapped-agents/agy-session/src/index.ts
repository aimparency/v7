import { startSession } from '@aimparency/wrapped-agents-common';
import { agyProfile } from './profile';

startSession(agyProfile, { packageDir: __dirname, defaultCompactEvery: 20 });
