package org.aimparency.v7

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.*
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.nio.charset.Charset
import java.util.*

import android.util.Log

class MainActivity : ComponentActivity() {
    private val TAG = "MainActivity"
    private lateinit var voiceClient: VoiceClient
    private var speechRecognizer: SpeechRecognizer? = null
    private val audioPlayer = AudioPlayer()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        // Load Dynamic Config
        val config = loadConfig()
        val serverUrl = config.optString("serverUrl", "http://127.0.0.1:5005")
        val projectPath = config.optString("projectPath", "")
        
        Log.d(TAG, "Config Loaded - Server: $serverUrl, Project: $projectPath")

        voiceClient = VoiceClient(serverUrl)

        setContent {
            var status by remember { mutableStateOf("Disconnected") }
            var lastAiText by remember { mutableStateOf("") }
            var isListening by remember { mutableStateOf(false) }
            var isUserStopped by remember { mutableStateOf(false) }
            // Track if the backend has finished sending the full response stream
            var isServerResponseComplete by remember { mutableStateOf(true) }
            val context = LocalContext.current

            val permissionLauncher = rememberLauncherForActivityResult(
                ActivityResultContracts.RequestPermission()
            ) { isGranted ->
                Log.d(TAG, "Permission Result: $isGranted")
                if (isGranted) {
                    isUserStopped = false
                    startListening(projectPath)
                    isListening = true
                }
            }

            DisposableEffect(Unit) {
                voiceClient.setCallback(object : VoiceClient.Callback {
                    override fun onConnect() { 
                        Log.i(TAG, "UI: Connected")
                        status = "Connected" 
                    }
                    override fun onDisconnect() { 
                        Log.w(TAG, "UI: Disconnected")
                        status = "Disconnected" 
                    }
                    override fun onError(message: String) { 
                        Log.e(TAG, "UI Error: $message")
                        status = "Error: $message" 
                    }
                    override fun onAudioChunk(text: String, audio: ByteArray?) {
                        Log.v(TAG, "UI: Received audio chunk: $text")
                        lastAiText = text
                        
                        // NOTE: We do NOT stop listening here anymore.
                        // We rely on AEC (Echo Cancellation) to filter this out,
                        // and onBeginningOfSpeech to trigger the interrupt if the user speaks.

                        audio?.let { audioPlayer.playChunk(it, context) }
                    }
                    override fun onResponseComplete() {
                        Log.d(TAG, "UI: Server response stream complete")
                        isServerResponseComplete = true
                        
                        // Ensure we are listening if we weren't already
                        Handler(Looper.getMainLooper()).post {
                            if (!isListening && !isUserStopped) {
                                Log.d(TAG, "Server done -> ensuring listener active")
                                startListening(projectPath)
                                isListening = true
                            }
                        }
                    }
                })
                
                audioPlayer.onPlaybackFinished = {
                    Log.d(TAG, "Playback finished. serverDone=$isServerResponseComplete")
                    // If we just finished playing and aren't listening for some reason, start now
                    if (!isListening && !isUserStopped) {
                         Handler(Looper.getMainLooper()).post {
                            startListening(projectPath)
                            isListening = true
                        }
                    }
                }

                speechRecognizer = SpeechRecognizer.createSpeechRecognizer(context).apply {
                    setRecognitionListener(object : RecognitionListener {
                        override fun onReadyForSpeech(params: Bundle?) { 
                            Log.d(TAG, "STT: Ready")
                            status = "Listening..."
                            isListening = true 
                        }
                        override fun onEndOfSpeech() { 
                            Log.d(TAG, "STT: End of speech")
                            // We don't set isListening=false here because we want to conceptually remain "in session"
                            // until we either get results or restart.
                            status = "Processing..." 
                        }
                        override fun onError(error: Int) { 
                            Log.e(TAG, "STT Error: $error")
                            status = "STT Error: $error"
                            isListening = false 
                            
                            // Restart on No Match / Timeout / Rec Error, even if AI is playing (to allow barge-in retry)
                            if (!isUserStopped && (error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT || error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY)) {
                                Log.d(TAG, "STT Error recoverable, restarting...")
                                Handler(Looper.getMainLooper()).postDelayed({
                                    startListening(projectPath)
                                }, 100)
                            }
                        }
                        override fun onResults(results: Bundle?) {
                            val matches = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                            val transcript = matches?.firstOrNull()
                            Log.i(TAG, "STT Result: $transcript")
                            
                            // Only send if we have actual content (strict check)
                            if (!transcript.isNullOrBlank() && transcript.length > 1) {
                                audioPlayer.stop() // Ensure audio stops if we actually got a result
                                isServerResponseComplete = false // Expecting new response
                                voiceClient.sendTranscript(transcript, projectPath)
                            } else {
                                Log.d(TAG, "Empty or short transcript, ignoring and restarting")
                                if (!isUserStopped) {
                                    startListening(projectPath)
                                }
                            }
                        }
                        override fun onBeginningOfSpeech() {
                            Log.d(TAG, "STT: User started speaking.")
                            // We do NOT stop audio here anymore. We wait for loudness (onRmsChanged).
                            status = "User speaking..."
                        }
                        override fun onRmsChanged(rmsdB: Float) {
                            // BARGE-IN THRESHOLD: 
                            // Only stop AI if user is speaking LOUDLY (approx > 8dB)
                            // This filters out background noise/breathing that AEC missed.
                            if (audioPlayer.isPlaying() && rmsdB > 8.0f) {
                                Log.d(TAG, "Barge-in Triggered! RMS: $rmsdB > 8.0")
                                audioPlayer.stop()
                            }
                        }
                        override fun onBufferReceived(buffer: ByteArray?) {}
                        override fun onPartialResults(partialResults: Bundle?) {
                            // If we get partial words, that's a definite interrupt
                            val partials = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                            if (!partials.isNullOrEmpty() && audioPlayer.isPlaying()) {
                                Log.d(TAG, "Partial results received, stopping playback.")
                                audioPlayer.stop()
                            }
                        }
                        override fun onEvent(eventType: Int, params: Bundle?) {}
                    })
                }

                onDispose { 
                    voiceClient.disconnect()
                    speechRecognizer?.destroy()
                    audioPlayer.release()
                }
            }

            MaterialTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = Color(0xFF121212)
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Column(
                            horizontalAlignment = Alignment.CenterHorizontally,
                            modifier = Modifier.padding(32.dp)
                        ) {
                            Text(
                                text = status.uppercase(),
                                color = if (isListening) Color(0xFF007ACC) else Color.Gray,
                                style = MaterialTheme.typography.labelMedium,
                                letterSpacing = 2.sp
                            )
                            
                            Spacer(modifier = Modifier.height(100.dp))

                            VoicePulse(isListening = isListening)

                            Spacer(modifier = Modifier.height(100.dp))

                            Text(
                                text = lastAiText,
                                color = Color.White,
                                style = MaterialTheme.typography.bodyLarge,
                                textAlign = TextAlign.Center,
                                modifier = Modifier.padding(horizontal = 16.dp)
                            )
                        }

                        if (status == "Disconnected") {
                            Button(
                                onClick = { 
                                    Log.d(TAG, "Initialize Connection clicked")
                                    isUserStopped = false
                                    voiceClient.connect() 
                                },
                                modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 64.dp),
                                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF007ACC))
                            ) {
                                Text("INITIALIZE CONNECTION")
                            }
                        } else if (!isListening && !status.startsWith("User") && !status.startsWith("Listening")) {
                             IconButton(
                                onClick = { 
                                    Log.d(TAG, "Mic clicked")
                                    isUserStopped = false
                                    if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                                        startListening(projectPath)
                                    } else {
                                        permissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
                                    }
                                },
                                modifier = Modifier
                                    .align(Alignment.BottomCenter)
                                    .padding(bottom = 64.dp)
                                    .size(72.dp)
                                    .background(Color(0xFF007ACC), CircleShape)
                            ) {
                                Text("🎤", fontSize = 24.sp)
                            }
                        } else {
                            // Stop Button
                             IconButton(
                                onClick = { 
                                    Log.d(TAG, "Stop clicked")
                                    isUserStopped = true
                                    audioPlayer.stop()
                                    speechRecognizer?.stopListening()
                                    isListening = false
                                    status = "Stopped"
                                },
                                modifier = Modifier
                                    .align(Alignment.BottomCenter)
                                    .padding(bottom = 64.dp)
                                    .size(72.dp)
                                    .background(Color(0xFFE57373), CircleShape)
                            ) {
                                Text("⏹", fontSize = 24.sp)
                            }
                        }
                    }
                }
            }
        }
    }

    private fun startListening(projectPath: String) {
        Log.d(TAG, "Starting Speech Recognition (Project: $projectPath)")
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault())
            putExtra("projectPath", projectPath)
        }
        speechRecognizer?.startListening(intent)
    }

    private fun loadConfig(): JSONObject {
        return try {
            val inputStream = assets.open("config.json")
            val size = inputStream.available()
            val buffer = ByteArray(size)
            inputStream.read(buffer)
            inputStream.close()
            val json = JSONObject(String(buffer, Charset.forName("UTF-8")))
            Log.d(TAG, "Raw config: $json")
            json
        } catch (e: Exception) {
            Log.e(TAG, "Error loading config: ${e.message}")
            JSONObject()
        }
    }
}

