package app.beside.ui

import androidx.compose.foundation.BorderStroke
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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material.icons.outlined.FileOpen
import androidx.compose.material.icons.outlined.IosShare
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Memory
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material.icons.outlined.RecordVoiceOver
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.RadioButton
import androidx.compose.material3.RadioButtonDefaults
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import app.beside.LoadState
import app.beside.llm.MODELS
import app.beside.llm.VOICES

private enum class Tab(val label: String, val icon: ImageVector) {
    Assistant("Assistant", Icons.Outlined.Memory),
    Voice("Voice", Icons.Outlined.RecordVoiceOver),
    You("About you", Icons.Outlined.Person),
    Privacy("Privacy & storage", Icons.Outlined.Lock),
}

@Composable
fun SettingsSheet(state: UiState, actions: UiActions) {
    Dialog(actions::closeSettings, DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        SettingsContent(state, actions)
    }
}

/** The sheet's contents, separate from the dialog window so it can be screenshot-tested. */
@Composable
fun SettingsContent(state: UiState, actions: UiActions, initial: Int = 0) {
    val c = Beside.colors
    var tab by rememberSaveable { mutableStateOf(Tab.entries[initial]) }
    Box(Modifier.fillMaxSize().padding(20.dp), contentAlignment = Alignment.Center) {
        Surface(Modifier.widthIn(max = 720.dp).fillMaxWidth().heightIn(max = 900.dp), shape = RoundedCornerShape(22.dp), color = c.bg, shadowElevation = 12.dp) {
            Column {
                Row(Modifier.padding(start = 22.dp, end = 12.dp, top = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(if (state.settings.setupDone) "Settings" else "Set up Beside", Modifier.weight(1f), style = MaterialTheme.typography.headlineSmall)
                    IconButton(actions::closeSettings) { Icon(Icons.Outlined.Close, "Close settings") }
                }
                Row(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    for (t in Tab.entries) {
                        val on = t == tab
                        Surface(onClick = { tab = t }, shape = RoundedCornerShape(10.dp), color = if (on) c.surface else Color.Transparent, shadowElevation = if (on) 1.dp else 0.dp) {
                            Row(Modifier.padding(horizontal = 12.dp, vertical = 9.dp), verticalAlignment = Alignment.CenterVertically) {
                                Icon(t.icon, null, Modifier.size(16.dp), tint = if (on) c.text else c.muted)
                                Spacer(Modifier.width(6.dp))
                                Text(t.label, color = if (on) c.text else c.muted, style = MaterialTheme.typography.labelLarge)
                            }
                        }
                    }
                }
                HorizontalDivider(color = c.border)
                Column(Modifier.verticalScroll(rememberScrollState()).padding(22.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    when (tab) {
                        Tab.Assistant -> AssistantTab(state, actions)
                        Tab.Voice -> VoiceTab(state, actions)
                        Tab.You -> YouTab(state, actions)
                        Tab.Privacy -> PrivacyTab(state, actions)
                    }
                }
            }
        }
    }
}

@Composable
private fun AssistantTab(state: UiState, actions: UiActions) {
    val c = Beside.colors
    val selected = state.settings.modelId.ifEmpty { state.recommendedId }
    var choice by rememberSaveable { mutableStateOf(selected) }
    val busy = state.model is LoadState.Working
    Text(
        "Pick the brain Beside runs on. It downloads once, then works with Wi-Fi off. This tablet has about %.0f GB of memory.".format(state.ramGb),
        style = MaterialTheme.typography.bodyLarge,
    )
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        for (m in MODELS) {
            val on = choice == m.id
            Surface(
                onClick = { choice = m.id }, shape = RoundedCornerShape(14.dp),
                color = if (on) c.accentSoft else c.surface, border = BorderStroke(1.5.dp, if (on) c.accent else c.border),
            ) {
                Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.Top) {
                    RadioButton(on, { choice = m.id }, colors = RadioButtonDefaults.colors(selectedColor = c.accent))
                    Column(Modifier.weight(1f).padding(top = 10.dp)) {
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text(m.name, style = MaterialTheme.typography.titleSmall)
                            if (m.id == state.recommendedId) Badge("Recommended", c.accentSoft, c.accentText)
                            if (m.id in state.downloaded) Badge("On tablet", c.okSoft, c.ok)
                            if (m.id == state.settings.modelId && state.model is LoadState.Ready) Badge("Running", c.okSoft, c.ok)
                        }
                        Text(m.blurb, color = c.muted, style = MaterialTheme.typography.bodySmall)
                        if (state.ramGb + 0.5 < m.minRamGb) Text("May not fit in this tablet's memory.", color = c.accentText, style = MaterialTheme.typography.bodySmall)
                    }
                    Text("%.1f GB".format(m.sizeGb), Modifier.padding(top = 10.dp), color = c.muted, style = MaterialTheme.typography.bodySmall)
                }
            }
        }
        for (f in state.customFiles) {
            val id = "file:$f"
            val on = choice == id
            Surface(onClick = { choice = id }, shape = RoundedCornerShape(14.dp), color = if (on) c.accentSoft else c.surface, border = BorderStroke(1.5.dp, if (on) c.accent else c.border)) {
                Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    RadioButton(on, { choice = id }, colors = RadioButtonDefaults.colors(selectedColor = c.accent))
                    Column(Modifier.weight(1f)) {
                        Text(f.removeSuffix(".gguf"), style = MaterialTheme.typography.titleSmall)
                        Text("Your own model file", color = c.muted, style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }
    }
    val downloaded = choice in state.downloaded || choice.startsWith("file:")
    PrimaryButton(
        if (downloaded) "Start this model" else "Download and start", { actions.startModel(choice) },
        if (downloaded) Icons.Outlined.PlayArrow else Icons.Outlined.Download, enabled = !busy,
    )
    LoadProgress(state.model)
    Text(
        "Download on Wi-Fi with the tablet plugged in. If it stops, tap again and it continues where it left off.",
        color = c.muted, style = MaterialTheme.typography.bodySmall,
    )
}

@Composable
private fun Badge(text: String, bg: Color, fg: Color) {
    Surface(shape = RoundedCornerShape(99.dp), color = bg) {
        Text(text, Modifier.padding(horizontal = 8.dp, vertical = 2.dp), color = fg, style = MaterialTheme.typography.labelSmall)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun VoiceTab(state: UiState, actions: UiActions) {
    val c = Beside.colors
    val s = state.settings
    Text(
        "Kokoro is a natural neural voice that runs on the tablet (about 130 MB). Beside starts speaking after the first phrase, so you don't wait for the whole answer.",
        style = MaterialTheme.typography.bodyLarge,
    )
    SwitchRow("Read every reply aloud", s.autoSpeak) { v -> actions.updateSettings { it.copy(autoSpeak = v) } }
    Segmented(listOf("kokoro" to "Natural (Kokoro)", "system" to "Tablet's built-in voice"), s.engine) { v -> actions.updateSettings { it.copy(engine = v) } }
    if (s.engine == "kokoro") {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            for (v in VOICES) {
                val on = v.id == s.voice
                Surface(
                    onClick = { actions.updateSettings { it.copy(voice = v.id) } }, shape = RoundedCornerShape(12.dp),
                    color = if (on) c.accentSoft else c.surface, border = BorderStroke(1.5.dp, if (on) c.accent else c.border),
                    modifier = Modifier.width(150.dp),
                ) {
                    Column(Modifier.padding(10.dp)) {
                        Text(v.name, style = MaterialTheme.typography.titleSmall)
                        Text("${v.accent} · ${v.note}", color = c.muted, style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }
        if (state.voice !is LoadState.Ready) PrimaryButton(
            if (state.voiceDownloaded) "Start the natural voice" else "Download the natural voice",
            actions::downloadVoice, Icons.Outlined.Download, enabled = state.voice !is LoadState.Working,
        )
        LoadProgress(state.voice)
    }
    Column {
        Text("Speaking speed  %.2f×".format(s.speed), style = MaterialTheme.typography.titleSmall)
        Slider(
            s.speed, { v -> actions.updateSettings { it.copy(speed = (v * 20).toInt() / 20f) } }, valueRange = 0.8f..1.4f,
            colors = SliderDefaults.colors(thumbColor = c.accent, activeTrackColor = c.accent, inactiveTrackColor = c.user),
        )
        Text(
            "Kokoro re-paces its own speech instead of fast-forwarding audio, so it stays human up to about 1.3×.",
            color = c.muted, style = MaterialTheme.typography.bodySmall,
        )
    }
    QuietButton("Hear a sample", actions::previewVoice, Icons.Outlined.PlayArrow)
}

@Composable
private fun YouTab(state: UiState, actions: UiActions) {
    val c = Beside.colors
    val s = state.settings
    val fieldColors = OutlinedTextFieldDefaults.colors(unfocusedBorderColor = c.border, focusedBorderColor = c.borderStrong, unfocusedContainerColor = c.surface, focusedContainerColor = c.surface)
    OutlinedTextField(s.name, { v -> actions.updateSettings { it.copy(name = v.take(40)) } }, Modifier.fillMaxWidth(), label = { Text("What should Beside call you?") }, singleLine = true, colors = fieldColors, shape = RoundedCornerShape(12.dp))
    OutlinedTextField(
        s.aboutMe, { v -> actions.updateSettings { it.copy(aboutMe = v.take(600)) } }, Modifier.fillMaxWidth().heightIn(min = 120.dp),
        label = { Text("Anything that helps Beside help you") },
        placeholder = { Text("e.g. Mornings are hard. I work from home. Long lists overwhelm me, so give me one thing at a time.", color = c.muted) },
        colors = fieldColors, shape = RoundedCornerShape(12.dp),
    )
    Text("Replies", style = MaterialTheme.typography.titleSmall)
    Segmented(listOf("short" to "Short answers (faster)", "normal" to "Fuller answers"), s.replyLength) { v -> actions.updateSettings { it.copy(replyLength = v) } }
    Text("Text size", style = MaterialTheme.typography.titleSmall)
    val sizes = mapOf("s" to 0.9f, "m" to 1f, "l" to 1.15f)
    val size = sizes.minBy { kotlin.math.abs(it.value - s.textScale) }.key
    Segmented(listOf("s" to "Small", "m" to "Medium", "l" to "Large"), size) { v ->
        actions.updateSettings { it.copy(textScale = sizes.getValue(v)) }
    }
    Text("Theme", style = MaterialTheme.typography.titleSmall)
    Segmented(listOf("system" to "System", "light" to "Light", "dark" to "Dark"), s.theme) { v -> actions.updateSettings { it.copy(theme = v) } }
}

@Composable
private fun PrivacyTab(state: UiState, actions: UiActions) {
    val c = Beside.colors
    Surface(shape = RoundedCornerShape(12.dp), color = c.okSoft) {
        Text(
            "Chats, tasks, notes and check-ins are stored only on this tablet. Beside uses the internet only to download a model or voice when you tap download.",
            Modifier.padding(12.dp), color = c.ok, style = MaterialTheme.typography.bodyMedium,
        )
    }
    Text("%.1f GB free on the tablet.".format(state.freeGb), color = c.muted, style = MaterialTheme.typography.bodyMedium)
    Text("Models on this tablet", style = MaterialTheme.typography.titleSmall)
    val onTablet = MODELS.filter { it.id in state.downloaded }
    if (onTablet.isEmpty()) Text("None yet.", color = c.muted, style = MaterialTheme.typography.bodyMedium)
    for (m in onTablet) Row(verticalAlignment = Alignment.CenterVertically) {
        Text("${m.name} · %.1f GB".format(m.sizeGb), Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
        if (m.id != state.settings.modelId) QuietButton("Remove", { actions.deleteModel(m) }, Icons.Outlined.DeleteOutline, small = true)
        else Text("In use", color = c.muted, style = MaterialTheme.typography.bodySmall)
    }
    Text("Set up with no internet", style = MaterialTheme.typography.titleSmall)
    Text(
        "Copy a .gguf model file onto the tablet (from a computer or USB stick), then choose it here. You can also copy it straight into Android/data/app.beside.companion/files/models.",
        color = c.muted, style = MaterialTheme.typography.bodySmall,
    )
    QuietButton("Choose a model file", actions::importModel, Icons.Outlined.FileOpen)
    Text("Your data", style = MaterialTheme.typography.titleSmall)
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        QuietButton("Export everything", actions::exportData, Icons.Outlined.IosShare)
        var confirm by rememberSaveable { mutableStateOf(false) }
        if (!confirm) QuietButton("Erase chats and tasks", { confirm = true }, Icons.Outlined.DeleteOutline)
        else PrimaryButton("Tap again to erase", { confirm = false; actions.eraseAll() }, Icons.Outlined.DeleteOutline)
    }
}

@Composable
private fun SwitchRow(label: String, value: Boolean, onChange: (Boolean) -> Unit) {
    val c = Beside.colors
    Row(Modifier.fillMaxWidth().clickable { onChange(!value) }, verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
        Switch(value, onChange, colors = SwitchDefaults.colors(checkedTrackColor = c.accent))
    }
}

@Composable
private fun Segmented(options: List<Pair<String, String>>, value: String, onPick: (String) -> Unit) {
    val c = Beside.colors
    Surface(shape = RoundedCornerShape(12.dp), color = c.user) {
        Row(Modifier.padding(3.dp), horizontalArrangement = Arrangement.spacedBy(3.dp)) {
            for ((v, label) in options) {
                val on = v == value
                Surface(onClick = { onPick(v) }, shape = RoundedCornerShape(10.dp), color = if (on) c.surface else Color.Transparent, shadowElevation = if (on) 1.dp else 0.dp) {
                    Text(label, Modifier.padding(horizontal = 14.dp, vertical = 9.dp), color = if (on) c.text else c.muted, style = MaterialTheme.typography.labelLarge)
                }
            }
        }
    }
}
