# Mobile: Native Android Voice Interface

Conversational voice interface for Aimparency v7, built with Kotlin and Jetpack Compose.

## Architecture
- `app/`: Main Android application module.
- `core-network/`: Kotlin-based tRPC/WebSocket client for state sync.
- `core-voice/`: STT (Speech-to-Text) and TTS (Text-to-Speech) implementation.
- `ui-voice/`: Minimalist, voice-first UI components.

## Tech Stack
- **Language:** Kotlin
- **UI Framework:** Jetpack Compose
- **Network:** OkHttp / custom tRPC bridge
- **Voice:** Android Speech Recognizer / Google Cloud TTS
