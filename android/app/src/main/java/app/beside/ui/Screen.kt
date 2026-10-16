package app.beside.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ViewSidebar
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.ArrowUpward
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.KeyboardArrowDown
import androidx.compose.material.icons.outlined.Menu
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.Stop
import androidx.compose.material.icons.outlined.VolumeOff
import androidx.compose.material.icons.outlined.VolumeUp
import androidx.compose.material.icons.outlined.WifiOff
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.isShiftPressed
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.beside.LoadState
import app.beside.data.Chat
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId

private data class Starter(val title: String, val hint: String, val text: String)

private val STARTERS = listOf(
    Starter("Brain dump", "Empty your head, sort later", "I need to get everything out of my head. Help me sort it."),
    Starter("I can't get started", "Find a two-minute first step", "I can't get started on anything today."),
    Starter("Plan the next two hours", "Realistic, with breaks", "Help me plan the next two hours, gently."),
    Starter("Body double me", "Timer plus check-ins", "Body double me for 20 minutes while I tidy my desk."),
    Starter("I'm overwhelmed", "Shrink it down", "I'm overwhelmed and don't know what to do first."),
    Starter("Help me reply", "Draft the message you've avoided", "Help me write a short, kind reply to a message I've been avoiding."),
)

private fun greeting(name: String): String {
    val h = LocalTime.now().hour
    val part = when {
        h < 5 -> "Still up"
        h < 12 -> "Good morning"
        h < 18 -> "Good afternoon"
        else -> "Good evening"
    }
    return part + (if (name.isNotBlank()) ", ${name.trim()}" else "") + "."
}

@Composable
fun BesideScreen(state: UiState, actions: UiActions) {
    val c = Beside.colors
    BoxWithConstraints(Modifier.fillMaxSize().background(c.bg)) {
        val wide = maxWidth >= 1000.dp // tablet landscape
        val roomy = maxWidth >= 760.dp
        var drawer by rememberSaveable { mutableStateOf(false) }
        var todayOpen by rememberSaveable(wide) { mutableStateOf(wide) }
        LaunchedEffect(state.timer?.startedAt) { if (state.timer != null && wide) todayOpen = true }

        Row(Modifier.fillMaxSize()) {
            if (roomy) Sidebar(state, actions, Modifier.width(272.dp))
            ChatPane(
                state, actions, Modifier.weight(1f),
                showMenu = !roomy, onMenu = { drawer = true },
                todayOpen = todayOpen, onToday = { todayOpen = !todayOpen },
            )
            if (wide && todayOpen) Box(Modifier.width(340.dp).fillMaxHeight().background(c.sidebar)) {
                TodayPanel(state, actions, onClose = { todayOpen = false })
            }
        }
        // Narrower screens: conversations and Today slide over the chat.
        val overlay = (!roomy && drawer) || (!wide && todayOpen)
        AnimatedVisibility(overlay, enter = fadeIn(), exit = fadeOut()) {
            Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.3f)).clickable(onClickLabel = "Close") {
                drawer = false
                todayOpen = false
            })
        }
        AnimatedVisibility(!roomy && drawer, enter = slideInHorizontally { -it }, exit = slideOutHorizontally { -it }) {
            Sidebar(state, actions, Modifier.width(300.dp).fillMaxHeight(), onClose = { drawer = false }, onPicked = { drawer = false })
        }
        AnimatedVisibility(
            !wide && todayOpen, Modifier.align(Alignment.CenterEnd),
            enter = slideInHorizontally { it }, exit = slideOutHorizontally { it },
        ) {
            Box(Modifier.width(minOf(380.dp, maxWidth * 0.92f)).fillMaxHeight().background(c.sidebar)) {
                TodayPanel(state, actions, onClose = { todayOpen = false }, onAsked = { todayOpen = false })
            }
        }
        if (state.showSettings) SettingsSheet(state, actions)
    }
}

