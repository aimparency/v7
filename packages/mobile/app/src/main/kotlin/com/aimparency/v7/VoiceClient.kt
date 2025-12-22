package com.aimparency.v7

import io.socket.client.IO
import io.socket.client.Socket
import org.json.JSONObject
import java.net.URISyntaxException

class VoiceClient(private val serverUrl: String) {
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
        try {
            val opts = IO.Options()
            opts.transports = arrayOf("websocket")
            socket = IO.socket(serverUrl, opts)
            
            socket?.on(Socket.EVENT_CONNECT) {
                callback?.onConnect()
            }

            socket?.on(Socket.EVENT_DISCONNECT) {
                callback?.onDisconnect()
            }

            socket?.on("ai-audio-chunk") { args ->
                val data = args[0] as JSONObject
                val text = data.getString("text")
                val audio = if (data.has("audio")) {
                    data.get("audio") as? ByteArray
                } else null
                
                callback?.onAudioChunk(text, audio)
            }

            socket?.on("ai-response-complete") {
                callback?.onResponseComplete()
            }

            socket?.on("error") { args ->
                val data = args[0] as JSONObject
                callback?.onError(data.getString("message"))
            }

            socket?.connect()
        } catch (e: URISyntaxException) {
            callback?.onError("Invalid server URL: ${e.message}")
        }
    }

    fun sendTranscript(transcript: String, projectPath: String) {
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
