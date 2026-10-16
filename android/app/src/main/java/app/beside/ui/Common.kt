package app.beside.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.beside.AppViewModel
import app.beside.LoadState
import app.beside.TimerState
import app.beside.data.AppData
import app.beside.data.Settings
import app.beside.llm.ModelChoice

/** Everything the screens show, so they can be previewed and screenshot-tested without a device. */
data class UiState(
    val data: AppData = AppData(),
    val settings: Settings = Settings(),
    val activeChatId: String? = null,
    val draft: String? = null,
    val caption: String? = null,
    val model: LoadState = LoadState.Idle,
    val voice: LoadState = LoadState.Idle,
    val modelName: String = "Choose a model",
    val timer: TimerState? = null,
    val now: Long = System.currentTimeMillis(),
    val toast: String? = null,
    val showSettings: Boolean = false,
    val downloaded: Set<String> = emptySet(),
    val customFiles: List<String> = emptyList(),
    val voiceDownloaded: Boolean = false,
    val ramGb: Double = 8.0,
    val recommendedId: String = "qwen3.5-4b",
    val freeGb: Double = 50.0,
    val voiceRtf: Float? = null,
) {
    val activeChat get() = data.chats.firstOrNull { it.id == activeChatId }
    val generating get() = draft != null
}

/** Callbacks from the screens. MainActivity forwards these to [AppViewModel]. */
interface UiActions {
    fun send(text: String) {}
    fun stop() {}
    fun newChat() {}
    fun openChat(id: String) {}
    fun deleteChat(id: String) {}
    fun undo(chatId: String, messageId: String, index: Int) {}
    fun speak(text: String) {}
    fun addTask(title: String) {}
    fun toggleTask(id: String) {}
    fun toggleStep(id: String, index: Int) {}
    fun deleteTask(id: String) {}
    fun deleteReminder(id: String) {}
    fun deleteNote(id: String) {}
    fun checkIn(energy: Int, cycle: String?) {}
    fun startTimer(minutes: Int, label: String) {}
    fun stopTimer() {}
    fun openSettings() {}
    fun closeSettings() {}
    fun updateSettings(change: (Settings) -> Settings) {}
    fun startModel(id: String) {}
    fun downloadVoice() {}
    fun deleteModel(m: ModelChoice) {}
    fun importModel() {}
    fun exportData() {}
    fun eraseAll() {}
    fun dismissToast() {}
    fun previewVoice() {}
}

/** The Beside mark: a soft dot with two sound waves. */
@Composable
fun Logo(size: Dp = 28.dp) {
    val c = Beside.colors
    Box(Modifier.size(size).clip(RoundedCornerShape(size * 0.31f)).background(c.accentSoft)) {
        Canvas(Modifier.matchParentSize()) {
            val s = this.size.width / 64f
            drawCircle(c.accent, radius = 9f * s, center = Offset(25f * s, 32f * s))
            val stroke = Stroke(width = 4.5f * s, cap = StrokeCap.Round)
            drawArc(c.accent, -55f, 110f, false, Offset(24f * s, 20f * s), Size(20f * s, 24f * s), style = stroke)
            drawArc(c.accent, -55f, 110f, false, Offset(23f * s, 14f * s), Size(32f * s, 36f * s), style = stroke)
        }
    }
}

/** Small, safe markdown subset: paragraphs, bullets, numbered lists and bold. */
@Composable
fun RichText(text: String, modifier: Modifier = Modifier) {
    val c = Beside.colors
    Column(modifier, verticalArrangement = Arrangement.spacedBy(10.dp)) {
        for (para in text.split(Regex("\\n{2,}"))) {
            val lines = para.split("\n").filter { it.isNotBlank() }
            if (lines.isEmpty()) continue
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                for (line in lines) {
                    val bullet = Regex("^\\s*[-*•]\\s+(.*)$").find(line)
                    val numbered = Regex("^\\s*(\\d+)[.)]\\s+(.*)$").find(line)
                    when {
                        bullet != null -> Row {
                            Text("•", Modifier.width(20.dp), color = c.muted, style = MaterialTheme.typography.bodyLarge)
                            Text(inline(bullet.groupValues[1]), style = MaterialTheme.typography.bodyLarge)
                        }
                        numbered != null -> Row {
                            Text("${numbered.groupValues[1]}.", Modifier.width(24.dp), color = c.muted, style = MaterialTheme.typography.bodyLarge)
                            Text(inline(numbered.groupValues[2]), style = MaterialTheme.typography.bodyLarge)
                        }
                        else -> Text(inline(line.replace(Regex("^#{1,6}\\s+"), "")), style = MaterialTheme.typography.bodyLarge)
                    }
                }
            }
        }
    }
}

private fun inline(text: String): AnnotatedString = buildAnnotatedString {
    for (part in splitKeeping(text)) {
        if (part.startsWith("**") && part.endsWith("**") && part.length > 4) withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { append(part.substring(2, part.length - 2)) }
        else append(part.replace(Regex("(^|\\s)[*_]([^*_]+)[*_](?=\\s|$|[.,!?])"), "$1$2"))
    }
}

