package app.beside.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.NotificationsNone
import androidx.compose.material.icons.outlined.Pause
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material.icons.outlined.StickyNote2
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.beside.data.Task
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private val ENERGY = listOf(1 to "Empty", 2 to "Low", 3 to "Okay", 4 to "Good", 5 to "Wired")
private val ENERGY_COLORS = listOf(Color(0xFFB9A59A), Color(0xFFD9A17A), Color(0xFFD9B85A), Color(0xFF7AB88C), Color(0xFFC97BB0))
private val CYCLE = listOf(null to "Don't track", "period" to "Period", "follicular" to "After period", "ovulation" to "Mid-cycle", "luteal" to "Before period")
private val timeFormat = DateTimeFormatter.ofPattern("h:mm a")

private fun clock(ms: Long) = Instant.ofEpochMilli(ms).atZone(ZoneId.systemDefault()).toLocalTime().format(timeFormat)

@Composable
fun TodayPanel(state: UiState, actions: UiActions, onClose: () -> Unit, onAsked: () -> Unit = {}) {
    val c = Beside.colors
    val ask = { prompt: String -> onAsked(); actions.send(prompt) }
    val open = state.data.openTasks
    val focus = open.firstOrNull { it.pinned } ?: open.firstOrNull()
    val today = LocalDate.now()
    val doneToday = state.data.tasks.count { t ->
        t.done && t.doneAt != null && Instant.ofEpochMilli(t.doneAt).atZone(ZoneId.systemDefault()).toLocalDate() == today
    }
    Column(
        Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().verticalScroll(rememberScrollState())
            .padding(14.dp).semantics { contentDescription = "Today" },
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Today", Modifier.weight(1f).padding(start = 4.dp), style = MaterialTheme.typography.headlineSmall)
            IconButton(onClose) { Icon(Icons.Outlined.Close, "Close today panel") }
        }
        TimerCard(state, actions)
        if (focus != null) Card(soft = true) {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Eyebrow("One thing now", Icons.Outlined.AutoAwesome)
                Text(focus.title, style = MaterialTheme.typography.titleMedium)
                focus.steps.firstOrNull { !it.done }?.let { Text("Next: ${it.text}", style = MaterialTheme.typography.bodyMedium) }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    PrimaryButton("10 minutes on this", { actions.startTimer(10, focus.title) }, Icons.Outlined.PlayArrow)
                    QuietButton("Help me start", { ask("Help me start: ${focus.title}") })
                }
            }
        }
        Tasks(open, actions, ask)
        if (doneToday > 0) Row(Modifier.padding(horizontal = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Outlined.Check, null, Modifier.size(16.dp), tint = c.ok)
            Spacer(Modifier.width(6.dp))
            Text("$doneToday done today. That counts.", color = c.ok, style = MaterialTheme.typography.bodyMedium)
        }
        CheckInCard(state, actions)
        val upcoming = state.data.reminders.filter { !it.fired }.sortedBy { it.at }
        if (upcoming.isNotEmpty()) Card {
            Column {
                Header("Reminders", Icons.Outlined.NotificationsNone)
                for (r in upcoming) Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(clock(r.at), Modifier.width(76.dp), color = c.accentText, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyMedium)
                    Text(r.text, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                    IconButton({ actions.deleteReminder(r.id) }, Modifier.size(36.dp)) {
                        Icon(Icons.Outlined.DeleteOutline, "Delete reminder ${r.text}", Modifier.size(16.dp), tint = c.muted)
                    }
                }
            }
        }
        if (state.data.notes.isNotEmpty()) Card {
            Column {
                Header("Notes & brain dump", Icons.Outlined.StickyNote2)
                for (n in state.data.notes.sortedByDescending { it.createdAt }.take(12)) Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(n.text, Modifier.weight(1f).padding(vertical = 6.dp), style = MaterialTheme.typography.bodyMedium)
                    IconButton({ actions.deleteNote(n.id) }, Modifier.size(36.dp)) {
                        Icon(Icons.Outlined.DeleteOutline, "Delete note", Modifier.size(16.dp), tint = c.muted)
                    }
                }
                QuietButton("Sort these into tasks", { ask("Sort my brain dump notes into a few tasks and tell me which one to do first.") }, small = true)
            }
        }
    }
}

