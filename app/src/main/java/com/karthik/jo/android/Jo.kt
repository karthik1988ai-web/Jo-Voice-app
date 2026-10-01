package com.karthik.jo.android

import android.content.Context
import com.karthik.jo.core.GeminiClient
import com.karthik.jo.core.JoAgent
import com.karthik.jo.core.JoTools
import com.karthik.jo.core.SupabaseSource
import com.karthik.jo.core.TaskStore
import com.karthik.jo.core.ZohoMailClient
import java.io.File

/** Builds Jo's sources and brain from the saved settings. */
object Jo {
    fun tasks(context: Context) = TaskStore(File(context.filesDir, "tasks.json"))

    fun mail(prefs: Prefs): ZohoMailClient? =
        if (prefs.zohoRefreshToken.isBlank() || prefs.zohoClientId.isBlank()) null
        else ZohoMailClient(prefs.zohoRegion, prefs.zohoClientId, prefs.zohoClientSecret, prefs.zohoRefreshToken)

    fun supabase(name: String, p: Prefs.SupabasePrefs): SupabaseSource? =
        if (!p.configured) null else SupabaseSource(name, p.url, p.key, p.summaryFunction, p.tables)

    fun tools(context: Context, prefs: Prefs): JoTools {
        val app = context.applicationContext
        return JoTools(
            mail = mail(prefs),
            kavery = supabase("Kavery Delivery", prefs.kavery),
            thirumal = supabase("Thirumal", prefs.thirumal),
            tasks = tasks(app),
            calendar = CalendarRepo(app),
            onTaskAdded = { task -> task.due?.let { ReminderWorker.schedule(app, task.id, task.title, it) } },
            onTaskRemoved = { id -> ReminderWorker.cancel(app, id) },
        )
    }

    /** Null when no Gemini key is set yet. */
    fun agent(context: Context, prefs: Prefs): JoAgent? {
        if (prefs.geminiKey.isBlank()) return null
        return JoAgent(GeminiClient(prefs.geminiKey, prefs.geminiModel), tools(context, prefs), prefs.tamil)
    }
}
