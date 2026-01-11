import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Constants matching broker/src/index.ts
const HTTP_PORT = parseInt(process.env.PORT_BROKER_HTTP || '5000');
const BASE_URL = `http://localhost:${HTTP_PORT}/trpc`;

// Paths
const WRAPPER_DIR = path.resolve(__dirname, '../../../');
const SESSIONS_FILE = path.join(WRAPPER_DIR, 'watchdog-sessions.json');

async function listViaBroker() {
  try {
    const response = await fetch(`${BASE_URL}/watchdog.list`);
    if (!response.ok) {
        throw new Error(`Broker returned ${response.status}`);
    }
    const json = await response.json();
    const sessions = (json as any).result?.data || [];
    
    if (sessions.length === 0) {
        console.log('Broker reports no active sessions.');
    } else {
        console.log(`Broker reports ${sessions.length} active sessions:`);
        console.table(sessions);
    }
    return true;
  } catch (e) {
    if ((e as any)?.cause?.code === 'ECONNREFUSED' || (e as any).message.includes('fetch failed')) {
        // Broker down, fallback
        return false;
    } else {
        console.error('Error communicating with broker:', e);
        // If it's a different error, we still might want to check the file, 
        // but explicitly state the broker error.
        return false;
    }
  }
}

async function listFromFile() {
    console.log('Broker unreachable. Checking local sessions file...');
    if (fs.existsSync(SESSIONS_FILE)) {
        try {
            const data = fs.readJsonSync(SESSIONS_FILE);
            if (!Array.isArray(data) || data.length === 0) {
                console.log('Sessions file is empty.');
                return;
            }
            
            console.log(`Found ${data.length} sessions in file (status unknown without broker):`);
            // Add a "Status" column to indicate these are from file/potentially stale
            const displayData = data.map(s => ({ ...s, source: 'FILE (Process status unchecked)' }));
            console.table(displayData);
        } catch (e) {
            console.error('Error reading sessions file:', e);
        }
    } else {
        console.log('No sessions file found.');
    }
}

async function main() {
    const success = await listViaBroker();
    if (!success) {
        await listFromFile();
    }
}

main().catch(console.error);
