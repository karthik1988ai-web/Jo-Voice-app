package com.karthik.jo.android

import android.content.Context
import android.speech.tts.TextToSpeech
import java.util.Locale

/** Text-to-speech in Indian English or Tamil. */
class Speaker(context: Context) {
    private var ready = false
    private var pending: Pair<String, Boolean>? = null
    private val tts: TextToSpeech = TextToSpeech(context.applicationContext) { status ->
        ready = status == TextToSpeech.SUCCESS
        pending?.let { (text, tamil) -> speak(text, tamil) }
        pending = null
    }

    /** Returns false if the language's voice isn't installed on the phone. */
    fun speak(text: String, tamil: Boolean): Boolean {
        if (!ready) { pending = text to tamil; return true }
        val result = tts.setLanguage(if (tamil) Locale("ta", "IN") else Locale("en", "IN"))
        val ok = result != TextToSpeech.LANG_MISSING_DATA && result != TextToSpeech.LANG_NOT_SUPPORTED
        if (!ok && tamil) return false
        tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "jo")
        return true
    }

    fun stop() { tts.stop() }

    fun shutdown() { tts.shutdown() }
}
