<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

const props = defineProps<{
  initialContent?: string;
  onData?: (data: string) => void;
  // We can pass a ref or a getter for content stream if needed, 
  // but simpler to expose a 'write' method or watch a prop.
  // For integration with store, we might want to watch a buffer?
  // Or better: the parent component subscribes to store and calls write.
}>();

const terminalContainer = ref<HTMLElement | null>(null);
let term: Terminal;
let fitAddon: FitAddon;
let resizeObserver: ResizeObserver;

const emit = defineEmits<{
  (e: 'resize', dimensions: { cols: number, rows: number }): void
}>();

const write = (data: string) => {
  term?.write(data);
};

onMounted(() => {
  term = new Terminal({
    cursorBlink: true,
    theme: { background: '#1e1e1e' }, // Match VS Code dark
    fontFamily: 'monospace',
    fontSize: 12,
    scrollback: 10000
  });
  fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  
  if (terminalContainer.value) {
    term.open(terminalContainer.value);
    fitAddon.fit();
    
    // Observer container resize
    resizeObserver = new ResizeObserver(() => fit());
    resizeObserver.observe(terminalContainer.value);
  }

  if (props.initialContent) {
    term.write(props.initialContent);
  }

  if (props.onData) {
    term.onData(props.onData);
  }

  // Fit initially after a tick
  setTimeout(fit, 100);
});

const fit = () => {
  if (fitAddon) {
    try {
        fitAddon.fit();
        if (term) {
            emit('resize', { cols: term.cols, rows: term.rows });
        }
    } catch(e) {
        // sizing errors can happen if container is hidden
    }
  }
}

onUnmounted(() => {
  resizeObserver?.disconnect();
  term?.dispose();
});

defineExpose({
  write,
  fit
});
</script>

<template>
  <div ref="terminalContainer" class="terminal-container"></div>
</template>

<style scoped>
.terminal-container {
  width: 100%;
  height: 100%;
  background: #1e1e1e;
  overflow: hidden;
}
</style>