class AudioPlayer {
    private val TAG = "AudioPlayer"
    private val queue = mutableListOf<File>()
    private var mediaPlayer: MediaPlayer? = null
    private var isPlaying = false
    var onPlaybackFinished: (() -> Unit)? = null

    fun isPlaying(): Boolean {
        return synchronized(this) { isPlaying }
    }

    fun playChunk(audio: ByteArray, context: android.content.Context) {
        Log.v(TAG, "Queueing audio chunk (${audio.size} bytes)")
        val tempFile = File.createTempFile("tts_chunk_", ".mp3", context.cacheDir)
        FileOutputStream(tempFile).use { it.write(audio) }
        
        synchronized(this) {
            queue.add(tempFile)
            if (!isPlaying) {
                playNext()
            }
        }
    }

    fun stop() {
        Log.d(TAG, "Stopping playback and clearing queue")
        synchronized(this) {
            queue.forEach { it.delete() }
            queue.clear()
            mediaPlayer?.stop()
            isPlaying = false
        }
    }

    private fun playNext() {
        val nextFile = synchronized(this) {
            if (queue.isEmpty()) {
                Log.d(TAG, "Queue empty, playback stopped")
                isPlaying = false
                onPlaybackFinished?.invoke()
                null
            } else {
                isPlaying = true
                queue.removeAt(0)
            }
        }

        nextFile?.let { file ->
            Log.v(TAG, "Playing chunk: ${file.name}")
            mediaPlayer?.release()
            mediaPlayer = MediaPlayer().apply {
                setAudioAttributes(
                    AudioAttributes.Builder()
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
                        .build()
                )
                setDataSource(file.absolutePath)
                setOnCompletionListener { 
                    Log.v(TAG, "Finished chunk: ${file.name}")
                    file.delete()
                    playNext() 
                }
                prepare()
                start()
            }
        }
    }

