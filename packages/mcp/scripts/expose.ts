import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MCP_PORT = 3005;

async function main() {
  console.log('🚀 Starting Aimparency MCP Server in SSE Mode...');

  // 1. Start MCP Server (SSE)
  // We run 'tsx src/sse.ts' directly
  const sseScript = path.resolve(__dirname, '../src/sse.ts');
  
  const mcp = spawn('npx', ['tsx', sseScript], {
    env: { ...process.env, MCP_PORT: String(MCP_PORT) },
    cwd: path.resolve(__dirname, '..'),
    stdio: ['ignore', 'pipe', 'inherit'] // Capture stdout for logging
  });

  let ngrokStarted = false;

  mcp.stdout?.on('data', (data) => {
    const msg = data.toString();
    console.log(`[MCP] ${msg.trim()}`);
    
    if (msg.includes(`http://localhost:${MCP_PORT}/sse`) && !ngrokStarted) {
      ngrokStarted = true;
      startNgrok();
    }
  });

  function startNgrok() {
    console.log('🌐 Starting ngrok tunnel...');
    const ngrok = spawn('ngrok', ['http', String(MCP_PORT), '--log', 'stdout'], {
        stdio: ['ignore', 'pipe', 'pipe'] // Capture both stdout and stderr
    });

    ngrok.stdout?.on('data', (data) => {
      const msg = data.toString();
      // Look for url=https://...
      const match = msg.match(/url=(https:\/\/[^ ]+)/);
      if (match) {
        const url = match[1];
        console.log('\n✨ MCP Server Exposed! ✨');
        console.log(`\n🔗 Public SSE Endpoint: ${url}/sse`);
        console.log(`\nTo connect a remote agent, use this URL configuration:`);
        console.log(JSON.stringify({
            mcpServers: {
                aimparency: {
                    url: `${url}/sse`,
                    transport: "sse"
                }
            }
        }, null, 2));
        console.log('\nPress Ctrl+C to stop.');
      }
    });

    ngrok.stderr?.on('data', (data) => {
        const msg = data.toString();
        console.error(msg); // Pass through
        if (msg.includes("authentication failed")) {
            console.error("\n❌ Ngrok Authentication Failed!");
            console.error("Please add NGROK_AUTHTOKEN to your .env file or run:");
            console.error("  ngrok config add-authtoken <YOUR_TOKEN>");
            mcp.kill();
            process.exit(1);
        }
    });
    
    ngrok.on('exit', (code) => {
        console.log(`ngrok exited with code ${code}`);
        mcp.kill();
        process.exit();
    });
  }
  
  process.on('SIGINT', () => {
      console.log('\nStopping...');
      mcp.kill();
      process.exit();
  });
}

main();