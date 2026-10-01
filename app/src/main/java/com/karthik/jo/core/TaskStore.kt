package com.karthik.jo.core

import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.UUID

/** Jo's own to-do list, stored as a small JSON file on the phone. */
class TaskStore(private val file: File) {

    data class Task(
        val id: String,
        val title: String,
        val due: Long?,        // epoch millis, null = no due time
        val done: Boolean,
        val created: Long,
    )

    @Synchronized
    fun all(): List<Task> {
        if (!file.exists()) return emptyList()
        val arr = runCatching { JSONArray(file.readText()) }.getOrDefault(JSONArray())
        return (0 until arr.length()).map { i ->
            val o = arr.getJSONObject(i)
            Task(
                id = o.getString("id"),
                title = o.getString("title"),
                due = if (o.has("due")) o.getLong("due") else null,
                done = o.optBoolean("done"),
                created = o.optLong("created"),
            )
        }.sortedWith(compareBy<Task>({ it.done }, { it.due ?: Long.MAX_VALUE }, { it.created }))
    }

    fun open(): List<Task> = all().filter { !it.done }

    @Synchronized
    fun add(title: String, due: Long?): Task {
        val task = Task(UUID.randomUUID().toString().take(8), title.trim(), due, false, System.currentTimeMillis())
        save(all() + task)
        return task
    }

    @Synchronized
    fun setDone(id: String, done: Boolean = true): Task? {
        val tasks = all()
        val task = tasks.find { it.id == id } ?: return null
        val updated = task.copy(done = done)
        save(tasks.map { if (it.id == id) updated else it })
        return updated
    }

    @Synchronized
    fun delete(id: String): Boolean {
        val tasks = all()
        if (tasks.none { it.id == id }) return false
        save(tasks.filterNot { it.id == id })
        return true
    }

    private fun save(tasks: List<Task>) {
        val arr = JSONArray()
        tasks.forEach { t ->
            arr.put(JSONObject().apply {
                put("id", t.id); put("title", t.title); put("done", t.done); put("created", t.created)
                t.due?.let { put("due", it) }
            })
        }
        file.parentFile?.mkdirs()
        val tmp = File(file.path + ".tmp")
        tmp.writeText(arr.toString())
        tmp.renameTo(file)
    }
}

fun TaskStore.Task.describe(): String {
    val due = due?.let { " (due " + SimpleDateFormat("EEE d MMM h:mm a", Locale.ENGLISH).format(Date(it)) + ")" } ?: ""
    return "- [${if (done) "x" else " "}] $title$due  id=$id"
}
