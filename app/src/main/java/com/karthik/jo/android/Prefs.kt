package com.karthik.jo.android

import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.edit
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.karthik.jo.core.GeminiClient

/** All settings. Stored encrypted on the phone, since they include API keys. */
class Prefs(context: Context) {
    private val sp: SharedPreferences = EncryptedSharedPreferences.create(
        context,
        "jo_settings",
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    private fun str(key: String, default: String = "") = sp.getString(key, default) ?: default
    private fun put(key: String, value: String) = sp.edit { putString(key, value.trim()) }

    var geminiKey: String get() = str("gemini_key"); set(v) = put("gemini_key", v)
    var geminiModel: String get() = str("gemini_model", GeminiClient.DEFAULT_MODEL); set(v) = put("gemini_model", v)

    var tamil: Boolean get() = sp.getBoolean("tamil", false); set(v) = sp.edit { putBoolean("tamil", v) }
    var autoSpeak: Boolean get() = sp.getBoolean("auto_speak", true); set(v) = sp.edit { putBoolean("auto_speak", v) }

    var briefEnabled: Boolean get() = sp.getBoolean("brief_enabled", true); set(v) = sp.edit { putBoolean("brief_enabled", v) }
    var briefHour: Int get() = sp.getInt("brief_hour", 8); set(v) = sp.edit { putInt("brief_hour", v) }
    var briefMinute: Int get() = sp.getInt("brief_minute", 0); set(v) = sp.edit { putInt("brief_minute", v) }
    var lastBrief: String get() = str("last_brief"); set(v) = put("last_brief", v)
    var lastBriefTime: Long get() = sp.getLong("last_brief_time", 0); set(v) = sp.edit { putLong("last_brief_time", v) }

    var zohoRegion: String get() = str("zoho_region", "com"); set(v) = put("zoho_region", v)
    var zohoClientId: String get() = str("zoho_client_id"); set(v) = put("zoho_client_id", v)
    var zohoClientSecret: String get() = str("zoho_client_secret"); set(v) = put("zoho_client_secret", v)
    var zohoRefreshToken: String get() = str("zoho_refresh_token"); set(v) = put("zoho_refresh_token", v)

    val kavery = SupabasePrefs("kavery")
    val thirumal = SupabasePrefs("thirumal")

    inner class SupabasePrefs(private val prefix: String) {
        var url: String get() = str("${prefix}_url"); set(v) = put("${prefix}_url", v)
        var key: String get() = str("${prefix}_key"); set(v) = put("${prefix}_key", v)
        var summaryFunction: String get() = str("${prefix}_fn"); set(v) = put("${prefix}_fn", v)
        var tables: String get() = str("${prefix}_tables"); set(v) = put("${prefix}_tables", v)
        val configured get() = url.isNotBlank() && key.isNotBlank()
    }
}
