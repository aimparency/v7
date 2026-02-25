<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick } from 'vue'
import { trpc } from '../trpc'
import { useUIProjectStore } from '../stores/project-store'

const projectStore = useUIProjectStore()

const isListening = ref(false)
const transcript = ref('')
const responseText = ref('')
const error = ref('')

interface Message {
  role: 'user' | 'assistant'
  text: string
  timestamp: number
}

const history = ref<Message[]>([])
const chatHistoryRef = ref<HTMLElement | null>(null)

const scrollToBottom = async () => {
  await nextTick()
  if (chatHistoryRef.value) {
    chatHistoryRef.value.scrollTop = chatHistoryRef.value.scrollHeight
  }
}

const clearHistory = () => {
  history.value = []
  responseText.value = ''
  transcript.value = ''
}

// Check for Web Speech API support
const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
const recognition = SpeechRecognition ? new SpeechRecognition() : null

if (recognition) {
  recognition.continuous = false
  recognition.interimResults = true
  recognition.lang = 'en-US'

  recognition.onresult = (event: any) => {
    transcript.value = Array.from(event.results)
      .map((result: any) => result[0])
      .map(result => result.transcript)
      .join('')
  }

  recognition.onerror = (event: any) => {
    error.value = 'Speech recognition error: ' + event.error
    isListening.value = false
  }

  recognition.onend = () => {
    isListening.value = false
    if (transcript.value) {
      handleTranscript(transcript.value)
    }
  }
}

const toggleListening = () => {
  if (!recognition) {
    error.value = 'Speech recognition not supported in this browser.'
    return
  }

  if (isListening.value) {
    recognition.stop()
  } else {
    // Cancel any ongoing speech
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel()
    }
    transcript.value = ''
    responseText.value = ''
    error.value = ''
    isListening.value = true
    recognition.start()
  }
}

const handleTranscript = async (text: string) => {
  // Add user message to history
  history.value.push({
    role: 'user',
    text,
    timestamp: Date.now()
  })
  scrollToBottom()

  try {
    // Call the backend voice chat endpoint
    const result = await trpc.voice.chat.mutate({
      projectPath: projectStore.projectPath,
      transcript: text
    })

    responseText.value = result.response
    
    // Add assistant response to history
    history.value.push({
      role: 'assistant',
      text: result.response,
      timestamp: Date.now()
    })
    scrollToBottom()

    speak(responseText.value)
  } catch (err: any) {
    error.value = 'Error processing voice command: ' + err.message
  }
}

const speak = (text: string) => {
  if ('speechSynthesis' in window) {
    const utterance = new SpeechSynthesisUtterance(text)
    window.speechSynthesis.speak(utterance)
  }
}

onUnmounted(() => {
  if (recognition) {
    recognition.stop()
  }
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel()
  }
})
</script>

<template>
  <div class="voice-view">
    <div class="voice-container">
      <div class="status-indicator" :class="{ listening: isListening }">
        <div class="mic-icon" @click="toggleListening">
          🎤
        </div>
        <p v-if="isListening" class="pulse-text">Listening...</p>
        <p v-else>Tap to Speak</p>
      </div>

      <div class="chat-container" v-if="history.length > 0">
        <div class="chat-header">
          <h3>Conversation</h3>
          <button @click="clearHistory" class="clear-btn">Clear</button>
        </div>
        <div class="chat-history" ref="chatHistoryRef">
          <div 
            v-for="msg in history" 
            :key="msg.timestamp" 
            class="message"
            :class="msg.role"
          >
            <div class="message-bubble">
              {{ msg.text }}
            </div>
          </div>
        </div>
      </div>

      <div class="error-message" v-if="error">
        {{ error }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.voice-view {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #1a1a1a;
  color: white;
  min-height: 0;
  overflow-y: auto;
}

.voice-container {
  max-width: 600px;
  width: 90%;
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 2rem;
  padding: 2rem 0;
}

.status-indicator {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
}

.mic-icon {
  font-size: 4rem;
  width: 120px;
  height: 120px;
  border-radius: 50%;
  background: #2d2d2d;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
  box-shadow: 0 10px 30px rgba(0,0,0,0.5);
  border: 4px solid #444;
}

.mic-icon:hover {
  background: #3d3d3d;
  transform: scale(1.05);
  border-color: #007acc;
}

.listening .mic-icon {
  background: #ff4444;
  border-color: #ff6666;
  animation: pulse 1.5s infinite;
}

@keyframes pulse {
  0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(255, 68, 68, 0.6); }
  70% { transform: scale(1.1); box-shadow: 0 0 0 25px rgba(255, 68, 68, 0); }
  100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(255, 68, 68, 0); }
}

.pulse-text {
  color: #ff4444;
  font-weight: bold;
  animation: textPulse 1s infinite alternate;
}

@keyframes textPulse {
  from { opacity: 0.6; }
  to { opacity: 1; }
}

.chat-container {
  display: flex;
  flex-direction: column;
  background: #252525;
  border-radius: 12px;
  border: 1px solid #333;
  box-shadow: 0 4px 15px rgba(0,0,0,0.2);
  overflow: hidden;
}

.chat-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid #333;
  background: #2a2a2a;
}

.chat-header h3 {
  margin: 0;
}

.clear-btn {
  background: transparent;
  border: 1px solid #444;
  color: #888;
  padding: 0.2rem 0.6rem;
  border-radius: 4px;
  font-size: 0.8rem;
  cursor: pointer;
}

.clear-btn:hover {
  background: #333;
  color: #e0e0e0;
}

.chat-history {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  max-height: 400px;
  overflow-y: auto;
  padding: 1rem;
}

.message {
  display: flex;
  width: 100%;
}

.message.user {
  justify-content: flex-end;
}

.message.assistant {
  justify-content: flex-start;
}

.message-bubble {
  max-width: 80%;
  padding: 0.8rem 1.2rem;
  border-radius: 18px;
  font-size: 1rem;
  line-height: 1.4;
}

.user .message-bubble {
  background: #007acc;
  color: white;
  border-bottom-right-radius: 4px;
}

.assistant .message-bubble {
  background: #3d3d3d;
  color: #e0e0e0;
  border-bottom-left-radius: 4px;
}

.error-message {
  color: #ff6666;
  font-size: 0.9rem;
  background: rgba(255, 102, 102, 0.1);
  padding: 1rem;
  border-radius: 8px;
  border: 1px solid rgba(255, 102, 102, 0.2);
}
</style>
