import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

import path from 'path';
import { toBowmanPath } from 'shared';

export async function chatWithGemini(transcript: string, projectPath: string) {
  const bowmanPath = toBowmanPath(projectPath);
  
  // Basic implementation placeholder
  return `Echo: ${transcript}`;
}
