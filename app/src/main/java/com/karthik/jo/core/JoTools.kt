package com.karthik.jo.core

import com.karthik.jo.core.GeminiClient.Function
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

/** Phone calendar access, implemented on Android by CalendarRepo. */
interface CalendarAccess {
    data class Event(val title: String, val start: Long, val end: Long, val allDay: Boolean, val location: String)

    /** Throws SecurityException if calendar permission is missing. */
    fun events(from: Long, to: Long): List<Event>
    fun add(title: String, start: Long, end: Long, location: String?): Boolean
}

/**
 * Everything Jo can look up or do. Each function returns plain text that is
 * handed back to Gemini (and is also used directly to build the morning brief).
 */
class JoTools(
    private val mail: ZohoMailClient?,
    private val kavery: SupabaseSource?,
    private val thirumal: SupabaseSource?,
    private val tasks: TaskStore,
    private val calendar: CalendarAccess?,
    private val onTaskAdded: (TaskStore.Task) -> Unit = {},
    private val onTaskRemoved: (String) -> Unit = {},
) {
    val functions: List<Function> = listOf(
        Function("get_unread_mail", "List unread emails in the Zoho Mail inbox, newest first.",
            mapOf("limit" to ("integer" to "How many, default 10"))),
        Function("search_mail", "Search Zoho Mail. Plain words search everything; Zoho syntax like subject:xyz or sender:a@b.com also works.",
            mapOf("query" to ("string" to "Search words"), "limit" to ("integer" to "How many, default 8")),
            listOf("query")),
        Function("read_mail", "Read the full text of one email found by get_unread_mail or search_mail.",
            mapOf("folder_id" to ("string" to "folderId from the list"), "message_id" to ("string" to "messageId from the list")),
            listOf("folder_id", "message_id")),
        Function("get_app_summary", "Daily summary from one of Karthik's apps: kavery (Kavery Delivery: orders, deliveries, payments) or thirumal (Thirumal accounts: sales, collections, outstanding, stock).",
            mapOf("app" to ("string" to "kavery or thirumal"), "date" to ("string" to "YYYY-MM-DD; omit for today")),
            listOf("app")),
        Function("describe_app_tables", "List the database tables and their columns for kavery or thirumal. Call this before query_app_data if you don't know the columns.",
            mapOf("app" to ("string" to "kavery or thirumal")), listOf("app")),
        Function("query_app_data", "Read rows from a kavery or thirumal database table (read-only, Supabase/PostgREST).",
            mapOf(
                "app" to ("string" to "kavery or thirumal"),
                "table" to ("string" to "Table name"),
                "select" to ("string" to "Columns, e.g. id,customer_name,amount. Default *"),
                "filters" to ("string" to "PostgREST filters joined by &, e.g. status=eq.pending&created_at=gte.2026-10-01"),
                "order" to ("string" to "e.g. created_at.desc"),
                "limit" to ("integer" to "Max rows, default 20, max 50"),
            ), listOf("app", "table")),
        Function("list_tasks", "List Karthik's to-do tasks.",
            mapOf("include_done" to ("boolean" to "Also list completed tasks"))),
        Function("add_task", "Add a to-do task, optionally with a due time (Jo will remind him then).",
            mapOf("title" to ("string" to "What to do"), "due" to ("string" to "Local time as YYYY-MM-DD HH:mm; omit if none")),
            listOf("title")),
        Function("complete_task", "Mark a task as done.", mapOf("task_id" to ("string" to "id from list_tasks")), listOf("task_id")),
        Function("delete_task", "Delete a task.", mapOf("task_id" to ("string" to "id from list_tasks")), listOf("task_id")),
        Function("list_events", "Calendar events from the start of today for the given number of days.",
            mapOf("days" to ("integer" to "1 = today only, 7 = this week. Default 1"))),
        Function("add_event", "Add an event to the phone calendar.",
            mapOf(
                "title" to ("string" to "Event title"),
                "start" to ("string" to "Local start time YYYY-MM-DD HH:mm"),
                "end" to ("string" to "Local end time YYYY-MM-DD HH:mm; default one hour after start"),
                "location" to ("string" to "Optional place"),
            ), listOf("title", "start")),
    )

    /** Runs one function call from Gemini. Errors come back as text so Jo can explain them. */
    fun call(name: String, args: JSONObject): String = try {
        when (name) {
            "get_unread_mail" -> unreadMail(args.optInt("limit", 10))
            "search_mail" -> requireMail().search(args.getString("query"), args.optInt("limit", 8))
                .ifEmpty { return "No matching emails." }.joinToString("\n") { it.describe() }
            "read_mail" -> requireMail().content(args.getString("folder_id"), args.getString("message_id")).clip(5000)
            "get_app_summary" -> app(args).summary(args.optString("date").ifBlank { null })
            "describe_app_tables" -> app(args).describe()
            "query_app_data" -> app(args).query(
                args.getString("table"), args.optString("select"), args.optString("filters"),
                args.optString("order"), args.optInt("limit", 20),
            )
            "list_tasks" -> listTasks(args.optBoolean("include_done"))
            "add_task" -> {
                val due = args.optString("due").ifBlank { null }?.let(::parseLocal)
                val task = tasks.add(args.getString("title"), due)
                onTaskAdded(task)
                "Added: ${task.describe()}"
            }
            "complete_task" -> tasks.setDone(args.getString("task_id"))
                ?.let { onTaskRemoved(it.id); "Done: ${it.title}" } ?: "No task with that id."
            "delete_task" -> args.getString("task_id").let { id ->
                if (tasks.delete(id)) { onTaskRemoved(id); "Deleted." } else "No task with that id."
            }
            "list_events" -> listEvents(args.optInt("days", 1).coerceIn(1, 31))
            "add_event" -> {
                val cal = calendar ?: return "Calendar is not available."
                val start = parseLocal(args.getString("start"))
                val end = args.optString("end").ifBlank { null }?.let(::parseLocal) ?: (start + 3_600_000)
                if (cal.add(args.getString("title"), start, end, args.optString("location").ifBlank { null }))
                    "Event added for ${formatTime(start)}." else "Could not find a writable calendar on the phone."
            }
            else -> "Unknown function $name"
        }
    } catch (e: SecurityException) {
        "Permission missing: allow Calendar access for Jo in phone settings."
    } catch (e: Exception) {
        "Error: ${e.message ?: e.javaClass.simpleName}"
    }

    /** All sources in one block, used to write the morning brief in a single Gemini call. */
    fun briefData(): String = buildString {
        appendLine("## Unread mail (Zoho)"); appendLine(safe { unreadMail(12) })
        appendLine("\n## Kavery Delivery"); appendLine(safe { kavery?.summary() ?: "Not connected." })
        appendLine("\n## Thirumal accounts"); appendLine(safe { thirumal?.summary() ?: "Not connected." })
        appendLine("\n## Today's calendar"); appendLine(safe { listEvents(1) })
        appendLine("\n## Open tasks"); appendLine(safe { listTasks(false) })
    }

    private fun unreadMail(limit: Int): String =
        requireMail().unread(limit).ifEmpty { return "No unread mail." }.joinToString("\n") { it.describe() }

    private fun listTasks(includeDone: Boolean): String =
        (if (includeDone) tasks.all() else tasks.open()).ifEmpty { return "No tasks." }.joinToString("\n") { it.describe() }

    private fun listEvents(days: Int): String {
        val cal = calendar ?: return "Calendar is not available."
        val from = startOfToday()
        val events = cal.events(from, from + days * 86_400_000L)
        if (events.isEmpty()) return "No events."
        return events.joinToString("\n") { e ->
            val time = if (e.allDay) "all day" else "${formatTime(e.start)} to ${SimpleDateFormat("h:mm a", Locale.ENGLISH).format(Date(e.end))}"
            "- ${e.title} ($time)" + if (e.location.isNotBlank()) " at ${e.location}" else ""
        }
    }

    private fun app(args: JSONObject): SupabaseSource = when (args.optString("app").lowercase().trim()) {
        "kavery" -> kavery ?: throw IllegalStateException("Kavery is not connected yet. Add its Supabase URL and key in Settings.")
        "thirumal" -> thirumal ?: throw IllegalStateException("Thirumal is not connected yet. Add its Supabase URL and key in Settings.")
        else -> throw IllegalArgumentException("app must be kavery or thirumal")
    }

    private fun requireMail() = mail ?: throw IllegalStateException("Zoho Mail is not connected yet. Connect it in Settings.")

    private inline fun safe(block: () -> String): String = try { block() } catch (e: Exception) {
        "Unavailable: ${e.message ?: e.javaClass.simpleName}"
    }

    companion object {
        private const val LOCAL_FORMAT = "yyyy-MM-dd HH:mm"

        fun parseLocal(text: String): Long {
            val trimmed = text.trim().replace('T', ' ')
            val fmt = if (trimmed.length <= 10) "yyyy-MM-dd" else LOCAL_FORMAT
            return SimpleDateFormat(fmt, Locale.ENGLISH).apply { isLenient = false }.parse(trimmed.take(16))?.time
                ?: throw IllegalArgumentException("Bad date \"$text\"; use YYYY-MM-DD HH:mm")
        }

        fun formatTime(millis: Long): String = SimpleDateFormat("EEE d MMM h:mm a", Locale.ENGLISH).format(Date(millis))

        fun startOfToday(): Long = Calendar.getInstance().apply {
            set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
        }.timeInMillis
    }
}
