package app.beside.ui

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Undo
import androidx.compose.material.icons.outlined.VolumeUp
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import app.beside.data.Message

@Composable
fun MessageView(m: Message, onSpeak: () -> Unit, onUndo: (Int) -> Unit) {
    val c = Beside.colors
    if (m.role == "user") {
        Row(Modifier.fillMaxWidth().padding(bottom = 22.dp), horizontalArrangement = Arrangement.End) {
            Surface(
                shape = RoundedCornerShape(topStart = 20.dp, topEnd = 20.dp, bottomStart = 20.dp, bottomEnd = 6.dp),
                color = c.user, modifier = Modifier.widthIn(max = 560.dp),
            ) { Text(m.content, Modifier.padding(horizontal = 16.dp, vertical = 10.dp), color = c.text, style = MaterialTheme.typography.bodyLarge) }
        }
        return
    }
    Row(Modifier.fillMaxWidth().padding(bottom = 22.dp)) {
        Box(Modifier.padding(top = 2.dp)) { Logo(26.dp) }
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            if (m.content.isNotBlank()) RichText(m.content)
            if (m.actions.isNotEmpty()) {
                Spacer(Modifier.padding(top = 12.dp))
                Surface(shape = RoundedCornerShape(14.dp), color = c.surface, border = BorderStroke(1.dp, c.border), shadowElevation = 1.dp) {
                    Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        m.actions.forEachIndexed { i, a ->
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Box(
                                    Modifier.size(22.dp).clip(CircleShape).background(
                                        when {
                                            !a.ok -> c.danger
                                            a.undone -> c.borderStrong
                                            else -> c.ok
                                        },
                                    ),
                                    contentAlignment = Alignment.Center,
                                ) { Icon(if (a.ok) Icons.Outlined.Check else Icons.Outlined.Close, null, Modifier.size(14.dp), tint = c.surface) }
                                Spacer(Modifier.width(10.dp))
                                Text(
                                    a.summary, Modifier.weight(1f).padding(vertical = 6.dp),
                                    color = if (a.undone) c.muted else c.text,
                                    textDecoration = if (a.undone) TextDecoration.LineThrough else null,
                                    style = MaterialTheme.typography.bodyMedium,
                                )
                                if (a.ok && a.undo != null && !a.undone) LinkButton("Undo", { onUndo(i) }, Icons.Outlined.Undo)
                            }
                        }
                    }
                }
            }
            m.error?.let {
                Spacer(Modifier.padding(top = 8.dp))
                Surface(shape = RoundedCornerShape(10.dp), color = c.dangerSoft) {
                    Text(it, Modifier.padding(10.dp), color = c.danger, style = MaterialTheme.typography.bodyMedium)
                }
            }
            if (m.content.isNotBlank()) {
                val clipboard = LocalClipboardManager.current
                Row(Modifier.padding(top = 4.dp).alpha(0.75f), verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onSpeak, Modifier.size(36.dp)) { Icon(Icons.Outlined.VolumeUp, "Read aloud", Modifier.size(17.dp), tint = c.muted) }
                    IconButton({ clipboard.setText(AnnotatedString(m.content)) }, Modifier.size(36.dp)) {
                        Icon(Icons.Outlined.ContentCopy, "Copy", Modifier.size(16.dp), tint = c.muted)
                    }
                    m.stats?.takeIf { it.tokensPerSecond > 0 }?.let { s ->
                        Text(
                            "%.1f tok/s · first word in %.1fs".format(s.tokensPerSecond, s.firstTokenMs / 1000),
                            Modifier.padding(start = 6.dp), color = c.muted, style = MaterialTheme.typography.labelMedium,
                        )
                    }
                }
            }
        }
    }
}

@Composable
fun DraftView(text: String) {
    Row(Modifier.fillMaxWidth().padding(bottom = 22.dp)) {
        Box(Modifier.padding(top = 2.dp)) { Logo(26.dp) }
        Spacer(Modifier.width(14.dp))
        if (text.isEmpty()) TypingDots() else RichText(text, Modifier.weight(1f))
    }
}

@Composable
private fun TypingDots() {
    val c = Beside.colors
    val t = rememberInfiniteTransition(label = "typing")
    Row(Modifier.padding(vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(5.dp)) {
        repeat(3) { i ->
            val a by t.animateFloat(0.25f, 1f, infiniteRepeatable(tween(500, delayMillis = i * 150), RepeatMode.Reverse), label = "dot$i")
            Box(Modifier.size(7.dp).alpha(a).clip(CircleShape).background(c.muted))
        }
    }
}
