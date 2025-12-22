package com.aimparency.v7

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
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import java.io.File
import java.io.FileOutputStream
import java.util.*

class MainActivity : ComponentActivity() {
    private lateinit var voiceClient: VoiceClient
    private var speechRecognizer: SpeechRecognizer? = null
    private val audioPlayer = AudioPlayer()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        val serverUrl = "http://localhost:5005" 
        val projectPath = "/home/felix/dev/aimparency/v7/.bowman"

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
                        lastAiText = if (lastAiText.isEmpty()) text else "$lastAiText $text"
                        audio?.let { audioPlayer.playChunk(it, context) }
                    }
                    override fun onResponseComplete() {
                        // Response stream finished, but audio might still be playing
                    }
                })
                
                audioPlayer.onPlaybackFinished = {
                    // AI finished speaking, resume listening
                    if (status.contains("Connected")) {
                        startListening(projectPath)
                    }
                }

                speechRecognizer = SpeechRecognizer.createSpeechRecognizer(context).apply {
                    setRecognitionListener(object : RecognitionListener {
                        override fun onReadyForSpeech(params: Bundle?) { status = "Listening..." }
                        override fun onEndOfSpeech() { isListening = false; status = "Processing..." }
                        override fun onError(error: Int) { 
                            status = "STT Error: $error"
                            isListening = false 
                            // Auto-restart on timeout or no match
                            if (error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) {
                                startListening(projectPath)
                            }
                        }
                        override fun onResults(results: Bundle?) {
                            val matches = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                            matches?.firstOrNull()?.let { transcript ->
                                voiceClient.sendTranscript(transcript, projectPath)
                            }
                            // Important: restart listening after processing result
                            startListening(projectPath)
                        }
                        override fun onBeginningOfSpeech() {
                            // INTERRUPT: Stop AI if user starts talking
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
                    color = MaterialTheme.colorScheme.background
                ) {
                    Column(
                        modifier = Modifier.padding(16.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.Center
                    ) {
                        Text(text = "Aimparency Voice", style = MaterialTheme.typography.headlineMedium)
                        Spacer(modifier = Modifier.height(16.dp))
                        Text(text = "Status: $status")
                        Spacer(modifier = Modifier.height(32.dp))
                        
                        if (status == "Disconnected") {
                            Button(onClick = { voiceClient.connect() }) {
                                Text("Connect to Bridge")
                            }
                        } else {
                            Text(text = "AI: $lastAiText", style = MaterialTheme.typography.bodyLarge)
                            Spacer(modifier = Modifier.height(16.dp))
                            Button(
                                onClick = { 
                                    if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                                        startListening(projectPath)
                                        isListening = true
                                    } else {
                                        permissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
                                    }
                                },
                                enabled = !isListening
                            ) {
                                Text(if (isListening) "Listening..." else "Talk to AI")
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
        }
        speechRecognizer?.startListening(intent)
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
