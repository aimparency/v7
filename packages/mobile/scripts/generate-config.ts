import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ASSETS_DIR = path.resolve(__dirname, '../app/src/main/assets');
const CONFIG_FILE = path.join(ASSETS_DIR, 'config.json');

function getLocalIp() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]!) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return '127.0.0.1';
}

async function run() {
    const ip = getLocalIp();
    const projectPath = path.resolve(__dirname, '../../../.bowman');
    
    const config = {
        serverUrl: `http://${ip}:5005`,
        projectPath: projectPath,
        generatedAt: new Date().toISOString()
    };

    await fs.ensureDir(ASSETS_DIR);
    await fs.writeJson(CONFIG_FILE, config, { spaces: 2 });
    
    console.log(`[MobileConfig] Generated config with IP: ${ip}`);
    console.log(`[MobileConfig] Path: ${CONFIG_FILE}`);
}

run().catch(console.error);
