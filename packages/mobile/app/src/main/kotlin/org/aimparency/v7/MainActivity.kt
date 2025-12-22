package org.aimparency.v7

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.os.Bundle
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

class MainActivity : ComponentActivity() {
    private lateinit var voiceClient: VoiceClient
    private var speechRecognizer: SpeechRecognizer? = null
    private val audioPlayer = AudioPlayer()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        // Load Dynamic Config
        val config = loadConfig()
        val serverUrl = config.optString("serverUrl", "http://127.0.0.1:5005")
        val projectPath = config.optString("projectPath", "")

        voiceClient = VoiceClient(serverUrl)

        setContent {
            var status by remember { mutableStateOf("Disconnected") }
            var lastAiText by remember { mutableStateOf("") }
            var isListening by remember { mutableStateOf(false) }
            val context = LocalContext.current

            val permissionLauncher = rememberLauncherForActivityResult(
                ActivityResultContracts.RequestPermission()
            ) { isGranted ->
                if (isGranted) {
                    startListening(projectPath)
                    isListening = true
                }
            }

            DisposableEffect(Unit) {
                voiceClient.setCallback(object : VoiceClient.Callback {
                    override fun onConnect() { status = "Connected" }
                    override fun onDisconnect() { status = "Disconnected" }
                    override fun onError(message: String) { status = "Error: $message" }
                    override fun onAudioChunk(text: String, audio: ByteArray?) {
                        lastAiText = text
                        audio?.let { audioPlayer.playChunk(it, context) }
                        
                        if (!isListening) {
                            startListening(projectPath)
                            isListening = true
                        }
                    }
                    override fun onResponseComplete() {}
                })
                
                audioPlayer.onPlaybackFinished = {
                    if (status.contains("Connected")) {
                        startListening(projectPath)
                    }
                }

                speechRecognizer = SpeechRecognizer.createSpeechRecognizer(context).apply {
                    setRecognitionListener(object : RecognitionListener {
                        override fun onReadyForSpeech(params: Bundle?) { status = "Listening..."; isListening = true }
                        override fun onEndOfSpeech() { isListening = false; status = "Processing..." }
                        override fun onError(error: Int) { 
                            status = "STT Error: $error"
                            isListening = false 
                            if (error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) {
                                startListening(projectPath)
                            }
                        }
                        override fun onResults(results: Bundle?) {
                            val matches = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                            matches?.firstOrNull()?.let { transcript ->
                                voiceClient.sendTranscript(transcript, projectPath)
                            }
                            startListening(projectPath)
                        }
                        override fun onBeginningOfSpeech() {
                            audioPlayer.stop()
                            status = "User speaking..."
                        }
                        override fun onRmsChanged(rmsdB: Float) {}
                        override fun onBufferReceived(buffer: ByteArray?) {}
                        override fun onPartialResults(partialResults: Bundle?) {}
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
                                onClick = { voiceClient.connect() },
                                modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 64.dp),
                                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF007ACC))
                            ) {
                                Text("INITIALIZE CONNECTION")
                            }
                        } else if (!isListening && !status.startsWith("User") && !status.startsWith("Listening")) {
                             IconButton(
                                onClick = { 
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
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault())
            // Pass projectPath as an extra to be picked up in results if needed
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
            JSONObject(String(buffer, Charset.forName("UTF-8")))
        } catch (e: Exception) {
            JSONObject()
        }
    }
}

class AudioPlayer {
    private val queue = mutableListOf<File>()
    private var mediaPlayer: MediaPlayer? = null
    private var isPlaying = false
    var onPlaybackFinished: (() -> Unit)? = null

    fun playChunk(audio: ByteArray, context: android.content.Context) {
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
                isPlaying = false
                onPlaybackFinished?.invoke()
                null
            } else {
                isPlaying = true
                queue.removeAt(0)
            }
        }

        nextFile?.let { file ->
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
                    file.delete()
                    playNext() 
                }
                prepare()
                start()
            }
        }
    }

    fun release() {
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