package com.karthik.jo.ui

import android.app.DatePickerDialog
import android.app.TimePickerDialog
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Alarm
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.karthik.jo.core.JoTools
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

@Composable
fun TodayScreen(vm: JoViewModel, modifier: Modifier, onGrantCalendar: () -> Unit) {
    LaunchedEffect(Unit) { vm.refreshToday() }
    val context = LocalContext.current
    var title by remember { mutableStateOf("") }
    var due by remember { mutableStateOf<Long?>(null) }

    fun pickDue() {
        val cal = Calendar.getInstance().apply { add(Calendar.HOUR_OF_DAY, 1); set(Calendar.MINUTE, 0) }
        DatePickerDialog(context, { _, y, m, d ->
            TimePickerDialog(context, { _, h, min ->
                due = Calendar.getInstance().apply { set(y, m, d, h, min, 0); set(Calendar.MILLISECOND, 0) }.timeInMillis
            }, cal.get(Calendar.HOUR_OF_DAY), 0, false).show()
        }, cal.get(Calendar.YEAR), cal.get(Calendar.MONTH), cal.get(Calendar.DAY_OF_MONTH)).show()
    }

    LazyColumn(modifier.fillMaxSize().padding(horizontal = 16.dp)) {
        item { Header("Tasks") }
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(title, { title = it }, placeholder = { Text("New task") }, modifier = Modifier.weight(1f), singleLine = true)
                IconButton(onClick = ::pickDue) { Icon(Icons.Filled.Alarm, "Set reminder time") }
                IconButton(onClick = { vm.addTask(title, due); title = ""; due = null }, enabled = title.isNotBlank()) {
                    Icon(Icons.Filled.Add, "Add task")
                }
            }
            due?.let {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Reminder: ${JoTools.formatTime(it)}", color = Color.Gray, fontSize = 13.sp)
                    IconButton(onClick = { due = null }) { Icon(Icons.Filled.Close, "Clear reminder") }
                }
            }
        }
        if (vm.tasks.isEmpty()) item { Muted("No tasks. Add one here or tell Jo \"remind me to…\"") }
        items(vm.tasks, key = { it.id }) { task ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(task.done, { vm.toggleTask(task) })
                Column(Modifier.weight(1f)) {
                    Text(task.title, textDecoration = if (task.done) TextDecoration.LineThrough else null,
                        color = if (task.done) Color.Gray else Color.Unspecified)
                    task.due?.let { Text(JoTools.formatTime(it), fontSize = 12.sp, color = Color.Gray) }
                }
                IconButton(onClick = { vm.deleteTask(task) }) { Icon(Icons.Outlined.Delete, "Delete") }
            }
        }

        item { HorizontalDivider(Modifier.padding(vertical = 12.dp)); Header("Calendar · next 7 days") }
        if (vm.calendarDenied) {
            item {
                Muted("Jo needs calendar permission to show and add events.")
                Button(onClick = onGrantCalendar) { Text("Allow calendar access") }
            }
        } else if (vm.events.isEmpty()) {
            item { Muted("No events in the next 7 days.") }
        }
        items(vm.events) { e ->
            val day = SimpleDateFormat("EEE d MMM", Locale.ENGLISH).format(Date(e.start))
            val time = if (e.allDay) "All day" else SimpleDateFormat("h:mm a", Locale.ENGLISH).format(Date(e.start))
            Column(Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
                Text(e.title, fontWeight = FontWeight.Medium)
                Text("$day · $time" + if (e.location.isNotBlank()) " · ${e.location}" else "", fontSize = 12.sp, color = Color.Gray)
            }
        }
    }
}

@Composable
internal fun Header(text: String) =
    Text(text, fontSize = 20.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 16.dp, bottom = 8.dp))

@Composable
internal fun Muted(text: String) = Text(text, color = Color.Gray, fontSize = 14.sp, modifier = Modifier.padding(vertical = 6.dp))
