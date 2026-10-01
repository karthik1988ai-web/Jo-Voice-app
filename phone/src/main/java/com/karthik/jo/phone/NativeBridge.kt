package com.karthik.jo.phone

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.webkit.WebView
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

/**
 * The phone side of web/jo-android.js. The page sends JSON messages ("rec.start", "tts.speak",
 * "notify", "fullscreen", ...) and gets events back. Runs on the main thread.
 */
class NativeBridge(private val context: Context, private val host: Host) : WebViewCompat.WebMessageListener {
    interface Host {
        val webView: WebView
        fun requestPermission(permission: String, onResult: (Boolean) -> Unit)
        fun setFullscreen(on: Boolean)
    }

    private val main = Handler(Looper.getMainLooper())
    private var reply: JavaScriptReplyProxy? = null

    override fun onPostMessage(view: WebView, message: WebMessageCompat, sourceOrigin: Uri, isMainFrame: Boolean, replyProxy: JavaScriptReplyProxy) {
        if (!isMainFrame) return
        reply = replyProxy
        val m = try { JSONObject(message.data ?: return) } catch (e: Exception) { return }
        when (m.optString("t")) {
            "hello" -> { ensureTts(); askNotificationPermission() }
            "rec.start" -> recStart(Session(m.getString("id"), m.optString("lang"), m.optBoolean("continuous"), m.optBoolean("interim")))
            "rec.stop" -> recStop(m.getString("id"))
            "rec.abort" -> recAbort(m.getString("id"))
            "tts.speak" -> speak(m.getString("id"), m.optString("text"), m.optString("lang"), m.optString("voice"), m.optDouble("rate", 1.0).toFloat())
            "tts.cancel" -> tts?.stop()
            "notify" -> notify(m.optString("title"), m.optString("body"))
            "notify.permission" -> askNotificationPermission()
            "fullscreen" -> { host.setFullscreen(m.optBoolean("on")); send(JSONObject().put("t", "fullscreen").put("on", m.optBoolean("on"))) }
        }
    }

    private fun send(m: JSONObject) {
        main.post { try { reply?.postMessage(m.toString()) } catch (e: Exception) { /* page went away */ } }
    }
    private fun event(t: String, id: String) = JSONObject().put("t", t).put("id", id)

    // ---------- speech recognition ----------
    private class Session(val id: String, val lang: String, val continuous: Boolean, val interim: Boolean) {
        var started = false
        var stopping = false
        var busyRetries = 0
    }

    private var recognizer: SpeechRecognizer? = null
    private var session: Session? = null
    private var waiting: Session? = null // asked to start while Jo was in the background
    private var paused = false

    private fun recStart(s: Session) {
        session?.let { recognizer?.cancel(); endSession(it) }
        waiting?.let { send(event("rec.end", it.id)) }
        waiting = null
        if (!SpeechRecognizer.isRecognitionAvailable(context)) {
            send(event("rec.error", s.id).put("error", "audio-capture").put("message", "No speech recognizer on this phone. Enable the Google app."))
            send(event("rec.end", s.id))
            return
        }
        host.requestPermission(Manifest.permission.RECORD_AUDIO) { granted ->
            when {
                !granted -> { send(event("rec.error", s.id).put("error", "not-allowed")); send(event("rec.end", s.id)) }
                paused -> waiting = s
                else -> { session = s; listenOnce(s) }
            }
        }
    }

    private fun recStop(id: String) {
        waiting?.takeIf { it.id == id }?.let { waiting = null; send(event("rec.end", id)); return }
        val s = session?.takeIf { it.id == id } ?: return
        s.stopping = true
        recognizer?.stopListening() // delivers the final words, then ends
    }

    private fun recAbort(id: String) {
        waiting?.takeIf { it.id == id }?.let { waiting = null; send(event("rec.end", id)); return }
        val s = session?.takeIf { it.id == id } ?: return
        recognizer?.cancel()
        endSession(s)
    }

    private fun endSession(s: Session) {
        if (session === s) session = null
        unmuteBeep()
        send(event("rec.end", s.id))
    }

