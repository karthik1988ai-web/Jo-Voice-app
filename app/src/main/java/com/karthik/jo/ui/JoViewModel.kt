package com.karthik.jo.ui

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.karthik.jo.android.CalendarRepo
import com.karthik.jo.android.Jo
import com.karthik.jo.android.Prefs
import com.karthik.jo.android.ReminderWorker
import com.karthik.jo.core.CalendarAccess
import com.karthik.jo.core.JoAgent
import com.karthik.jo.core.JoTools
import com.karthik.jo.core.TaskStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class JoViewModel(app: Application) : AndroidViewModel(app) {
    val prefs = Prefs(app)

    data class ChatLine(val fromUser: Boolean, val text: String)

    val chat = mutableStateListOf<ChatLine>()
    var busy by mutableStateOf(false)
        private set

    var tasks by mutableStateOf<List<TaskStore.Task>>(emptyList())
        private set
    var events by mutableStateOf<List<CalendarAccess.Event>>(emptyList())
        private set
    var calendarDenied by mutableStateOf(false)
        private set

    private var agent: JoAgent? = null
    private val taskStore = Jo.tasks(app)
    private val calendar = CalendarRepo(app)

    /** Call after settings change so Jo picks up new keys and language. */
    fun settingsChanged() {
        agent = null
    }

    fun clearChat() {
        chat.clear()
        agent?.reset()
    }

    /** Sends a request to Jo; [onReply] receives the text to speak. */
    fun ask(text: String, onReply: (String) -> Unit) {
        if (text.isBlank() || busy) return
        chat += ChatLine(true, text.trim())
        run(onReply) { it.ask(text.trim()) }
    }

    fun morningBrief(onReply: (String) -> Unit) {
        if (busy) return
        chat += ChatLine(true, "Morning brief")
        run(onReply) { agent ->
            agent.morningBrief().also {
                prefs.lastBrief = it
                prefs.lastBriefTime = System.currentTimeMillis()
            }
        }
    }

    private fun run(onReply: (String) -> Unit, block: (JoAgent) -> String) {
        val current = agent ?: Jo.agent(getApplication(), prefs).also { agent = it }
        if (current == null) {
            chat += ChatLine(false, "Please add your Gemini API key in Settings first.")
            return
        }
        busy = true
        viewModelScope.launch {
            val reply = withContext(Dispatchers.IO) {
                try { block(current) } catch (e: Exception) { e.message ?: "Something went wrong." }
            }
            chat += ChatLine(false, reply)
            busy = false
            refreshToday()
            onReply(reply)
        }
    }

    fun refreshToday() {
        viewModelScope.launch {
            tasks = withContext(Dispatchers.IO) { taskStore.all() }
            // null means calendar permission isn't granted yet
            val result = withContext(Dispatchers.IO) {
                try {
                    val from = JoTools.startOfToday()
                    calendar.events(from, from + 7 * 86_400_000L)
                } catch (e: SecurityException) {
                    null
                }
            }
            calendarDenied = result == null
            events = result.orEmpty()
        }
    }

    fun addTask(title: String, due: Long?) {
        if (title.isBlank()) return
        viewModelScope.launch(Dispatchers.IO) {
            val task = taskStore.add(title, due)
            due?.let { ReminderWorker.schedule(getApplication(), task.id, task.title, it) }
            withContext(Dispatchers.Main) { refreshToday() }
        }
    }

    fun toggleTask(task: TaskStore.Task) {
        viewModelScope.launch(Dispatchers.IO) {
            taskStore.setDone(task.id, !task.done)
            if (!task.done) ReminderWorker.cancel(getApplication(), task.id)
            else task.due?.let { ReminderWorker.schedule(getApplication(), task.id, task.title, it) }
            withContext(Dispatchers.Main) { refreshToday() }
        }
    }

    fun deleteTask(task: TaskStore.Task) {
        viewModelScope.launch(Dispatchers.IO) {
            taskStore.delete(task.id)
            ReminderWorker.cancel(getApplication(), task.id)
            withContext(Dispatchers.Main) { refreshToday() }
        }
    }
}