@Composable
private fun Header(text: String, icon: androidx.compose.ui.graphics.vector.ImageVector? = null) {
    Row(Modifier.padding(bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        if (icon != null) {
            Icon(icon, null, Modifier.size(17.dp))
            Spacer(Modifier.width(7.dp))
        }
        Text(text, style = MaterialTheme.typography.titleSmall)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TimerCard(state: UiState, actions: UiActions) {
    val c = Beside.colors
    val t = state.timer
    if (t == null) {
        Card {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Focus timer", style = MaterialTheme.typography.titleSmall)
                Text("A visible clock helps with time blindness. Beside checks in halfway.", color = c.muted, style = MaterialTheme.typography.bodySmall)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    for (m in listOf(5, 15, 25, 45)) QuietButton("$m min", { actions.startTimer(m, "Focus") }, small = true)
                }
            }
        }
        return
    }
    val total = (t.endsAt - t.startedAt).coerceAtLeast(1)
    val left = (t.endsAt - state.now).coerceAtLeast(0)
    val fraction = left.toFloat() / total
    Card {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(104.dp).semantics { contentDescription = "${left / 60000} minutes ${left / 1000 % 60} seconds left" }, contentAlignment = Alignment.Center) {
                Canvas(Modifier.size(104.dp)) {
                    val stroke = 8.dp.toPx()
                    val inset = stroke / 2
                    val s = Size(size.width - stroke, size.height - stroke)
                    drawArc(c.user, 0f, 360f, false, Offset(inset, inset), s, style = Stroke(stroke))
                    drawArc(c.accent, -90f, 360f * fraction, false, Offset(inset, inset), s, style = Stroke(stroke, cap = StrokeCap.Round))
                }
                Text(
                    if (left == 0L) "Done" else "%d:%02d".format(left / 60000, left / 1000 % 60),
                    fontWeight = FontWeight.Bold, fontSize = 21.sp,
                )
            }
            Spacer(Modifier.width(14.dp))
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Eyebrow("Focusing on")
                Text(t.label, style = MaterialTheme.typography.titleMedium)
                Text("Ends at ${clock(t.endsAt)}", color = c.muted, style = MaterialTheme.typography.bodySmall)
                QuietButton(if (left == 0L) "Clear" else "Stop", actions::stopTimer, Icons.Outlined.Pause, small = true)
            }
        }
    }
}

