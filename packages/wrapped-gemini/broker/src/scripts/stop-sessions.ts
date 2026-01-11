import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Constants matching broker/src/index.ts
const HTTP_PORT = parseInt(process.env.PORT_BROKER_HTTP || '5000');
const BASE_URL = `http://localhost:${HTTP_PORT}/trpc`;

// Paths
// Script location: packages/wrapped-gemini/broker/src/scripts/stop-sessions.ts
// Target: packages/wrapped-gemini/watchdog-sessions.json
const WRAPPER_DIR = path.resolve(__dirname, '../../../');
const SESSIONS_FILE = path.join(WRAPPER_DIR, 'watchdog-sessions.json');

async function stopViaBroker() {
  console.log('Attempting to contact Watchdog Broker...');
  try {
    const response = await fetch(`${BASE_URL}/watchdog.list`);
    if (!response.ok) {
        // If 404 or other error, assume broker might be reachable but something is wrong.
        // But usually connection refused is what throws.
        throw new Error(`Broker returned ${response.status}`);
    }
    const json = await response.json();
    // TRPC success response structure: { result: { data: [...] } }
    const sessions = (json as any).result?.data || [];
    
    console.log(`Broker reported ${sessions.length} active sessions.`);
    
    for (const session of sessions) {
        console.log(`Stopping session ${session.projectPath} (PID ${session.pid})...`);
        const stopRes = await fetch(`${BASE_URL}/watchdog.stop`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectPath: session.projectPath })
        });
        if (stopRes.ok) {
            console.log(`✅ Stopped ${session.projectPath}`);
        } else {
            console.error(`❌ Failed to stop ${session.projectPath}`);
        }
    }
    return true;
  } catch (e) {
    // Check if error is connection refused
    if ((e as any)?.cause?.code === 'ECONNREFUSED' || (e as any).message.includes('fetch failed')) {
        console.log('Could not connect to broker (it seems to be down).');
    } else {
        console.log('Error communicating with broker:', e);
    }
    return false;
  }
}

async function cleanUpFile() {
    console.log('Checking sessions file for manual cleanup...');
    if (fs.existsSync(SESSIONS_FILE)) {
        try {
            const data = fs.readJsonSync(SESSIONS_FILE);
            console.log(`Found ${data.length} sessions in file.`);
            
            for (const s of data) {
                console.log(`Killing PID ${s.pid} for ${s.projectPath}...`);
                try {
                    // Try killing process group first (negative PID)
                    try {
                        process.kill(-s.pid, 'SIGTERM');
                    } catch (e) {
                         // Fallback to PID
                         process.kill(s.pid, 'SIGTERM');
                    }
                    console.log(`✅ Killed PID ${s.pid}`);
                } catch (e: any) {
                    if (e.code === 'ESRCH') {
                        console.log(`⚠️ PID ${s.pid} already dead.`);
                    } else {
                        console.error(`❌ Failed to kill PID ${s.pid}:`, e.message);
                    }
                }
            }
            
            console.log('Clearing sessions file...');
            fs.writeJsonSync(SESSIONS_FILE, []);
        } catch (e) {
            console.error('Error processing sessions file:', e);
        }
    } else {
        console.log('No sessions file found.');
    }
}

async function main() {
    const success = await stopViaBroker();
    if (!success) {
        await cleanUpFile();
    }
}

main().catch(console.error);
