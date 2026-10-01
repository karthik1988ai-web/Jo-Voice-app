package com.karthik.jo.ui

import android.app.TimePickerDialog
import android.content.Intent
import android.net.Uri
import android.widget.Toast
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.karthik.jo.android.BriefScheduler
import com.karthik.jo.android.Jo
import com.karthik.jo.android.Prefs
import com.karthik.jo.core.GeminiClient
import com.karthik.jo.core.ZohoMailClient
import com.karthik.jo.core.describe
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray

@Composable
fun SettingsScreen(vm: JoViewModel, modifier: Modifier) {
    val prefs = vm.prefs
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var geminiKey by remember { mutableStateOf(prefs.geminiKey) }
    var geminiModel by remember { mutableStateOf(prefs.geminiModel) }
    var tamil by remember { mutableStateOf(prefs.tamil) }
    var autoSpeak by remember { mutableStateOf(prefs.autoSpeak) }
    var briefEnabled by remember { mutableStateOf(prefs.briefEnabled) }
    var briefHour by remember { mutableStateOf(prefs.briefHour) }
    var briefMinute by remember { mutableStateOf(prefs.briefMinute) }

    var zohoRegion by remember { mutableStateOf(prefs.zohoRegion) }
    var zohoId by remember { mutableStateOf(prefs.zohoClientId) }
    var zohoSecret by remember { mutableStateOf(prefs.zohoClientSecret) }
    var zohoCode by remember { mutableStateOf("") }
    var zohoConnected by remember { mutableStateOf(prefs.zohoRefreshToken.isNotBlank()) }

    val kavery = remember { SupabaseFields(prefs.kavery) }
    val thirumal = remember { SupabaseFields(prefs.thirumal) }

    var status by remember { mutableStateOf("") }

    fun save() {
        prefs.geminiKey = geminiKey
        prefs.geminiModel = geminiModel.ifBlank { GeminiClient.DEFAULT_MODEL }
        prefs.tamil = tamil
        prefs.autoSpeak = autoSpeak
        prefs.briefEnabled = briefEnabled
        prefs.briefHour = briefHour
        prefs.briefMinute = briefMinute
        prefs.zohoRegion = zohoRegion
        prefs.zohoClientId = zohoId
        prefs.zohoClientSecret = zohoSecret
        kavery.save(prefs.kavery)
        thirumal.save(prefs.thirumal)
        if (briefEnabled) BriefScheduler.schedule(context, prefs) else BriefScheduler.cancel(context)
        vm.settingsChanged()
    }

    /** Saves, then runs [block] in the background and shows its result. */
    fun test(label: String, block: () -> String) {
        save()
        status = "Testing $label…"
        scope.launch {
            status = withContext(Dispatchers.IO) {
                try { "$label OK:\n" + block().take(600) } catch (e: Exception) { "$label failed: ${e.message}" }
            }
        }
    }

    Column(modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Header("Gemini (Jo's brain)")
        Muted("Free key from aistudio.google.com/apikey")
        TextButton(onClick = { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://aistudio.google.com/apikey"))) }) {
            Text("Open Google AI Studio")
        }
        Secret("Gemini API key", geminiKey) { geminiKey = it }
        Field("Model", geminiModel) { geminiModel = it }
        OutlinedButton(onClick = {
            test("Gemini") { GeminiClient(prefs.geminiKey, prefs.geminiModel).generate("Reply in five words.", JSONArray().put(GeminiClient.userText("Say hello to Karthik"))).toString() }
        }) { Text("Test Gemini") }

        Header("Voice")
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(!tamil, { tamil = false }, { Text("English") })
            FilterChip(tamil, { tamil = true }, { Text("தமிழ்") })
        }
        Toggle("Speak replies aloud", autoSpeak) { autoSpeak = it }

        Header("Morning brief")
        Toggle("Daily brief", briefEnabled) { briefEnabled = it }
        OutlinedButton(onClick = {
            TimePickerDialog(context, { _, h, m -> briefHour = h; briefMinute = m }, briefHour, briefMinute, false).show()
        }) { Text("Time: %d:%02d %s".format(if (briefHour % 12 == 0) 12 else briefHour % 12, briefMinute, if (briefHour < 12) "AM" else "PM")) }
        Muted("For an on-time brief, set phone Settings › Apps › Jo › Battery › Unrestricted.")

        Header("Zoho Mail")
        Muted(if (zohoConnected) "✅ Connected" else "Not connected. Steps are in the README (Zoho Self Client).")
        Field("Region (com, in, eu, com.au, jp)", zohoRegion) { zohoRegion = it }
        Field("Client ID", zohoId) { zohoId = it }
        Secret("Client secret", zohoSecret) { zohoSecret = it }
        Field("Grant code (from Self Client › Generate code)", zohoCode) { zohoCode = it }
        Muted("Scopes to enter in Zoho: ${ZohoMailClient.SCOPES}")
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = {
                save()
                status = "Connecting Zoho…"
                scope.launch {
                    status = withContext(Dispatchers.IO) {
                        try {
                            prefs.zohoRefreshToken = ZohoMailClient.exchangeGrantCode(zohoRegion, zohoId, zohoSecret, zohoCode)
                            "Zoho Mail connected."
                        } catch (e: Exception) { "Zoho connect failed: ${e.message}" }
                    }
                    zohoConnected = prefs.zohoRefreshToken.isNotBlank()
                    zohoCode = ""
                    vm.settingsChanged()
                }
            }, enabled = zohoId.isNotBlank() && zohoSecret.isNotBlank() && zohoCode.isNotBlank()) { Text("Connect") }
            OutlinedButton(onClick = {
                test("Zoho Mail") {
                    Jo.mail(prefs)?.recent(3)?.joinToString("\n") { it.describe() } ?: throw IllegalStateException("Not connected")
                }
            }, enabled = zohoConnected) { Text("Test") }
        }

        SupabaseSection("Kavery Delivery (Supabase)", kavery) { test("Kavery") { Jo.supabase("Kavery", prefs.kavery)?.summary() ?: throw IllegalStateException("URL and key needed") } }
        SupabaseSection("Thirumal accounts (Supabase)", thirumal) { test("Thirumal") { Jo.supabase("Thirumal", prefs.thirumal)?.summary() ?: throw IllegalStateException("URL and key needed") } }

        Button(onClick = { save(); status = "Saved." }, modifier = Modifier.fillMaxWidth().padding(top = 16.dp)) { Text("Save") }
        if (status.isNotBlank()) Text(status, fontSize = 13.sp, color = Color(0xFF2E4A62))
    }
}

