<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

const props = defineProps<{
  socket: any;
  channelIn: string;
  channelOut?: string;
  resizeEvent?: string;
}>();

const terminalContainer = ref<HTMLElement | null>(null);
let term: Terminal;
let fitAddon: FitAddon;

onMounted(() => {
  console.log('TerminalComponent mounted');
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
    fitAddon.fit();
  }

  props.socket.on(props.channelIn, (data: string) => {
    term.write(data, () => {
        term.scrollToBottom();
    });
  });

  if (props.channelOut) {
    term.onData((data) => {
      props.socket.emit(props.channelOut, data);
    });
  }

  window.addEventListener('resize', () => {
    fitAddon.fit();
    if (props.resizeEvent) {
      props.socket.emit(props.resizeEvent, { cols: term.cols, rows: term.rows });
    }
  });
  
  // Initial size
  if (props.resizeEvent) {
      setTimeout(() => props.socket.emit(props.resizeEvent, { cols: term.cols, rows: term.rows }), 100);
  }
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
