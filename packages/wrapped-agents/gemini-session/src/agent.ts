import * as pty from 'node-pty';
import { Terminal } from '@xterm/headless';

export class Agent {
  ptyProcess: pty.IPty;
  terminal: Terminal;
  
  constructor(cwd: string, args: string[], onData: (data: string) => void) {
    this.ptyProcess = pty.spawn('gemini', args, {
      name: 'xterm-color',
      cols: 120,
      rows: 30,
      cwd: cwd,
      env: process.env as any
    });

    this.terminal = new Terminal({
      cols: 120,
      rows: 30,
      allowProposedApi: true
    });

    this.ptyProcess.onData((data) => {
      this.terminal.write(data);
      onData(data);
    });

    this.ptyProcess.onExit((e) => {
      console.log(`[Agent] Process exited with code ${e.exitCode}, signal ${e.signal}`);
    });
  }

  write(data: string) {
    this.ptyProcess.write(data);
  }

  resize(cols: number, rows: number) {
    try {
      if (cols > 0 && rows > 0) {
        this.ptyProcess.resize(cols, rows);
        this.terminal.resize(cols, rows);
      }
    } catch (e) {
      // Ignore resize errors
    }
  }

  kill() {
    this.ptyProcess.kill();
  }

  getLines(count: number): string {
    const buffer = this.terminal.buffer.active;
    
    // Use cursor position to determine the end of the content of interest
    // This ensures we capture what is currently "active" or "visible" at the bottom
    const cursorIndex = buffer.baseY + buffer.cursorY;
    
    const end = Math.min(cursorIndex + 1, buffer.length);
    const start = Math.max(0, end - count);
    
    let output = '';
    for (let i = start; i < end; i++) {
      const line = buffer.getLine(i);
      if (line) {
        output += line.translateToString(true) + '\n';
      }
    }
    return output.trim();
  }
  
  getLastLine(): string {
    const buffer = this.terminal.buffer.active;
    // Get the line at the cursor
    const y = buffer.cursorY + buffer.baseY;
    const line = buffer.getLine(y);
    return line ? line.translateToString(true) : '';
  }
}