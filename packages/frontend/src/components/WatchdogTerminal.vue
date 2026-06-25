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

// Mobile-only helper for keystrokes Android keyboards don't expose (Esc, Ctrl).
// Collapsed to a single button that expands into a small key menu.
const keysOpen = ref(false);
const ctrlArmed = ref(false);
const PAGE_UP = '\x1b[5~';
const PAGE_DOWN = '\x1b[6~';
const ARROW_UP = '\x1b[A';
const ARROW_DOWN = '\x1b[B';
const ARROW_RIGHT = '\x1b[C';
const ARROW_LEFT = '\x1b[D';
const sendKey = (seq: string) => {
  props.onData?.(seq);
  // Keep the terminal focused so the soft keyboard stays up after tapping a key.
  term?.focus();
};

// Routes all terminal input. When Ctrl is armed, fold the next single typed
// character into its control code (Ctrl+C -> 0x03, etc.) and disarm. Multi-char
// input (escape sequences, paste) passes through untouched but still disarms.
const handleTermData = (data: string) => {
  if (ctrlArmed.value) {
    ctrlArmed.value = false;
    if (data.length === 1) {
      props.onData?.(String.fromCharCode(data.toUpperCase().charCodeAt(0) & 0x1f));
      return;
    }
  }
  props.onData?.(data);
};

let term: Terminal;
let fitAddon: FitAddon;
let resizeObserver: ResizeObserver;
let scrollTimeout: any = null;

// Touch scrolling. xterm only handles touch when the app has NO mouse tracking,
// and even then only scrolls its own scrollback viewport — it never forwards
// touch to the app. Full-screen TUIs run in the alt buffer WITH mouse tracking,
// so xterm ignores touch there entirely. The wheel, however, IS routed through
// xterm's mouse service (which is why wheel-scroll works on desktop). So we
// replay the vertical drag as a `wheel` event on xterm's own element and let its
// native wheel handling encode it correctly — SGR mouse-wheel to the TUI in the
// alt buffer, scrollback in the normal buffer. No bespoke key translation.
let touchLastY: number | null = null;
let touchAccumY = 0;

// Approx pixel height of one terminal row — one wheel tick per row dragged.
const rowPx = () => {
  const h = terminalContainer.value?.clientHeight ?? 0;
  const rows = term?.rows ?? 0;
  return rows > 0 && h > 0 ? h / rows : 18;
};

const handleTouchStart = (e: TouchEvent) => {
  touchLastY = e.touches.length === 1 ? e.touches[0].clientY : null;
  touchAccumY = 0;
};

const dispatchWheelLine = (dir: -1 | 1, t: Touch) => {
  // xterm binds wheel on its root `.xterm` element; dispatch there so its native
  // wheel handler fires. LINE mode (deltaMode 1) is the key: xterm rounds
  // sub-line PIXEL deltas to zero and forwards nothing, but a whole-line tick is
  // always forwarded — as an SGR mouse-wheel event to a mouse-tracking TUI, or a
  // scrollback line in the normal buffer.
  const xtermEl = terminalContainer.value?.querySelector('.xterm') as HTMLElement | null;
  if (!xtermEl) return;
  xtermEl.dispatchEvent(new WheelEvent('wheel', {
    deltaY: dir,
    deltaMode: 1, // lines
    clientX: t.clientX,
    clientY: t.clientY,
    bubbles: false,
    cancelable: true,
  }));
};

const handleTouchMove = (e: TouchEvent) => {
  if (touchLastY === null || e.touches.length !== 1) return;
  const t = e.touches[0];
  touchAccumY += t.clientY - touchLastY;
  touchLastY = t.clientY;
  e.preventDefault(); // own the gesture so the browser doesn't steal it mid-drag

  // Emit one line-wheel per row dragged. Finger down (accum > 0) reveals older
  // content = wheel up (deltaY -1); finger up = wheel down (+1).
  const step = rowPx();
  while (touchAccumY >= step) { dispatchWheelLine(-1, t); touchAccumY -= step; }
  while (touchAccumY <= -step) { dispatchWheelLine(1, t); touchAccumY += step; }
};

const handleTouchEnd = () => { touchLastY = null; touchAccumY = 0; };

const BRACKETED_PASTE_START = '\x1b[200~';
const BRACKETED_PASTE_END = '\x1b[201~';

// Reads the system clipboard and sends it as a bracketed paste (mobile menu).
const pasteFromClipboard = async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (!text) return;
    const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    props.onData?.(`${BRACKETED_PASTE_START}${normalized}${BRACKETED_PASTE_END}`);
  } catch {
    // Clipboard read blocked (permissions / insecure context) — ignore.
  }
  term?.focus();
};

const emit = defineEmits<{
  (e: 'resize', dimensions: { cols: number, rows: number }): void
}>();

const write = (data: string) => {
  term?.write(data);
};

const focus = () => {
  term?.focus();
};

const clear = () => {
  term?.clear();
};