@Composable
private fun Sidebar(state: UiState, actions: UiActions, modifier: Modifier, onClose: (() -> Unit)? = null, onPicked: () -> Unit = {}) {
    val c = Beside.colors
    Column(modifier.fillMaxHeight().background(c.sidebar).statusBarsPadding().navigationBarsPadding().padding(10.dp)) {
        Row(Modifier.padding(horizontal = 8.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Logo(28.dp)
            Spacer(Modifier.width(10.dp))
            Text("Beside", style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
            if (onClose != null) IconButton(onClose) { Icon(Icons.Outlined.Close, "Close menu") }
        }
        Spacer(Modifier.height(8.dp))
        Surface(
            onClick = { actions.newChat(); onPicked() }, shape = RoundedCornerShape(12.dp), color = c.surface,
            border = BorderStroke(1.dp, c.border), shadowElevation = 1.dp, modifier = Modifier.fillMaxWidth(),
        ) {
            Row(Modifier.padding(horizontal = 14.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.Add, null, Modifier.size(18.dp))
                Spacer(Modifier.width(8.dp))
                Text("New chat", style = MaterialTheme.typography.labelLarge)
            }
        }
        LazyColumn(Modifier.weight(1f).padding(top = 6.dp)) {
            if (state.data.chats.isEmpty()) item {
                Text("Your chats stay on this tablet.", Modifier.padding(10.dp), color = c.muted, style = MaterialTheme.typography.bodyMedium)
            }
            for ((label, chats) in groupChats(state.data.chats)) {
                item(key = "g-$label") {
                    Text(label, Modifier.padding(start = 10.dp, top = 14.dp, bottom = 4.dp), color = c.muted, style = MaterialTheme.typography.labelMedium)
                }
                items(chats, key = { it.id }) { chat ->
                    val on = chat.id == state.activeChatId
                    Row(
                        Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp))
                            .background(if (on) c.text.copy(alpha = 0.07f) else Color.Transparent)
                            .clickable { actions.openChat(chat.id); onPicked() }
                            .padding(start = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(chat.title, Modifier.weight(1f).padding(vertical = 10.dp), maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyMedium)
                        if (on) IconButton({ actions.deleteChat(chat.id) }, Modifier.size(36.dp)) {
                            Icon(Icons.Outlined.DeleteOutline, "Delete chat ${chat.title}", Modifier.size(17.dp), tint = c.muted)
                        }
                    }
                }
            }
        }
        HorizontalDivider(color = c.border)
        Spacer(Modifier.height(10.dp))
        Surface(shape = RoundedCornerShape(10.dp), color = c.okSoft) {
            Row(Modifier.fillMaxWidth().padding(10.dp), verticalAlignment = Alignment.Top) {
                Icon(Icons.Outlined.WifiOff, null, Modifier.size(16.dp).padding(top = 2.dp), tint = c.ok)
                Spacer(Modifier.width(10.dp))
                Column {
                    Text("Private by design", color = c.ok, style = MaterialTheme.typography.labelLarge)
                    Text("Runs on this tablet. Works offline.", color = c.ok, style = MaterialTheme.typography.bodySmall)
                }
            }
        }
        Row(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).clickable { actions.openSettings(); onPicked() }.padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Outlined.Settings, null, Modifier.size(18.dp))
            Spacer(Modifier.width(10.dp))
            Text("Settings", style = MaterialTheme.typography.bodyMedium)
        }
    }
}

private fun groupChats(chats: List<Chat>): List<Pair<String, List<Chat>>> {
    val zone = ZoneId.systemDefault()
    val today = LocalDate.now(zone)
    return chats.sortedByDescending { it.updatedAt }.groupBy {
        val d = Instant.ofEpochMilli(it.updatedAt).atZone(zone).toLocalDate()
        when (d) {
            today -> "Today"
            today.minusDays(1) -> "Yesterday"
            else -> "Earlier"
        }
    }.toList()
}

@Composable
private fun ChatPane(
    state: UiState, actions: UiActions, modifier: Modifier,
    showMenu: Boolean, onMenu: () -> Unit, todayOpen: Boolean, onToday: () -> Unit,
) {
    val c = Beside.colors
    Column(modifier.fillMaxHeight().statusBarsPadding().imePadding()) {
        TopBar(state, actions, showMenu, onMenu, todayOpen, onToday)
        val chat = state.activeChat
        Box(Modifier.weight(1f).fillMaxWidth()) {
            if (chat == null) EmptyState(state, actions)
            else Conversation(chat, state, actions)
        }
        Dock(state, actions)
    }
}

