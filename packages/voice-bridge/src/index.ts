import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import OpenAI from 'openai';
import textToSpeech from '@google-cloud/text-to-speech';
import cors from 'cors';
import dotenv from 'dotenv';
import { trpc } from './client.js'; // I'll need to create this tRPC client

dotenv.config();

const app = express();
app.use(cors());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Clients
const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey || apiKey === 'sk-or-placeholder') {
  console.error('[VoiceBridge] CRITICAL: OPENROUTER_API_KEY is missing or invalid in .env!');
} else {
  console.log(`[VoiceBridge] API Key loaded (starts with ${apiKey.substring(0, 10)}...)`);
}

const openai = new OpenAI({
  apiKey: apiKey || 'sk-or-placeholder',
  baseURL: 'https://openrouter.ai/api/v1',
  defaultHeaders: {
    'HTTP-Referer': 'https://aimparency.com',
    'X-Title': 'Aimparency v7 Voice Bridge',
    'Authorization': `Bearer ${apiKey}`
  }
});

const ttsClient = new textToSpeech.TextToSpeechClient();

// System Prompt
const SYSTEM_PROMPT = `
You are the Aimparency Life Strategist, a conversational voice assistant.
Your goal is to help the user manage their aims, prioritize tasks, and achieve their goals.
You have access to the user's Aimparency project via tools.
Keep your responses concise and natural for voice interaction.
If the user mentions an aim, you can look it up or update its status.
`;

const TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "list_aims",
      description: "List aims in the project. Can filter by status or phase.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", description: "Filter by status (open, done, etc.)" },
          phaseId: { type: "string", description: "Filter by phase UUID" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_prioritized_aims",
      description: "Get prioritized aims from the current active phase.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max results" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "create_aim",
      description: "Create a new aim.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Aim description" },
          phaseId: { type: "string", description: "Optional phase UUID" }
        },
        required: ["text"]
      }
    }
  }
];

async function handleToolCall(name: string, args: any, projectPath: string) {
  console.log(`[VoiceBridge] Tool Call: ${name}`, args);
  try {
    switch (name) {
      case 'list_aims':
        return await trpc.aim.list.query({ projectPath, ...args });
      case 'get_prioritized_aims': {
        // Fetch aims with open status
        const aims = await trpc.aim.list.query({ 
          projectPath, 
          status: 'open',
          sortBy: 'priority',
          sortOrder: 'desc',
          limit: args.limit || 5
        });
        return aims;
      }
      case 'create_aim': {
        const res = await trpc.aim.createFloatingAim.mutate({ 
          projectPath, 
          aim: { 
            text: args.text,
            status: { state: 'open' }
          } 
        });
        if (args.phaseId) {
            await trpc.aim.commitToPhase.mutate({ projectPath, aimId: res.id, phaseId: args.phaseId });
        }
        return res;
      }
      default:
        throw new Error(`Tool ${name} not implemented in bridge`);
    }
  } catch (e: any) {
    console.error(`[VoiceBridge] Tool execution error:`, e);
    return { error: e.message };
  }
}

io.on('connection', (socket) => {
  console.log('[VoiceBridge] Mobile Client connected');

  socket.on('user-transcript', async (data: { transcript: string, projectPath: string }) => {
    console.log(`[VoiceBridge] User said: ${data.transcript}`);
    
    try {
      let messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: data.transcript }
      ];

      // 1. Initial Request
      let response = await openai.chat.completions.create({
        model: 'anthropic/claude-3-haiku',
        messages,
        tools: TOOLS,
        tool_choice: 'auto'
      });

      let aiMessage = response.choices[0]?.message;

      // 2. Handle Tool Calls
      while (aiMessage?.tool_calls) {
        messages.push(aiMessage);
        
        for (const toolCall of aiMessage.tool_calls) {
          const result = await handleToolCall(
            toolCall.function.name, 
            JSON.parse(toolCall.function.arguments),
            data.projectPath
          );
          
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(result)
          });
        }

        response = await openai.chat.completions.create({
          model: 'anthropic/claude-3-haiku',
          messages,
          tools: TOOLS
        });
        aiMessage = response.choices[0]?.message;
      }

      const aiText = aiMessage?.content || '';
      console.log(`[VoiceBridge] AI Final Response: ${aiText}`);

      // 3. Sentence-by-sentence TTS Streaming
      // Note: Full streaming requires more complex buffer management, 
      // but we can simulate it by splitting into sentences for lower "time-to-first-audio".
      const sentences = aiText.match(/[^.!?]+[.!?]+/g) || [aiText];
      
      for (const sentence of sentences) {
          const trimmed = sentence.trim();
          if (!trimmed) continue;

          const [ttsResponse] = await ttsClient.synthesizeSpeech({
            input: { text: trimmed },
            voice: { name: 'en-US-Chirp3-HD-Orus', languageCode: 'en-US' },
            audioConfig: { audioEncoding: 'MP3' },
          });

          // 4. Send chunk back to client
          socket.emit('ai-audio-chunk', {
            text: trimmed,
            audio: ttsResponse.audioContent
          });
      }

      // Signal completion
      socket.emit('ai-response-complete');

    } catch (e: any) {
      console.error('[VoiceBridge] Error processing request:', e);
      socket.emit('error', { message: e.message });
    }
  });

  socket.on('disconnect', () => {
    console.log('[VoiceBridge] Mobile Client disconnected');
  });
});

const PORT = process.env.PORT_VOICE_BRIDGE || 5005;
httpServer.listen(PORT, () => {
  console.log(`[VoiceBridge] Running on http://localhost:${PORT}`);
});