    fun release() {
        Log.d(TAG, "Releasing AudioPlayer")
        mediaPlayer?.release()
        mediaPlayer = null
        queue.forEach { it.delete() }
        queue.clear()
    }
}


@Composable
fun VoicePulse(isListening: Boolean) {
    val infiniteTransition = rememberInfiniteTransition(label = "pulse")
    
    val waveCount = 3
    val waves = List(waveCount) { index ->
        infiniteTransition.animateFloat(
            initialValue = 0f,
            targetValue = 1f,
            animationSpec = infiniteRepeatable(
                animation = tween(2000, delayMillis = index * 600, easing = LinearEasing),
                repeatMode = RepeatMode.Restart
            ),
            label = "wave-$index"
        )
    }

    Box(contentAlignment = Alignment.Center) {
        waves.forEach { progress ->
            Canvas(modifier = Modifier.size(200.dp)) {
                drawCircle(
                    color = Color(0xFF007ACC),
                    radius = size.minDimension / 2 * progress.value,
                    alpha = (1f - progress.value) * (if (isListening) 0.8f else 0.3f),
                    style = Stroke(width = 2.dp.toPx())
                )
            }
        }
        
        // Inner Glow
        Box(
            modifier = Modifier
                .size(80.dp)
                .background(
                    if (isListening) Color(0xFF007ACC) else Color(0xFF1E1E1E),
                    CircleShape
                )
                .clip(CircleShape)
        )
    }
}