package com.karthik.jo.ui

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.speech.RecognizerIntent
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Checklist
import androidx.compose.material.icons.filled.GraphicEq
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import com.karthik.jo.android.Speaker

class MainActivity : ComponentActivity() {
    private val vm: JoViewModel by viewModels()
    private lateinit var speaker: Speaker

    private val permissions = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        vm.refreshToday()
    }

    private val voice = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val heard = result.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()
        if (!heard.isNullOrBlank()) vm.ask(heard, ::onReply)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        speaker = Speaker(this)

        val wanted = buildList {
            add(Manifest.permission.READ_CALENDAR)
            add(Manifest.permission.WRITE_CALENDAR)
            if (Build.VERSION.SDK_INT >= 33) add(Manifest.permission.POST_NOTIFICATIONS)
        }
        if (savedInstanceState == null) permissions.launch(wanted.toTypedArray())

        setContent {
            MaterialTheme(colorScheme = lightColorScheme(primary = Color(0xFF1E3A5F), secondary = Color(0xFF2E7D6B))) {
                var tab by rememberSaveable { mutableIntStateOf(0) }
                Scaffold(
                    bottomBar = {
                        NavigationBar {
                            NavigationBarItem(tab == 0, { tab = 0 }, { Icon(Icons.Filled.GraphicEq, null) }, label = { Text("Jo") })
                            NavigationBarItem(tab == 1, { tab = 1; vm.refreshToday() }, { Icon(Icons.Filled.Checklist, null) }, label = { Text("Today") })
                            NavigationBarItem(tab == 2, { tab = 2 }, { Icon(Icons.Filled.Settings, null) }, label = { Text("Settings") })
                        }
                    },
                ) { padding ->
                    val modifier = Modifier.padding(padding)
                    when (tab) {
                        0 -> ChatScreen(vm, modifier, onMic = ::listen, onSpeak = ::onReply, onStop = { speaker.stop() })
                        1 -> TodayScreen(vm, modifier, onGrantCalendar = { permissions.launch(wanted.toTypedArray()) })
                        else -> SettingsScreen(vm, modifier)
                    }
                }
            }
        }
        handleIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    /** Opening the brief notification plays the saved brief. */
    private fun handleIntent(intent: Intent?) {
        if (intent?.getBooleanExtra(EXTRA_PLAY_BRIEF, false) != true) return
        intent.removeExtra(EXTRA_PLAY_BRIEF)
        val brief = vm.prefs.lastBrief
        if (brief.isNotBlank()) {
            vm.chat += JoViewModel.ChatLine(false, brief)
            speakReply(brief, force = true)
        }
    }

    private fun listen() {
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE, if (vm.prefs.tamil) "ta-IN" else "en-IN")
            .putExtra(RecognizerIntent.EXTRA_PROMPT, if (vm.prefs.tamil) "சொல்லுங்கள்…" else "Talk to Jo…")
        try {
            voice.launch(intent)
        } catch (e: ActivityNotFoundException) {
            Toast.makeText(this, "No speech recognizer found. Install or enable the Google app.", Toast.LENGTH_LONG).show()
        }
    }

    private fun onReply(text: String) = speakReply(text, force = false)

    private fun speakReply(text: String, force: Boolean) {
        if (!force && !vm.prefs.autoSpeak) return
        if (!speaker.speak(text, vm.prefs.tamil)) {
            Toast.makeText(this, "Tamil voice not installed: Settings › System › Languages › Text-to-speech › Install voice data", Toast.LENGTH_LONG).show()
        }
    }

    override fun onDestroy() {
        speaker.shutdown()
        super.onDestroy()
    }

    companion object {
        const val EXTRA_PLAY_BRIEF = "play_brief"
    }
}