@Composable
private fun TopBar(state: UiState, actions: UiActions, showMenu: Boolean, onMenu: () -> Unit, todayOpen: Boolean, onToday: () -> Unit) {
    val c = Beside.colors
    Row(Modifier.fillMaxWidth().height(60.dp).padding(horizontal = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        if (showMenu) IconButton(onMenu) { Icon(Icons.Outlined.Menu, "Open menu") }
        Row(
            Modifier.clip(RoundedCornerShape(10.dp)).clickable(onClickLabel = "Change model") { actions.openSettings() }
                .padding(horizontal = 10.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Dot(when (state.model) {
                is LoadState.Ready -> c.ok
                is LoadState.Working -> Color(0xFFD99A2B)
                is LoadState.Failed -> c.danger
                LoadState.Idle -> c.borderStrong
            })
            Spacer(Modifier.width(8.dp))
            Text(state.modelName, style = MaterialTheme.typography.titleMedium)
            Icon(Icons.Outlined.KeyboardArrowDown, null, Modifier.size(18.dp))
        }
        Text(
            when (val m = state.model) {
                is LoadState.Ready -> "On device"
                is LoadState.Working -> if (m.total > 0) "Downloading ${(100 * m.done / m.total)}%" else "Starting…"
                is LoadState.Failed -> "Needs attention"
                LoadState.Idle -> "Not started"
            },
            color = c.muted, style = MaterialTheme.typography.bodySmall, maxLines = 1,
        )
        Spacer(Modifier.weight(1f))
        val speak = state.settings.autoSpeak
        IconButton({ if (speak) actions.stop(); actions.updateSettings { it.copy(autoSpeak = !speak) } }) {
            Icon(if (speak) Icons.Outlined.VolumeUp else Icons.Outlined.VolumeOff, if (speak) "Voice replies on" else "Voice replies off", tint = if (speak) c.accentText else c.muted)
        }
        Box {
            IconButton(onToday) {
                Icon(Icons.AutoMirrored.Outlined.ViewSidebar, if (todayOpen) "Hide today panel" else "Show today panel", tint = if (todayOpen) c.accentText else c.text)
            }
            val t = state.timer
            if (t != null && !todayOpen) {
                val mins = maxOf(0L, (t.endsAt - state.now + 59_999) / 60_000)
                Surface(Modifier.align(Alignment.TopEnd), shape = CircleShape, color = c.accent) {
                    Text("${mins}m", Modifier.padding(horizontal = 5.dp, vertical = 1.dp), color = c.onAccent, style = MaterialTheme.typography.labelSmall)
                }
            }
        }
    }
}

@Composable
private fun EmptyState(state: UiState, actions: UiActions) {
    val c = Beside.colors
    LazyColumn(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally, contentPadding = PaddingValues(20.dp)) {
        item {
            Column(Modifier.widthIn(max = 760.dp).padding(top = 48.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Logo(48.dp)
                Spacer(Modifier.height(18.dp))
                Text(greeting(state.settings.name), style = MaterialTheme.typography.displaySmall, textAlign = TextAlign.Center)
                Spacer(Modifier.height(8.dp))
                Text("What's taking up space in your head? Type it messy. I'll answer out loud.", color = c.muted, style = MaterialTheme.typography.bodyLarge, textAlign = TextAlign.Center)
                Spacer(Modifier.height(26.dp))
                if (state.model is LoadState.Idle || state.model is LoadState.Failed) {
                    Card(soft = true) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                "Set up your private assistant. It downloads once, then runs entirely on this tablet with Wi-Fi off.",
                                Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium,
                            )
                            Spacer(Modifier.width(14.dp))
                            PrimaryButton("Choose a model", actions::openSettings)
                        }
                    }
                    Spacer(Modifier.height(20.dp))
                }
                BoxWithConstraints {
                    val cols = if (maxWidth > 560.dp) 3 else if (maxWidth > 360.dp) 2 else 1
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        for (row in STARTERS.chunked(cols)) Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            for (s in row) Surface(
                                onClick = { actions.send(s.text) }, modifier = Modifier.weight(1f).heightIn(min = 82.dp),
                                shape = RoundedCornerShape(14.dp), color = c.surface, border = BorderStroke(1.dp, c.border),
                            ) {
                                Column(Modifier.padding(14.dp)) {
                                    Text(s.title, style = MaterialTheme.typography.titleSmall)
                                    Spacer(Modifier.height(3.dp))
                                    Text(s.hint, color = c.muted, style = MaterialTheme.typography.bodySmall)
                                }
                            }
                            repeat(cols - row.size) { Spacer(Modifier.weight(1f)) }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun Conversation(chat: Chat, state: UiState, actions: UiActions) {
    val list = rememberLazyListState()
    val count = chat.messages.size + (if (state.draft != null) 1 else 0)
    LaunchedEffect(chat.id) { if (count > 0) list.scrollToItem(count - 1) }
    LaunchedEffect(count, state.draft?.length) { if (count > 0) list.animateScrollToItem(count - 1, scrollOffset = 100_000) }
    LazyColumn(
        Modifier.fillMaxSize().semantics { contentDescription = "Conversation" }, state = list,
        horizontalAlignment = Alignment.CenterHorizontally, contentPadding = PaddingValues(horizontal = 20.dp, vertical = 18.dp),
    ) {
        items(chat.messages, key = { it.id }) { m ->
            Box(Modifier.widthIn(max = 760.dp).fillMaxWidth()) {
                MessageView(m, onSpeak = { actions.speak(m.content) }, onUndo = { i -> actions.undo(chat.id, m.id, i) })
            }
        }
        if (state.draft != null) item(key = "draft") {
            Box(Modifier.widthIn(max = 760.dp).fillMaxWidth()) { DraftView(state.draft) }
        }
    }
}

@Composable
private fun Dock(state: UiState, actions: UiActions) {
    val c = Beside.colors
    var text by rememberSaveable { mutableStateOf("") }
    val send = {
        if (text.isNotBlank() && !state.generating) {
            actions.send(text)
            text = ""
        }
    }
    Column(
        Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 16.dp).padding(bottom = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Column(Modifier.widthIn(max = 760.dp).fillMaxWidth()) {
            val caption = state.caption
            if (caption != null) Surface(shape = RoundedCornerShape(16.dp), color = c.accentSoft, modifier = Modifier.padding(bottom = 10.dp)) {
                Row(Modifier.padding(start = 14.dp, end = 6.dp, top = 6.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Wave(c.accentText)
                    Spacer(Modifier.width(12.dp))
                    Text(caption, Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis, color = c.accentText, style = MaterialTheme.typography.bodyMedium)
                    LinkButton("Stop", actions::stop, Icons.Outlined.Stop)
                }
            } else if (state.toast != null) Surface(
                shape = RoundedCornerShape(16.dp), color = c.surface, border = BorderStroke(1.dp, c.border),
                shadowElevation = 2.dp, modifier = Modifier.padding(bottom = 10.dp),
            ) {
                Row(Modifier.padding(start = 14.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(state.toast, Modifier.weight(1f).padding(vertical = 10.dp), style = MaterialTheme.typography.bodyMedium)
                    IconButton(actions::dismissToast) { Icon(Icons.Outlined.Close, "Dismiss", Modifier.size(16.dp)) }
                }
            }
            Surface(shape = RoundedCornerShape(26.dp), color = c.surface, border = BorderStroke(1.dp, c.border), shadowElevation = 2.dp) {
                Row(Modifier.padding(start = 6.dp, end = 8.dp, top = 4.dp, bottom = 4.dp), verticalAlignment = Alignment.Bottom) {
                    TextField(
                        value = text, onValueChange = { text = it },
                        modifier = Modifier.weight(1f).heightIn(min = 52.dp, max = 200.dp).onPreviewKeyEvent { e ->
                            // Hardware keyboards: Enter sends, Shift+Enter adds a line.
                            if (e.type == KeyEventType.KeyDown && e.key == Key.Enter && !e.isShiftPressed) {
                                send(); true
                            } else false
                        },
                        placeholder = {
                            Text(
                                if (state.model is LoadState.Ready) "Message Beside…" else "Message Beside… (try /timer 15 or /task call the dentist)",
                                color = c.muted, maxLines = 1, overflow = TextOverflow.Ellipsis,
                            )
                        },
                        textStyle = MaterialTheme.typography.bodyLarge,
                        colors = TextFieldDefaults.colors(
                            focusedContainerColor = Color.Transparent, unfocusedContainerColor = Color.Transparent,
                            focusedIndicatorColor = Color.Transparent, unfocusedIndicatorColor = Color.Transparent,
                            cursorColor = c.accent,
                        ),
                        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, imeAction = ImeAction.Send),
                        keyboardActions = KeyboardActions(onSend = { send() }),
                    )
                    val busy = state.generating || state.caption != null
                    val canSend = text.isNotBlank()
                    Surface(
                        onClick = { if (busy) actions.stop() else send() },
                        enabled = busy || canSend,
                        shape = CircleShape,
                        color = when {
                            busy -> c.accent
                            canSend -> c.text
                            else -> c.borderStrong
                        },
                        modifier = Modifier.padding(bottom = 6.dp).size(44.dp),
                    ) {
                        Box(contentAlignment = Alignment.Center) {
                            if (busy) Icon(Icons.Outlined.Stop, "Stop", Modifier.size(20.dp), tint = c.onAccent)
                            else Icon(Icons.Outlined.ArrowUpward, "Send", Modifier.size(20.dp), tint = c.bg)
                        }
                    }
                }
            }
            Text(
                "Runs on this tablet. Beside can make mistakes and isn't medical advice.",
                Modifier.fillMaxWidth().padding(top = 8.dp), color = c.muted, textAlign = TextAlign.Center, style = MaterialTheme.typography.labelMedium,
            )
        }
    }
}

/** Five bars bouncing while the voice speaks. */
@Composable
fun Wave(color: Color) {
    val t = rememberInfiniteTransition(label = "wave")
    Row(Modifier.height(20.dp), horizontalArrangement = Arrangement.spacedBy(3.dp), verticalAlignment = Alignment.CenterVertically) {
        repeat(5) { i ->
            val h by t.animateFloat(0.3f, 1f, infiniteRepeatable(tween(450, delayMillis = i * 90), RepeatMode.Reverse), label = "bar$i")
            Box(Modifier.width(3.dp).fillMaxHeight(h).clip(RoundedCornerShape(2.dp)).background(color))
        }
    }
}
