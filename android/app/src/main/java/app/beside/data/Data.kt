package app.beside.data

import kotlinx.serialization.Serializable
import java.util.UUID

fun newId(): String = UUID.randomUUID().toString()

@Serializable
data class Step(val text: String, val done: Boolean = false)

@Serializable
data class Task(
    val id: String = newId(),
    val title: String,
    val steps: List<Step> = emptyList(),
    val done: Boolean = false,
    val createdAt: Long = System.currentTimeMillis(),
    val doneAt: Long? = null,
    val whenText: String? = null,
    val pinned: Boolean = false,
)

@Serializable
data class Reminder(
    val id: String = newId(),
    val text: String,
    val at: Long,
    val fired: Boolean = false,
    val createdAt: Long = System.currentTimeMillis(),
)

@Serializable
data class Note(val id: String = newId(), val text: String, val createdAt: Long = System.currentTimeMillis())

@Serializable
data class CheckIn(
    val id: String = newId(),
    val at: Long = System.currentTimeMillis(),
    val energy: Int,
    val mood: String? = null,
    val cycle: String? = null,
)

/** Enough to reverse a tool's change: the record's kind and id, plus the task before it changed. */
@Serializable
data class Undo(val kind: String, val id: String, val previous: Task? = null)

@Serializable
data class ActionResult(
    val tool: String,
    val ok: Boolean,
    val summary: String,
    val undo: Undo? = null,
    val undone: Boolean = false,
)

@Serializable
data class Stats(val tokens: Int, val tokensPerSecond: Double, val firstTokenMs: Double)

@Serializable
data class Message(
    val id: String = newId(),
    val role: String,
    val content: String,
    val at: Long = System.currentTimeMillis(),
    val actions: List<ActionResult> = emptyList(),
    val stats: Stats? = null,
    val error: String? = null,
)

@Serializable
data class Chat(
    val id: String = newId(),
    val title: String,
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = System.currentTimeMillis(),
    val messages: List<Message> = emptyList(),
)

@Serializable
data class AppData(
    val chats: List<Chat> = emptyList(),
    val tasks: List<Task> = emptyList(),
    val reminders: List<Reminder> = emptyList(),
    val notes: List<Note> = emptyList(),
    val checkins: List<CheckIn> = emptyList(),
) {
    val openTasks get() = tasks.filter { !it.done }
    val lastCheckIn get() = checkins.maxByOrNull { it.at }
}

@Serializable
data class Settings(
    val modelId: String = "",
    val voice: String = "af_heart",
    val speed: Float = 1.05f,
    val engine: String = "kokoro", // or "system"
    val autoSpeak: Boolean = true,
    val replyLength: String = "short",
    val name: String = "",
    val aboutMe: String = "",
    val theme: String = "system",
    val textScale: Float = 1f,
    val threads: Int = 4,
    val setupDone: Boolean = false,
)
