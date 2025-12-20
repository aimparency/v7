import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function chatWithGemini(transcript: string, projectPath: string): Promise<string> {
  // Normalize project path for the tool calls
  const bowmanPath = projectPath.endsWith('.bowman') ? projectPath : `${projectPath}/.bowman`;

  const systemPrompt = `You are the voice interface for Aimparency, a goal-tracking and agency-building system.
The user is interacting via voice. Keep your responses concise, conversational, and direct.
You have access to MCP tools to manage aims and phases.
Current project path: ${bowmanPath}
User says: "${transcript}"`;

  try {
    // We use the 'gemini' CLI as a one-shot command.
    // It should have access to the same tools and context.
    const { stdout, stderr } = await execAsync(`gemini "${systemPrompt}"`);
    
    if (stderr && !stdout) {
      console.error('[VoiceAgent] Gemini CLI Error:', stderr);
      return "I'm sorry, I encountered an error while processing your request.";
    }

    return stdout.trim();
  } catch (error) {
    console.error('[VoiceAgent] Execution failed:', error);
    return "I'm having trouble connecting to my brain right now.";
  }
}