const handlePaste = (event: ClipboardEvent) => {
  if (!props.onData) return;

  const pastedText = event.clipboardData?.getData('text/plain');
  if (!pastedText) return;

  event.preventDefault();
  event.stopPropagation();

  const normalizedText = pastedText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  props.onData(`${BRACKETED_PASTE_START}${normalizedText}${BRACKETED_PASTE_END}`);
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
    terminalContainer.value.addEventListener('paste', handlePaste, true);
    terminalContainer.value.addEventListener('touchstart', handleTouchStart, { passive: true });
    terminalContainer.value.addEventListener('touchmove', handleTouchMove, { passive: false });
    terminalContainer.value.addEventListener('touchend', handleTouchEnd, { passive: true });
    terminalContainer.value.addEventListener('touchcancel', handleTouchEnd, { passive: true });
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

  term.onData(handleTermData);

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
  terminalContainer.value?.removeEventListener('paste', handlePaste, true);
  terminalContainer.value?.removeEventListener('touchstart', handleTouchStart);
  terminalContainer.value?.removeEventListener('touchmove', handleTouchMove);
  terminalContainer.value?.removeEventListener('touchend', handleTouchEnd);
  terminalContainer.value?.removeEventListener('touchcancel', handleTouchEnd);
  resizeObserver?.disconnect();
  term?.dispose();
});

defineExpose({
  write,
  fit,
  focus,
  clear
});
</script>

<template>
  <div ref="terminalContainer" class="terminal-container" @click="focus">
    <!-- Touch-only keystroke helper: keys Android keyboards can't send. -->
    <!-- mousedown.prevent keeps focus in xterm's hidden input so the keyboard stays open. -->
    <div class="mobile-keys" @mousedown.prevent>
      <button
        class="key-fab"
        :class="{ open: keysOpen }"
        :aria-expanded="keysOpen"
        title="Insert keystroke"
        @click="keysOpen = !keysOpen"
      >⌨</button>
      <template v-if="keysOpen">
        <button class="key-btn" @click="sendKey('\u001b')">Esc</button>
        <button
          class="key-btn"
          :class="{ armed: ctrlArmed }"
          @click="ctrlArmed = !ctrlArmed"
        >Ctrl</button>
        <button class="key-btn" @click="sendKey(PAGE_UP)">PgUp</button>
        <button class="key-btn" @click="sendKey(PAGE_DOWN)">PgDn</button>
        <div class="arrow-pad">
          <button class="key-btn arrow up" @click="sendKey(ARROW_UP)">↑</button>
          <button class="key-btn arrow left" @click="sendKey(ARROW_LEFT)">←</button>
          <button class="key-btn arrow down" @click="sendKey(ARROW_DOWN)">↓</button>
          <button class="key-btn arrow right" @click="sendKey(ARROW_RIGHT)">→</button>
        </div>
        <button class="key-btn" @click="pasteFromClipboard">Paste</button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.terminal-container {
  position: relative;
  width: 100%;
  height: 100%;
  background: #1e1e1e;
  overflow: hidden;
  padding: 0.5rem;
  box-sizing: border-box;
  /* We drive scrolling ourselves from touchmove; tell the browser not to claim
     drags for native panning/zoom, which otherwise steals the gesture mid-drag. */
  touch-action: none;
}

/* The element the finger actually lands on is xterm's .xterm-viewport, which is
   `overflow-y: scroll` (a scroll container) with the default touch-action: auto.
   The browser honors the touched element's own touch-action, so it starts
   panning the viewport, steals the touch (touchcancel), and our drag dies after
   one move. Force touch-action: none on xterm's inner elements too. */
.terminal-container :deep(.xterm),
.terminal-container :deep(.xterm-viewport),
.terminal-container :deep(.xterm-screen) {
  touch-action: none;
}

/* Keystroke helper — hidden on devices with a precise pointer (desktop),
   shown only on touch devices where Esc/Enter aren't on the soft keyboard. */
.mobile-keys {
  display: none;
}

@media (pointer: coarse) {
  .mobile-keys {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.3rem;
    position: absolute;
    top: 0.4rem;
    left: 0.4rem;
    z-index: 10;
  }
}

.key-fab,
.key-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 2.4rem;
  height: 2.4rem;
  padding: 0 0.6rem;
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 0.4rem;
  background: #000000b3;
  color: #fff;
  font-size: 0.85rem;
  line-height: 1;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.key-fab {
  font-size: 1.1rem;
}

.key-fab.open,
.key-btn.armed {
  background: #2563eb;
  border-color: #2563eb;
}

.key-btn {
  font-weight: 600;
}

/* Arrow cluster: a compact cross laid out on a 3x3 grid. */
.arrow-pad {
  display: grid;
  grid-template-columns: repeat(3, 2.4rem);
  grid-template-rows: repeat(2, 2.4rem);
  gap: 0.2rem;
}

.arrow {
  min-width: 0;
  width: 2.4rem;
  padding: 0;
  font-size: 1.1rem;
}

.arrow.up { grid-column: 2; grid-row: 1; }
.arrow.left { grid-column: 1; grid-row: 2; }
.arrow.down { grid-column: 2; grid-row: 2; }
.arrow.right { grid-column: 3; grid-row: 2; }

.key-btn:active,
.key-fab:active {
  background: #1d4ed8;
}
</style>
