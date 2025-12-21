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
let scrollTimeout: any = null;

const emit = defineEmits<{
  (e: 'resize', dimensions: { cols: number, rows: number }): void
}>();

const write = (data: string) => {
  term?.write(data);
};

const focus = () => {
  term?.focus();
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
    resizeObserver = new ResizeObserver(() => requestAnimationFrame(() => fit()));
    resizeObserver.observe(terminalContainer.value);
  }

  term.onScroll((newScrollPos) => {
    if (newScrollPos === 0) {
      if (scrollTimeout) clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        term.scrollToBottom();
        scrollTimeout = null;
      }, 200);
    } else {
      if (scrollTimeout) {
        clearTimeout(scrollTimeout);
        scrollTimeout = null;
      }
    }
  });

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
  if (!terminalContainer.value) return;
  if (terminalContainer.value.clientWidth === 0 || terminalContainer.value.clientHeight === 0) return;

  if (fitAddon) {
    try {
        fitAddon.fit();
        if (term) {
            emit('resize', { cols: term.cols, rows: term.rows });
            term.refresh(0, term.rows - 1);
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
  <div ref="terminalContainer" class="terminal-container" @click="focus"></div>
</template>

<style scoped>
.terminal-container {
  width: 100%;
  height: 100%;
  background: #1e1e1e;
  overflow: hidden;
  padding: 0.5rem;
  box-sizing: border-box;
}
</style>
