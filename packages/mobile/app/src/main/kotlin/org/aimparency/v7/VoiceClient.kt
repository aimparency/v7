package org.aimparency.v7

import android.util.Log
import io.socket.client.IO
import io.socket.client.Socket
import org.json.JSONObject
import java.net.URISyntaxException

class VoiceClient(private val serverUrl: String) {
    private val TAG = "VoiceClient"
    private var socket: Socket? = null
    
    interface Callback {
        fun onAudioChunk(text: String, audio: ByteArray?)
        fun onResponseComplete()
        fun onError(message: String)
        fun onConnect()
        fun onDisconnect()
    }

    private var callback: Callback? = null

    fun setCallback(callback: Callback) {
        this.callback = callback
    }

    fun connect() {
        Log.d(TAG, "Attempting to connect to $serverUrl")
        try {
            val opts = IO.Options()
            opts.transports = arrayOf("websocket")
            socket = IO.socket(serverUrl, opts)
            
            socket?.on(Socket.EVENT_CONNECT) {
                Log.i(TAG, "Successfully connected to server")
                callback?.onConnect()
            }

            socket?.on(Socket.EVENT_DISCONNECT) {
                Log.w(TAG, "Disconnected from server")
                callback?.onDisconnect()
            }

            socket?.on(Socket.EVENT_CONNECT_ERROR) { args ->
                val error = args.firstOrNull()?.toString() ?: "Unknown socket error"
                Log.e(TAG, "Connect error: $error")
                callback?.onError(error)
            }

            socket?.on("ai-audio-chunk") { args ->
                try {
                    val data = args[0] as JSONObject
                    val text = data.getString("text")
                    val audio = if (data.has("audio")) {
                        val obj = data.get("audio")
                        Log.v(TAG, "Received audio chunk for text: '$text' (type: ${obj?.javaClass?.simpleName})")
                        obj as? ByteArray
                    } else null
                    
                    callback?.onAudioChunk(text, audio)
                } catch (e: Exception) {
                    Log.e(TAG, "Error parsing ai-audio-chunk: ${e.message}")
                }
            }

            socket?.on("ai-response-complete") {
                Log.d(TAG, "AI Response stream complete")
                callback?.onResponseComplete()
            }

            socket?.on("error") { args ->
                val data = args[0] as JSONObject
                val msg = data.getString("message")
                Log.e(TAG, "Server reported error: $msg")
                callback?.onError(msg)
            }

            socket?.connect()
        } catch (e: URISyntaxException) {
            Log.e(TAG, "URISyntaxException: ${e.message}")
            callback?.onError("Invalid server URL: ${e.message}")
        }
    }

    fun sendTranscript(transcript: String, projectPath: String) {
        Log.i(TAG, "Sending transcript: '$transcript' (Project: $projectPath)")
        val data = JSONObject()
        data.put("transcript", transcript)
        data.put("projectPath", projectPath)
        socket?.emit("user-transcript", data)
    }

    fun disconnect() {
        socket?.disconnect()
        socket = null
    }
}
