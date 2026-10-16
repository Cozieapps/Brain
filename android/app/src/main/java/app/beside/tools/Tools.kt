package app.beside.tools

import app.beside.data.ActionResult
import app.beside.data.AppData
import app.beside.data.CheckIn
import app.beside.data.Note
import app.beside.data.Reminder
import app.beside.data.Step
import app.beside.data.Task
import app.beside.data.Undo
import app.beside.text.ParsedAction
import app.beside.text.jsonArgs
import app.beside.text.num
import app.beside.text.str
import app.beside.text.strList
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.roundToInt

/** Side effects tools can ask for. The app hands these to Android; tests record them. */
interface Effects {
    fun startTimer(minutes: Int, label: String)
    fun scheduleReminder(reminder: Reminder)
    fun cancelReminder(id: String)
    /** Opens the calendar app with the event filled in; she taps Save. */
    fun openCalendar(title: String, startMillis: Long, endMillis: Long): Boolean
    /** Opens WhatsApp, Messages or the share sheet with the text ready to send. */
    fun draftMessage(text: String, app: String): String?
    fun setAlarm(hour: Int, minute: Int, label: String): Boolean
}

const val TOOL_GUIDE = """Tools (use one only when she clearly wants it; at most two per reply):
- add_task {"title": string, "steps"?: string[], "when"?: string}  save a to-do; steps are tiny concrete first actions
- add_steps {"task": string, "steps": string[]}  break an existing task into smaller steps
- complete_task {"task": string}  mark a task done
- set_reminder {"text": string, "minutes"?: number, "time"?: "HH:MM"}  remind her later (24-hour time); works even if Beside is closed
- start_timer {"minutes": number, "label"?: string}  focus timer; you will cheer her on at halfway
- save_note {"text": string}  keep a thought or brain-dump item
- log_checkin {"energy": 1-5, "mood"?: string}  record how she feels right now
- add_calendar_event {"title": string, "day"?: "today"|"tomorrow"|"YYYY-MM-DD", "time": "HH:MM", "minutes"?: number}  opens her calendar to save it
- draft_message {"text": string, "app"?: "whatsapp"|"sms"|"any"}  opens the app with the message written; she picks who and taps send
- set_alarm {"time": "HH:MM", "label"?: string}  sets an alarm in the Clock app
To use a tool, end your reply with one block per action, exactly like:
<action>{"tool": "add_task", "args": {"title": "Email Sam about Friday", "steps": ["Open email", "Write two lines"]}}</action>
Say what you did in plain words first. Never claim you did something without the block. You cannot send messages yourself: she always taps send."""

/** "minutes" or "HH:MM" (or "5pm") to a time; a clock time already past today means tomorrow. */
fun resolveWhen(minutes: Double?, time: String?, now: LocalDateTime): LocalDateTime? {
    if (minutes != null && minutes > 0 && minutes <= 24 * 60) return now.plusSeconds((minutes * 60).roundToInt().toLong())
    val clock = parseClock(time) ?: return null
    var at = now.toLocalDate().atTime(clock.first, clock.second)
    if (!at.isAfter(now)) at = at.plusDays(1)
    return at
}

fun parseClock(time: String?): Pair<Int, Int>? {
    val m = Regex("^(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)?$").find(time?.trim()?.lowercase() ?: return null) ?: return null
    var hour = m.groupValues[1].toInt()
    val minute = m.groupValues[2].ifEmpty { "0" }.toInt()
    when (m.groupValues[3]) {
        "pm" -> if (hour < 12) hour += 12
        "am" -> if (hour == 12) hour = 0
    }
    return if (hour in 0..23 && minute in 0..59) hour to minute else null
}

fun resolveDay(day: String?, today: LocalDate): LocalDate? = when (val d = day?.trim()?.lowercase()) {
    null, "", "today" -> today
    "tomorrow" -> today.plusDays(1)
    else -> runCatching { LocalDate.parse(d) }.getOrNull()
}

private fun words(s: String) =
    s.lowercase().replace(Regex("[^\\p{L}\\p{N}\\s]"), " ").split(Regex("\\s+")).filter { it.length > 2 }

/** Best open task for a loose description such as "the email one". */
fun matchTask(tasks: List<Task>, query: String): Task? {
    val q = query.lowercase().trim()
    if (q.isEmpty()) return null
    val open = tasks.filter { !it.done }
    open.firstOrNull { it.title.lowercase() == q }?.let { return it }
    open.firstOrNull { it.title.lowercase().contains(q) || q.contains(it.title.lowercase()) }?.let { return it }
    val qw = words(query).toSet()
    return open.map { it to words(it.title).count(qw::contains) }.filter { it.second > 0 }.maxByOrNull { it.second }?.first
}

