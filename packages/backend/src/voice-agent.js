import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);
import path from 'path';
import { AIMPARENCY_DIR_NAME } from 'shared';
export async function chatWithGemini(transcript, projectPath) {
    const bowmanPath = projectPath.endsWith(AIMPARENCY_DIR_NAME) ? projectPath : path.join(projectPath, AIMPARENCY_DIR_NAME);
    // Basic implementation placeholder
    return `Echo: ${transcript}`;
}
