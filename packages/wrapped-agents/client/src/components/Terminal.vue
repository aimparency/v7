<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

const props = defineProps<{
  socket: any;
  channelIn: string;
  channelOut?: string;
  resizeEvent?: string;
  snapshotEvent?: string;
}>();

const terminalContainer = ref<HTMLElement | null>(null);
const copyFeedback = ref<'idle' | 'ok' | 'fail'>('idle');
let term: Terminal;
let fitAddon: FitAddon;
let resizeDebounce: ReturnType<typeof setTimeout> | undefined;

function announceSize() {
  fitAddon.fit();
  if (props.resizeEvent) {
    props.socket.emit(props.resizeEvent, { cols: term.cols, rows: term.rows });
  }
}

function onWindowResize() {
  clearTimeout(resizeDebounce);
  resizeDebounce = setTimeout(announceSize, 100);
}

function getBufferText(): string {
  if (!term) return '';
  const buffer = term.buffer.active;
  let output = '';
  for (let i = 0; i < buffer.length; i++) {
    const line = buffer.getLine(i);
    if (!line) continue;
    const nextLine = i + 1 < buffer.length ? buffer.getLine(i + 1) : null;
    const text = line.translateToString(!(nextLine?.isWrapped ?? false));
    if (line.isWrapped) {
      output += text;
    } else {
      if (output.length > 0) output += '\n';
      output += text;
    }
  }
  return output;
}

async function copyContent() {
  const text = getBufferText();
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    copyFeedback.value = 'ok';
  } catch {
    copyFeedback.value = 'fail';
  }
  setTimeout(() => { copyFeedback.value = 'idle'; }, 1500);
}

onMounted(() => {
  term = new Terminal({
    cursorBlink: true,
    theme: { background: '#000000' },
    fontFamily: 'monospace',
    fontSize: 11
  });
  fitAddon = new FitAddon();
  term.loadAddon(fitAddon);

  if (terminalContainer.value) {
    term.open(terminalContainer.value);
  }

  props.socket.on(props.channelIn, (data: string) => {
    // Only stick to the bottom if the user is already there; otherwise let them
    // read scrollback without being yanked down on every chunk.
    const atBottom = term.buffer.active.viewportY >= term.buffer.active.baseY;
    term.write(data, () => {
      if (atBottom) term.scrollToBottom();
    });
  });

  if (props.snapshotEvent) {
    // The one-shot replay snapshot is the authoritative current frame. Live
    // `channelIn` data may already have raced ahead of it (the server's repaint
    // perturbation streams incremental redraws into our still-empty buffer), so
    // reset first to wipe that garble, then write the faithful snapshot. Socket
    // ordering guarantees any post-snapshot live data arrives after and appends.
    props.socket.on(props.snapshotEvent, (data: string) => {
      term.reset();
      term.write(data, () => {
        // On a fresh mount (e.g. switching sessions), xterm's DOM renderer can
        // land this write before its char dimensions are measured: the buffer
        // fills but the screen stays blank until the next write forces a paint.
        // Force a full repaint of the viewport once the snapshot has parsed.
        term.refresh(0, term.rows - 1);
        term.scrollToBottom();
      });
    });
  }

  if (props.channelOut) {
    term.onData((data) => {
      props.socket.emit(props.channelOut, data);
    });
  }

  window.addEventListener('resize', onWindowResize);

  // Fit, then announce our real size up front. The server defers the replay
  // snapshot until it knows this size, so both ends agree on dimensions before
  // any data is written — no 80x24-then-reflow garble.
  announceSize();
});

onUnmounted(() => {
  clearTimeout(resizeDebounce);
  window.removeEventListener('resize', onWindowResize);
  term?.dispose();
});
</script>

<template>
  <div ref="terminalContainer" class="terminal-container">
    <div class="copy-buttons" @mousedown.prevent>
      <button
        class="copy-btn"
        :title="copyFeedback === 'ok' ? 'Copied!' : copyFeedback === 'fail' ? 'Copy failed' : 'Copy entire browser terminal scrollback'"
        @click.stop="copyContent"
      >{{ copyFeedback === 'ok' ? '✓' : copyFeedback === 'fail' ? '✗' : 'copy term content' }}</button>
    </div>
  </div>
</template>

<style scoped>
.terminal-container {
  position: relative;
  width: 100%;
  height: 100%;
  background: black;
}

.copy-buttons {
  position: absolute;
  top: 0.4rem;
  right: 0.4rem;
  z-index: 10;
  display: flex;
  flex-direction: row-reverse;
  gap: 0.35rem;
}

.copy-btn {
  padding: 0.2rem 0.5rem;
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 0.35rem;
  background: #000000b3;
  color: #ccc;
  font-size: 0.7rem;
  font-family: monospace;
  cursor: pointer;
}

.copy-btn:hover {
  background: #1f2937;
  color: #fff;
}

/* Custom Scrollbar */
:deep(.xterm-viewport)::-webkit-scrollbar {
  width: 10px;
}
:deep(.xterm-viewport)::-webkit-scrollbar-track {
  background: #1e1e1e;
}
:deep(.xterm-viewport)::-webkit-scrollbar-thumb {
  background: #444;
  border-radius: 5px;
}
:deep(.xterm-viewport)::-webkit-scrollbar-thumb:hover {
  background: #666;
}
</style>