/** Editable copy of one app's Supabase settings. */
private class SupabaseFields(p: Prefs.SupabasePrefs) {
    var url by mutableStateOf(p.url)
    var key by mutableStateOf(p.key)
    var fn by mutableStateOf(p.summaryFunction)
    var tables by mutableStateOf(p.tables)

    fun save(p: Prefs.SupabasePrefs) {
        p.url = url; p.key = key; p.summaryFunction = fn; p.tables = tables
    }
}

@Composable
private fun SupabaseSection(title: String, f: SupabaseFields, onTest: () -> Unit) {
    Header(title)
    Field("Project URL (https://xxxx.supabase.co)", f.url) { f.url = it }
    Secret("API key", f.key) { f.key = it }
    Field("Tables Jo may read, comma-separated", f.tables) { f.tables = it }
    Field("Summary function (optional, e.g. jo_daily_summary)", f.fn) { f.fn = it }
    OutlinedButton(onClick = onTest, enabled = f.url.isNotBlank() && f.key.isNotBlank()) { Text("Test") }
}

@Composable
private fun Field(label: String, value: String, onChange: (String) -> Unit) =
    OutlinedTextField(value, onChange, label = { Text(label) }, singleLine = true, modifier = Modifier.fillMaxWidth())

@Composable
private fun Secret(label: String, value: String, onChange: (String) -> Unit) =
    OutlinedTextField(
        value, onChange, label = { Text(label) }, singleLine = true, modifier = Modifier.fillMaxWidth(),
        visualTransformation = PasswordVisualTransformation(),
    )

@Composable
private fun Toggle(label: String, checked: Boolean, onChange: (Boolean) -> Unit) =
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f))
        Switch(checked, onChange)
    }