private val clockFormat = DateTimeFormatter.ofPattern("h:mm a", Locale.getDefault())
private val dayFormat = DateTimeFormatter.ofPattern("EEE d MMM", Locale.getDefault())

class ToolRunner(
    private val update: ((AppData) -> AppData) -> AppData,
    private val effects: Effects,
    private val zone: ZoneId = ZoneId.systemDefault(),
    private val clock: () -> LocalDateTime = { LocalDateTime.now(zone) },
) {
    fun run(action: ParsedAction): ActionResult {
        val a = action.args
        fun fail(summary: String) = ActionResult(action.tool, false, summary)
        fun ok(summary: String, undo: Undo? = null) = ActionResult(action.tool, true, summary, undo)
        val now = clock()
        return when (action.tool) {
            "add_task" -> {
                val title = a.str("title").ifEmpty { return fail("Couldn't add a task without a name.") }
                val task = Task(title = title, steps = a.strList("steps").map { Step(it) }, whenText = a.str("when").ifEmpty { null })
                update { it.copy(tasks = it.tasks + task) }
                val steps = if (task.steps.isNotEmpty()) " with ${task.steps.size} small steps" else ""
                ok("Added “$title”$steps", Undo("task", task.id))
            }
            "add_steps" -> {
                var result: ActionResult? = null
                update { d ->
                    val task = matchTask(d.tasks, a.str("task"))
                    val steps = a.strList("steps")
                    when {
                        task == null -> { result = fail("Couldn't find a task like “${a.str("task")}”."); d }
                        steps.isEmpty() -> { result = fail("No steps were given."); d }
                        else -> {
                            result = ok("Broke “${task.title}” into ${steps.size} steps", Undo("task", task.id, task))
                            d.copy(tasks = d.tasks.map { if (it.id == task.id) it.copy(steps = it.steps + steps.map(::Step)) else it })
                        }
                    }
                }
                result!!
            }
            "complete_task" -> {
                var result: ActionResult? = null
                update { d ->
                    val task = matchTask(d.tasks, a.str("task"))
                    if (task == null) {
                        result = fail("Couldn't find a task like “${a.str("task")}”.")
                        d
                    } else {
                        result = ok("Marked “${task.title}” done", Undo("task", task.id, task))
                        d.copy(tasks = d.tasks.map { if (it.id == task.id) it.copy(done = true, doneAt = System.currentTimeMillis()) else it })
                    }
                }
                result!!
            }
            "set_reminder" -> {
                val text = a.str("text")
                val at = resolveWhen(a.num("minutes"), a.str("time").ifEmpty { null }, now)
                if (text.isEmpty() || at == null) return fail("Couldn't tell when to remind you.")
                val reminder = Reminder(text = text, at = at.atZone(zone).toInstant().toEpochMilli())
                update { it.copy(reminders = it.reminders + reminder) }
                effects.scheduleReminder(reminder)
                ok("Reminder at ${at.format(clockFormat)}: $text", Undo("reminder", reminder.id))
            }
            "start_timer" -> {
                val minutes = a.num("minutes")?.roundToInt() ?: 0
                if (minutes !in 1..180) return fail("Timers can run from 1 to 180 minutes.")
                val label = a.str("label").ifEmpty { "Focus" }
                effects.startTimer(minutes, label)
                ok("$minutes-minute timer started: $label")
            }
            "save_note" -> {
                val text = a.str("text").ifEmpty { return fail("Nothing to save.") }
                val note = Note(text = text)
                update { it.copy(notes = it.notes + note) }
                ok("Saved to notes: ${if (text.length > 60) text.take(57) + "…" else text}", Undo("note", note.id))
            }
            "log_checkin" -> {
                val energy = a.num("energy")?.roundToInt() ?: 0
                if (energy !in 1..5) return fail("Energy should be 1 to 5.")
                val checkIn = CheckIn(energy = energy, mood = a.str("mood").ifEmpty { null })
                update { it.copy(checkins = it.checkins + checkIn) }
                ok("Checked in: energy $energy/5${checkIn.mood?.let { ", $it" } ?: ""}", Undo("checkin", checkIn.id))
            }
            "add_calendar_event" -> {
                val title = a.str("title").ifEmpty { return fail("The event needs a name.") }
                val day = resolveDay(a.str("day").ifEmpty { null }, now.toLocalDate()) ?: return fail("Couldn't tell which day.")
                val clock = parseClock(a.str("time")) ?: return fail("Couldn't tell what time.")
                val start = day.atTime(clock.first, clock.second)
                val minutes = (a.num("minutes") ?: 60.0).coerceIn(5.0, 24 * 60.0)
                val startMs = start.atZone(zone).toInstant().toEpochMilli()
                if (!effects.openCalendar(title, startMs, startMs + (minutes * 60_000).toLong()))
                    return fail("No calendar app is installed.")
                ok("Opened Calendar: $title, ${start.format(dayFormat)} at ${start.format(clockFormat)}. Tap Save to keep it.")
            }
            "draft_message" -> {
                val text = a.str("text").ifEmpty { return fail("There's no message to draft.") }
                val opened = effects.draftMessage(text, a.str("app").lowercase().ifEmpty { "any" })
                    ?: return fail("Couldn't open an app to send it.")
                ok("Opened $opened with your message. Choose who it's for and tap send.")
            }
            "set_alarm" -> {
                val clock = parseClock(a.str("time")) ?: return fail("Couldn't tell what time.")
                val label = a.str("label").ifEmpty { "Beside" }
                if (!effects.setAlarm(clock.first, clock.second, label)) return fail("No clock app accepted the alarm.")
                ok("Alarm set for ${LocalDate.now().atTime(clock.first, clock.second).format(clockFormat)}: $label")
            }
            else -> fail("Unknown tool “${action.tool}”.")
        }
    }

    fun undo(result: ActionResult) {
        val u = result.undo ?: return
        if (u.kind == "reminder") effects.cancelReminder(u.id)
        update { d ->
            when (u.kind) {
                "task" -> d.copy(tasks = if (u.previous != null) d.tasks.map { if (it.id == u.id) u.previous else it } else d.tasks.filter { it.id != u.id })
                "reminder" -> d.copy(reminders = d.reminders.filter { it.id != u.id })
                "note" -> d.copy(notes = d.notes.filter { it.id != u.id })
                "checkin" -> d.copy(checkins = d.checkins.filter { it.id != u.id })
                else -> d
            }
        }
    }
}

