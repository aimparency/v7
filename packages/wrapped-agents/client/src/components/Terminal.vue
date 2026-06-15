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
      term.write(data, () => term.scrollToBottom());
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
  <div ref="terminalContainer" class="terminal-container"></div>
</template>

<style scoped>
.terminal-container {
  width: 100%;
  height: 100%;
  background: black;
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