@Composable
private fun Tasks(open: List<Task>, actions: UiActions, ask: (String) -> Unit) {
    val c = Beside.colors
    var draft by rememberSaveable { mutableStateOf("") }
    var expanded by remember { mutableStateOf<String?>(null) }
    val add = {
        if (draft.isNotBlank()) {
            actions.addTask(draft.trim())
            draft = ""
        }
    }
    Card {
        Column {
            Header("To do")
            Row(verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(
                    draft, { draft = it }, Modifier.weight(1f), placeholder = { Text("Add something…", color = c.muted) },
                    singleLine = true, shape = RoundedCornerShape(10.dp),
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done), keyboardActions = KeyboardActions(onDone = { add() }),
                    colors = OutlinedTextFieldDefaults.colors(unfocusedBorderColor = c.border, focusedBorderColor = c.borderStrong),
                )
                Spacer(Modifier.width(6.dp))
                IconButton(add, enabled = draft.isNotBlank()) { Icon(Icons.Outlined.Add, "Add task") }
            }
            Spacer(Modifier.height(6.dp))
            if (open.isEmpty()) Text(
                "Nothing here yet. Tell Beside what's on your mind and it can sort it for you.",
                color = c.muted, style = MaterialTheme.typography.bodySmall,
            )
            open.forEachIndexed { i, t ->
                if (i > 0) HorizontalDivider(color = c.border)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(
                        Modifier.size(24.dp).clip(CircleShape).border(2.dp, c.borderStrong, CircleShape)
                            .clickable(onClickLabel = "Mark ${t.title} done") { actions.toggleTask(t.id) },
                    )
                    Row(
                        Modifier.weight(1f).clickable { expanded = if (expanded == t.id) null else t.id }.padding(horizontal = 10.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(t.title, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                        if (t.steps.isNotEmpty()) Surface(shape = CircleShape, color = c.user) {
                            Text("${t.steps.count { it.done }}/${t.steps.size}", Modifier.padding(horizontal = 7.dp, vertical = 1.dp), color = c.muted, style = MaterialTheme.typography.labelSmall)
                        }
                    }
                    IconButton({ actions.deleteTask(t.id) }, Modifier.size(36.dp)) {
                        Icon(Icons.Outlined.DeleteOutline, "Delete ${t.title}", Modifier.size(16.dp), tint = c.muted)
                    }
                }
                if (expanded == t.id) Column(Modifier.padding(start = 26.dp, bottom = 8.dp)) {
                    t.steps.forEachIndexed { j, s ->
                        Row(Modifier.clickable { actions.toggleStep(t.id, j) }, verticalAlignment = Alignment.CenterVertically) {
                            Checkbox(s.done, { actions.toggleStep(t.id, j) }, colors = CheckboxDefaults.colors(checkedColor = c.ok))
                            Text(
                                s.text, color = if (s.done) c.muted else c.text, style = MaterialTheme.typography.bodyMedium,
                                textDecoration = if (s.done) TextDecoration.LineThrough else null,
                            )
                        }
                    }
                    LinkButton(if (t.steps.isEmpty()) "Break it down" else "Make the steps smaller", { ask("Break \"${t.title}\" into tiny steps.") }, Icons.Outlined.AutoAwesome)
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun CheckInCard(state: UiState, actions: UiActions) {
    val c = Beside.colors
    val last = state.data.lastCheckIn
    val recent = last != null && state.now - last.at < 4 * 3_600_000
    var cycle by rememberSaveable { mutableStateOf<String?>(null) }
    Card {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("How's your energy?", style = MaterialTheme.typography.titleSmall)
            if (recent) Text(
                "Last: ${ENERGY[last!!.energy - 1].second.lowercase()} at ${clock(last.at)}. Suggestions adjust to this.",
                color = c.muted, style = MaterialTheme.typography.bodySmall,
            )
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                for ((value, label) in ENERGY) {
                    val on = recent && last?.energy == value
                    Surface(
                        onClick = { actions.checkIn(value, cycle) }, shape = CircleShape,
                        color = if (on) c.accentSoft else c.surface, border = BorderStroke(1.dp, if (on) c.accent else c.border),
                    ) {
                        Row(Modifier.padding(horizontal = 11.dp, vertical = 7.dp), verticalAlignment = Alignment.CenterVertically) {
                            Dot(ENERGY_COLORS[value - 1])
                            Spacer(Modifier.width(6.dp))
                            Text(label, color = if (on) c.accentText else c.text, style = MaterialTheme.typography.labelMedium)
                        }
                    }
                }
            }
            Text("Cycle (optional, stays on this tablet)", color = c.muted, style = MaterialTheme.typography.bodySmall)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                for ((value, label) in CYCLE) {
                    val on = cycle == value
                    Surface(onClick = { cycle = value }, shape = RoundedCornerShape(8.dp), color = if (on) c.user else Color.Transparent) {
                        Text(label, Modifier.padding(horizontal = 9.dp, vertical = 5.dp), color = if (on) c.text else c.muted, style = MaterialTheme.typography.labelMedium)
                    }
                }
            }
        }
    }
}