    private fun listenOnce(s: Session) {
        val r = recognizer ?: SpeechRecognizer.createSpeechRecognizer(context).also {
            recognizer = it
            it.setRecognitionListener(listener)
        }
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, s.interim || s.continuous)
            .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
            .putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, context.packageName)
        if (s.lang.isNotBlank()) intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, s.lang)
        // The background "Jo" listener restarts every few seconds; hush the recognizer's start beep.
        if (s.continuous) muteBeep()
        r.startListening(intent)
    }

    /** Listen again for the "Jo" wake word, unless that session was stopped meanwhile. */
    private fun again(s: Session, delayMs: Long) {
        main.postDelayed({ if (session === s && !s.stopping && !paused) listenOnce(s) }, delayMs)
    }

    private val listener = object : RecognitionListener {
        override fun onReadyForSpeech(params: Bundle?) {
            val s = session ?: return
            if (!s.started) { s.started = true; send(event("rec.start", s.id)) }
            main.postDelayed({ unmuteBeep() }, 350)
        }

        override fun onPartialResults(partialResults: Bundle?) {
            val s = session ?: return
            val text = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()
            if (!text.isNullOrBlank()) send(event("rec.result", s.id).put("text", text).put("final", false))
        }

        override fun onResults(results: Bundle?) {
            val s = session ?: return
            val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()
            if (!text.isNullOrBlank()) send(event("rec.result", s.id).put("text", text).put("final", true))
            if (s.continuous && !s.stopping) again(s, 50) else endSession(s)
        }

        override fun onError(error: Int) {
            val s = session ?: return
            unmuteBeep()
            if (s.stopping) { endSession(s); return }
            when (error) {
                SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT ->
                    if (s.continuous) again(s, 50) else { send(event("rec.error", s.id).put("error", "no-speech")); endSession(s) }
                SpeechRecognizer.ERROR_RECOGNIZER_BUSY, SpeechRecognizer.ERROR_CLIENT ->
                    if (s.busyRetries++ < 3) {
                        recognizer?.destroy(); recognizer = null
                        again(s, 300)
                    } else { send(event("rec.error", s.id).put("error", "audio-capture")); endSession(s) }
                SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> { send(event("rec.error", s.id).put("error", "not-allowed")); endSession(s) }
                SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT, SpeechRecognizer.ERROR_SERVER ->
                    { send(event("rec.error", s.id).put("error", "network")); endSession(s) }
                else -> { send(event("rec.error", s.id).put("error", "audio-capture")); endSession(s) }
            }
        }

        override fun onBeginningOfSpeech() {}
        override fun onRmsChanged(rmsdB: Float) {}
        override fun onBufferReceived(buffer: ByteArray?) {}
        override fun onEndOfSpeech() {}
        override fun onEvent(eventType: Int, params: Bundle?) {}
    }

    // Muting music for a moment hides the recognizer's beep. Only Jo's idle listener does this,
    // and only if the music wasn't already muted, so the user's own setting is restored exactly.
    private val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private var mutedByJo = false
    private fun muteBeep() {
        if (mutedByJo) return
        try {
            if (!audio.isStreamMute(AudioManager.STREAM_MUSIC)) {
                audio.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_MUTE, 0)
                mutedByJo = true
                main.postDelayed({ unmuteBeep() }, 1500) // never leave it muted
            }
        } catch (e: SecurityException) { /* Do Not Disturb rules: just let it beep */ }
    }
    private fun unmuteBeep() {
        if (!mutedByJo) return
        mutedByJo = false
        try { audio.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_UNMUTE, 0) } catch (e: SecurityException) { }
    }

    /** Android doesn't let apps listen in the background, so Jo pauses and resumes the mic. */
    fun setPaused(p: Boolean) {
        paused = p
        if (p) {
            session?.let { recognizer?.cancel(); endSession(it) }
        } else {
            waiting?.let { s -> waiting = null; session = s; listenOnce(s) }
        }
    }

    // ---------- text to speech ----------
    private var tts: TextToSpeech? = null
    private var ttsReady = false
    private val ttsQueue = mutableListOf<() -> Unit>()

    private fun ensureTts() {
        if (tts != null) return
        tts = TextToSpeech(context) { status ->
            main.post {
                ttsReady = status == TextToSpeech.SUCCESS
                if (ttsReady) {
                    tts?.setOnUtteranceProgressListener(progress)
                    sendVoices()
                }
                ttsQueue.toList().forEach { it() }
                ttsQueue.clear()
            }
        }
    }

    private fun sendVoices() {
        val list = JSONArray()
        val seen = HashSet<String>()
        val all = try { tts?.voices.orEmpty() } catch (e: Exception) { emptySet() } // some engines throw here
        all
            .filter { it.locale.language in setOf("en", "ta") && TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED !in it.features }
            .sortedWith(compareBy({ it.locale.language != "en" }, { it.isNetworkConnectionRequired }, { it.name }))
            .forEach { v -> if (seen.add(v.name)) list.put(JSONObject().put("name", v.name).put("lang", v.locale.toLanguageTag())) }
        send(JSONObject().put("t", "tts.voices").put("voices", list))
    }

    private fun speak(id: String, text: String, lang: String, voice: String, rate: Float) {
        ensureTts()
        if (!ttsReady) {
            if (tts != null && ttsQueue.size < 20) ttsQueue += { if (ttsReady) speak(id, text, lang, voice, rate) else send(event("tts.error", id)) }
            return
        }
        val engine = tts ?: return
        val chosen = engine.voices?.firstOrNull { it.name == voice }
        if (chosen != null) engine.voice = chosen
        else if (lang.isNotBlank()) engine.language = Locale.forLanguageTag(lang)
        engine.setSpeechRate(rate)
        val chunks = chunk(text, TextToSpeech.getMaxSpeechInputLength() - 100)
        chunks.forEachIndexed { i, part ->
            engine.speak(part, TextToSpeech.QUEUE_ADD, null, "$id#$i#${chunks.size}")
        }
    }

    private val progress = object : UtteranceProgressListener() {
        override fun onStart(utteranceId: String) {
            val (id, i, _) = utteranceId.split("#")
            if (i == "0") send(event("tts.start", id))
        }
        override fun onDone(utteranceId: String) {
            val (id, i, n) = utteranceId.split("#")
            if (i.toInt() == n.toInt() - 1) send(event("tts.end", id))
        }
        @Deprecated("Deprecated in Java")
        override fun onError(utteranceId: String) {
            send(event("tts.error", utteranceId.substringBefore("#")))
        }
        override fun onStop(utteranceId: String, interrupted: Boolean) {
            send(event("tts.end", utteranceId.substringBefore("#")))
        }
    }

    // ---------- notifications ----------
    private fun askNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33) host.requestPermission(Manifest.permission.POST_NOTIFICATIONS) { }
    }

    private fun notify(title: String, body: String) {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        val manager = NotificationManagerCompat.from(context)
        manager.createNotificationChannel(NotificationChannel(CHANNEL, "Jo alerts", NotificationManager.IMPORTANCE_HIGH)
            .apply { description = "New mail, reminders and the morning brief" })
        val open = PendingIntent.getActivity(
            context, 0,
            Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val n = NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_jo)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setContentIntent(open)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .build()
        try { manager.notify(title.hashCode(), n) } catch (e: SecurityException) { /* permission withdrawn */ }
    }

    fun release() {
        recognizer?.destroy(); recognizer = null
        unmuteBeep()
        tts?.shutdown(); tts = null
        main.removeCallbacksAndMessages(null)
    }

    companion object {
        private const val CHANNEL = "jo"

        /** Splits long text (like the morning brief) at sentence ends so each part fits the speech engine. */
        fun chunk(text: String, max: Int): List<String> {
            if (text.length <= max) return listOf(text)
            val parts = mutableListOf<String>()
            var rest = text
            while (rest.length > max) {
                val lim = max - 1 // a cut at lim keeps the part within max characters
                val cut = rest.lastIndexOfAny(charArrayOf('.', '!', '?', '\n', '।'), lim).takeIf { it > max / 2 }
                    ?: rest.lastIndexOf(' ', lim).takeIf { it > 0 } ?: lim
                parts += rest.substring(0, cut + 1).trim()
                rest = rest.substring(cut + 1)
            }
            if (rest.isNotBlank()) parts += rest.trim()
            return parts
        }
    }
}