/**
 * Slash commands work instantly, with no model:
 * /task Call the dentist · /timer 15 Inbox · /remind 20 take meds · /note idea · /energy 3 · /done dentist
 */
fun parseSlash(input: String): ParsedAction? {
    val m = Regex("^/(\\w+)\\s*(.*)$", RegexOption.DOT_MATCHES_ALL).find(input.trim()) ?: return null
    val cmd = m.groupValues[1].lowercase()
    val rest = m.groupValues[2].trim()
    val lead = Regex("^(\\d{1,2}:\\d{2}|\\d+)\\s*(?:min(?:utes?)?|m)?\\s*(.*)$", RegexOption.DOT_MATCHES_ALL).find(rest)
    return when (cmd) {
        "task", "todo" -> rest.takeIf { it.isNotEmpty() }?.let { ParsedAction("add_task", jsonArgs("title" to it)) }
        "done" -> rest.takeIf { it.isNotEmpty() }?.let { ParsedAction("complete_task", jsonArgs("task" to it)) }
        "timer", "focus" -> ParsedAction(
            "start_timer",
            jsonArgs("minutes" to (lead?.groupValues?.get(1)?.toIntOrNull() ?: 15), "label" to (lead?.groupValues?.get(2)?.ifEmpty { null } ?: rest.ifEmpty { "Focus" })),
        )
        "remind" -> {
            if (lead == null || lead.groupValues[2].isEmpty()) null
            else if (lead.groupValues[1].contains(':')) ParsedAction("set_reminder", jsonArgs("time" to lead.groupValues[1], "text" to lead.groupValues[2]))
            else ParsedAction("set_reminder", jsonArgs("minutes" to lead.groupValues[1].toInt(), "text" to lead.groupValues[2]))
        }
        "note", "dump" -> rest.takeIf { it.isNotEmpty() }?.let { ParsedAction("save_note", jsonArgs("text" to it)) }
        "energy" -> lead?.let { ParsedAction("log_checkin", jsonArgs("energy" to it.groupValues[1].toInt(), "mood" to it.groupValues[2].ifEmpty { null })) }
        else -> null
    }
}