private fun splitKeeping(text: String): List<String> {
    val out = mutableListOf<String>()
    var last = 0
    for (m in Regex("\\*\\*[^*]+\\*\\*").findAll(text)) {
        if (m.range.first > last) out += text.substring(last, m.range.first)
        out += m.value
        last = m.range.last + 1
    }
    if (last < text.length) out += text.substring(last)
    return out
}

@Composable
fun PrimaryButton(text: String, onClick: () -> Unit, icon: ImageVector? = null, enabled: Boolean = true, modifier: Modifier = Modifier) {
    val c = Beside.colors
    Button(
        onClick, modifier, enabled = enabled, shape = RoundedCornerShape(12.dp),
        colors = ButtonDefaults.buttonColors(containerColor = c.accent, contentColor = c.onAccent),
        contentPadding = PaddingValues(horizontal = 18.dp, vertical = 12.dp),
    ) {
        if (icon != null) {
            Icon(icon, null, Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
        }
        Text(text, style = MaterialTheme.typography.labelLarge)
    }
}

@Composable
fun QuietButton(text: String, onClick: () -> Unit, icon: ImageVector? = null, modifier: Modifier = Modifier, small: Boolean = false) {
    val c = Beside.colors
    OutlinedButton(
        onClick, modifier, shape = RoundedCornerShape(if (small) 9.dp else 12.dp),
        border = BorderStroke(1.dp, c.border),
        colors = ButtonDefaults.outlinedButtonColors(containerColor = c.surface, contentColor = c.text),
        contentPadding = if (small) PaddingValues(horizontal = 12.dp, vertical = 6.dp) else PaddingValues(horizontal = 16.dp, vertical = 11.dp),
    ) {
        if (icon != null) {
            Icon(icon, null, Modifier.size(if (small) 15.dp else 18.dp))
            Spacer(Modifier.width(6.dp))
        }
        Text(text, style = if (small) MaterialTheme.typography.labelMedium else MaterialTheme.typography.labelLarge)
    }
}

@Composable
fun LinkButton(text: String, onClick: () -> Unit, icon: ImageVector? = null) {
    TextButton(onClick, contentPadding = PaddingValues(horizontal = 10.dp, vertical = 4.dp)) {
        if (icon != null) {
            Icon(icon, null, Modifier.size(15.dp), tint = Beside.colors.muted)
            Spacer(Modifier.width(5.dp))
        }
        Text(text, color = Beside.colors.muted, style = MaterialTheme.typography.labelMedium)
    }
}

@Composable
fun Card(modifier: Modifier = Modifier, soft: Boolean = false, content: @Composable () -> Unit) {
    val c = Beside.colors
    Surface(
        modifier.fillMaxWidth(), shape = RoundedCornerShape(16.dp),
        color = if (soft) c.accentSoft else c.surface,
        border = if (soft) null else BorderStroke(1.dp, c.border),
    ) { Box(Modifier.padding(14.dp)) { content() } }
}

@Composable
fun LoadProgress(state: LoadState) {
    val c = Beside.colors
    when (state) {
        is LoadState.Working -> Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            if (state.total > 0) LinearProgressIndicator(
                progress = { (state.done.toFloat() / state.total).coerceIn(0f, 1f) },
                modifier = Modifier.fillMaxWidth().height(8.dp).clip(CircleShape), color = c.accent, trackColor = c.user,
                drawStopIndicator = {},
            ) else LinearProgressIndicator(Modifier.fillMaxWidth().height(8.dp).clip(CircleShape), color = c.accent, trackColor = c.user)
            val amount = if (state.total > 0) " · %.2f of %.2f GB".format(state.done / 1e9, state.total / 1e9) else ""
            Text(state.label + amount, color = c.muted, style = MaterialTheme.typography.bodySmall)
        }
        is LoadState.Failed -> Surface(shape = RoundedCornerShape(10.dp), color = c.dangerSoft) {
            Text(state.message, Modifier.padding(10.dp), color = c.danger, style = MaterialTheme.typography.bodyMedium)
        }
        is LoadState.Ready -> Text(state.detail, color = c.ok, style = MaterialTheme.typography.bodyMedium)
        LoadState.Idle -> {}
    }
}

@Composable
fun Dot(color: androidx.compose.ui.graphics.Color, size: Dp = 8.dp) {
    Box(Modifier.size(size).clip(CircleShape).background(color))
}

@Composable
fun Eyebrow(text: String, icon: ImageVector? = null) {
    val c = Beside.colors
    Row(verticalAlignment = Alignment.CenterVertically) {
        if (icon != null) {
            Icon(icon, null, Modifier.size(14.dp), tint = c.accentText)
            Spacer(Modifier.width(6.dp))
        }
        Text(text.uppercase(), color = c.accentText, style = MaterialTheme.typography.labelSmall)
    }
}
