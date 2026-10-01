package com.karthik.jo.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.DeleteSweep
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.StopCircle
import androidx.compose.material.icons.filled.WbSunny
import androidx.compose.material3.AssistChip
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
fun ChatScreen(
    vm: JoViewModel,
    modifier: Modifier,
    onMic: () -> Unit,
    onSpeak: (String) -> Unit,
    onStop: () -> Unit,
) {
    var input by rememberSaveable { mutableStateOf("") }
    val listState = rememberLazyListState()
    LaunchedEffect(vm.chat.size) { if (vm.chat.isNotEmpty()) listState.animateScrollToItem(vm.chat.size - 1) }

    Column(modifier.fillMaxSize()) {
        Row(
            Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.primary).padding(horizontal = 16.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("Jo", color = Color.White, fontSize = 22.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
            IconButton(onClick = { vm.morningBrief(onSpeak) }) { Icon(Icons.Filled.WbSunny, "Morning brief", tint = Color.White) }
            IconButton(onClick = onStop) { Icon(Icons.Filled.StopCircle, "Stop speaking", tint = Color.White) }
            IconButton(onClick = { vm.clearChat() }) { Icon(Icons.Filled.DeleteSweep, "New conversation", tint = Color.White) }
        }
        if (vm.busy) LinearProgressIndicator(Modifier.fillMaxWidth())

        Box(Modifier.weight(1f).fillMaxWidth()) {
            if (vm.chat.isEmpty()) {
                Suggestions(onPick = { vm.ask(it, onSpeak) }, onBrief = { vm.morningBrief(onSpeak) })
            } else {
                LazyColumn(state = listState, modifier = Modifier.fillMaxSize().padding(horizontal = 12.dp)) {
                    items(vm.chat) { line -> Bubble(line) }
                }
            }
        }

        Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(
                value = input,
                onValueChange = { input = it },
                placeholder = { Text("Ask Jo…") },
                modifier = Modifier.weight(1f),
                maxLines = 3,
                trailingIcon = {
                    IconButton(onClick = { vm.ask(input, onSpeak); input = "" }, enabled = input.isNotBlank() && !vm.busy) {
                        Icon(Icons.AutoMirrored.Filled.Send, "Send")
                    }
                },
            )
            Spacer(Modifier.size(12.dp))
            FloatingActionButton(onClick = { if (!vm.busy) onMic() }, containerColor = MaterialTheme.colorScheme.primary) {
                Icon(Icons.Filled.Mic, "Speak", tint = Color.White, modifier = Modifier.size(30.dp))
            }
        }
    }
}

@Composable
private fun Bubble(line: JoViewModel.ChatLine) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = 4.dp),
        horizontalArrangement = if (line.fromUser) Arrangement.End else Arrangement.Start,
    ) {
        Text(
            line.text,
            color = if (line.fromUser) Color.White else Color(0xFF1B1B1B),
            modifier = Modifier
                .widthIn(max = 300.dp)
                .background(
                    if (line.fromUser) MaterialTheme.colorScheme.primary else Color(0xFFEDF1F5),
                    RoundedCornerShape(16.dp),
                )
                .padding(horizontal = 14.dp, vertical = 10.dp),
        )
    }
}

@Composable
private fun Suggestions(onPick: (String) -> Unit, onBrief: () -> Unit) {
    Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.Center) {
        Text("Hi Karthik 👋", fontSize = 24.sp, fontWeight = FontWeight.Bold)
        Text("Tap the mic and ask, or try:", color = Color.Gray, modifier = Modifier.padding(top = 4.dp, bottom = 12.dp))
        AssistChip(onClick = onBrief, label = { Text("Give me my morning brief") })
        listOf(
            "Any important unread mail?",
            "How many Kavery orders today?",
            "What are today's Thirumal sales?",
            "What's on my calendar today?",
            "Remind me to call the supplier at 5 PM",
        ).forEach { AssistChip(onClick = { onPick(it) }, label = { Text(it) }) }
    }
}
