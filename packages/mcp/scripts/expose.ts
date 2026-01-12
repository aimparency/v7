import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MCP_PORT = process.env.MCP_PORT || 3005;

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

  function printConnectionInfo(url: string) {
    const username = process.env.MCP_USERNAME;
    const password = process.env.MCP_PASSWORD;
    
    let authUrl = url;
    if (username && password) {
        // Inject auth into URL: https://user:pass@host...
        authUrl = url.replace('https://', `https://${username}:${password}@`);
    }

    console.log('\n✨ MCP Server Exposed! ✨');
    console.log(`\n🔗 Public SSE Endpoint: ${authUrl}/sse`);
    
    if (username) {
        console.log(`🔒 Basic Auth Enabled: ${username}:******`);
    }

    console.log(`\nTo connect a remote agent, use this URL configuration:`);
    console.log(JSON.stringify({
        mcpServers: {
            aimparency: {
                url: `${authUrl}/sse`,
                transport: "sse"
            }
        }
    }, null, 2));
    console.log('\nPress Ctrl+C to stop.');
  }

  function startNgrok() {
    console.log('🌐 Starting ngrok tunnel...');
    
    if (process.env.NGROK_AUTHTOKEN) {
        console.log('🔑 Using NGROK_AUTHTOKEN from environment');
    } else {
        console.log('⚠️ NGROK_AUTHTOKEN not found in environment, relying on global config');
    }

    const ngrokArgs = ['http', String(MCP_PORT), '--log', 'stdout'];
    if (process.env.NGROK_AUTHTOKEN) {
        ngrokArgs.push('--authtoken', process.env.NGROK_AUTHTOKEN.trim());
    }
    
    // Add Basic Auth if provided
    if (process.env.MCP_USERNAME && process.env.MCP_PASSWORD) {
        ngrokArgs.push(`--basic-auth=${process.env.MCP_USERNAME}:${process.env.MCP_PASSWORD}`);
        console.log('🔒 Enabling Basic Auth');
    }

    const ngrok = spawn('ngrok', ngrokArgs, {
        stdio: ['ignore', 'pipe', 'pipe'] // Capture both stdout and stderr
    });

    ngrok.stdout?.on('data', (data) => {
      const msg = data.toString();
      // Look for url=https://...
      const match = msg.match(/url=(https:\/\/[^ ]+)/);
      if (match) {
        printConnectionInfo(match[1]);
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