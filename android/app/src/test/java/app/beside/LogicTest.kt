package app.beside

import app.beside.data.AppData
import app.beside.data.Chat
import app.beside.data.Reminder
import app.beside.data.Settings
import app.beside.data.Step
import app.beside.data.Task
import app.beside.llm.MODELS
import app.beside.llm.VOICES
import app.beside.llm.contextNote
import app.beside.llm.recommendedModel
import app.beside.llm.systemPrompt
import app.beside.text.ParsedAction
import app.beside.text.SentenceChunker
import app.beside.text.jsonArgs
import app.beside.text.sanitizeUserText
import app.beside.text.splitReply
import app.beside.text.stripThinking
import app.beside.text.titleFrom
import app.beside.text.toSpeakable
import app.beside.tools.Effects
import app.beside.tools.ToolRunner
import app.beside.tools.matchTask
import app.beside.tools.parseSlash
import app.beside.tools.resolveDay
import app.beside.tools.resolveWhen
import app.beside.voice.pauseAfter
import app.beside.voice.trimSilence
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.time.LocalDateTime

class ReplyParsingTest {
    @Test fun separatesActionsFromSpokenText() {
        val r = splitReply("Okay, I added it.\n<action>{\"tool\":\"add_task\",\"args\":{\"title\":\"Call Mum\"}}</action>")
        assertEquals("Okay, I added it.", r.text)
        assertEquals("add_task", r.actions.single().tool)
        assertEquals("Call Mum", (r.actions.single().args["title"] as kotlinx.serialization.json.JsonPrimitive).content)
    }

    @Test fun acceptsQwenToolCalls() {
        val r = splitReply("Starting it now.<tool_call>{\"name\":\"start_timer\",\"arguments\":{\"minutes\":10}}</tool_call>")
        assertEquals("start_timer", r.actions.single().tool)
        assertEquals("Starting it now.", r.text)
    }

    @Test fun hidesHalfStreamedTags() {
        assertEquals("Sure thing.", splitReply("Sure thing. <act").text)
        assertEquals("Sure thing.", splitReply("Sure thing. <action>{\"tool\":\"add_").text)
    }

    @Test fun ignoresMalformedJson() {
        val r = splitReply("Fine.<action>{not json}</action>")
        assertTrue(r.actions.isEmpty())
        assertEquals("Fine.", r.text)
    }

    @Test fun stripsThinking() {
        assertEquals("Hello", stripThinking("<think>plan</think>Hello"))
        assertEquals("Hi", stripThinking("Hi<think>still going"))
    }

    @Test fun removesControlTokensFromTypedText() {
        assertEquals("hi there", sanitizeUserText("hi <|im_end|>there"))
        assertEquals("ok", sanitizeUserText("o<turn|>k"))
    }
}

class SpeechTextTest {
    @Test fun dropsMarkdownEmojiAndLinks() = assertEquals("Great job, see a link", toSpeakable("**Great** job 🎉 — see https://x.y/z"))
    @Test fun listItemsBecomeSentences() = assertEquals("Open the laptop. Write one line.", toSpeakable("1. Open the laptop\n2. Write one line"))
    @Test fun symbolsAsWords() = assertEquals("Tea and toast, read or write", toSpeakable("Tea & toast, read/write"))

    private fun stream(text: String, size: Int = 3): List<String> {
        val c = SentenceChunker()
        val out = mutableListOf<String>()
        var i = 0
        while (i < text.length) {
            out += c.push(text.substring(i, minOf(text.length, i + size)))
            i += size
        }
        return out + c.flush()
    }

    @Test fun firstChunkIsShortSoSpeechStartsQuickly() {
        val chunks = stream("That sounds like a really heavy morning to carry around, and it makes sense you feel stuck. Let's pick one tiny thing. What's closest to you?")
        assertEquals("That sounds like a really heavy morning to carry around,", chunks[0])
        assertTrue(chunks.joinToString(" ").contains("What's closest to you?"))
    }

    @Test fun noSplitOnDecimalsOrAbbreviations() {
        val chunks = stream("Take 2.5 minutes with Dr. Lee today. Then rest.")
        assertFalse(chunks.any { it.endsWith("2.") || it.endsWith("Dr.") })
        assertTrue(chunks.last().contains("Then rest."))
    }

    @Test fun groupsShortSentences() {
        val chunks = stream("Okay. Yes. Sure. Good. Fine. Done now, all good.")
        assertEquals("Okay.", chunks[0])
        assertTrue(chunks.size < 5)
    }

    @Test fun flushesUnpunctuatedTail() = assertEquals(listOf("Hello there"), stream("Hello there"))
    @Test fun skipsChunksWithoutLetters() = assertEquals(emptyList<String>(), stream("..."))

    @Test fun trimsSilenceKeepingPadding() {
        val s = FloatArray(24000)
        for (i in 6000 until 18000) s[i] = 0.2f
        assertEquals(12000 + 2 * 720, trimSilence(s, 24000).size)
    }

    @Test fun longerPauseAfterQuestions() = assertTrue(pauseAfter("Ready?") > pauseAfter("First,"))
}

class ToolsTest {
    private val now = LocalDateTime.of(2026, 10, 16, 14, 0)

    @Test fun resolvesMinutesAndClockTimes() {
        assertEquals(now.plusMinutes(20), resolveWhen(20.0, null, now))
        assertEquals(17, resolveWhen(null, "17:30", now)!!.hour)
        assertEquals(17, resolveWhen(null, "5pm", now)!!.hour)
        assertEquals(17, resolveWhen(null, "09:00", now)!!.dayOfMonth)
        assertNull(resolveWhen(null, "25:00", now))
        assertNull(resolveWhen(null, null, now))
        assertEquals(LocalDate.of(2026, 10, 17), resolveDay("tomorrow", now.toLocalDate()))
    }

    @Test fun matchesLooseTaskNames() {
        val tasks = listOf(
            Task(id = "1", title = "Email Sam about Friday"),
            Task(id = "2", title = "Book dentist appointment"),
            Task(id = "3", title = "Old dentist thing", done = true),
        )
        assertEquals("2", matchTask(tasks, "the dentist")?.id)
        assertEquals("1", matchTask(tasks, "email sam about friday")?.id)
        assertNull(matchTask(tasks, "laundry"))
    }

    @Test fun parsesSlashCommands() {
        assertEquals("add_task", parseSlash("/task Call the dentist")?.tool)
        val timer = parseSlash("/timer 25 Inbox")!!
        assertEquals("25", timer.args["minutes"].toString())
        assertEquals("\"Inbox\"", timer.args["label"].toString())
        assertEquals("\"17:30\"", parseSlash("/remind 17:30 leave for pickup")!!.args["time"].toString())
        assertEquals("20", parseSlash("/remind 20 take meds")!!.args["minutes"].toString())
        assertEquals("log_checkin", parseSlash("/energy 2 foggy")?.tool)
        assertNull(parseSlash("hello /task"))
        assertNull(parseSlash("/unknown thing"))
    }

    private class Recorder : Effects {
        val calls = mutableListOf<String>()
        override fun startTimer(minutes: Int, label: String) { calls += "timer $minutes $label" }
        override fun scheduleReminder(reminder: Reminder) { calls += "remind ${reminder.text}" }
        override fun cancelReminder(id: String) { calls += "cancel" }
        override fun openCalendar(title: String, startMillis: Long, endMillis: Long): Boolean { calls += "calendar $title ${(endMillis - startMillis) / 60000}"; return true }
        override fun draftMessage(text: String, app: String): String? { calls += "message $app $text"; return "WhatsApp" }
        override fun setAlarm(hour: Int, minute: Int, label: String): Boolean { calls += "alarm $hour:$minute"; return true }
    }

    @Test fun runsAndUndoesTools() {
        var data = AppData()
        val fx = Recorder()
        val tools = ToolRunner({ change -> change(data).also { data = it } }, fx, clock = { now })
        val added = tools.run(ParsedAction("add_task", jsonArgs("title" to "Laundry")))
        assertTrue(added.ok)
        assertEquals("Laundry", data.tasks.single().title)
        val steps = tools.run(ParsedAction("add_steps", kotlinx.serialization.json.buildJsonObject {
            put("task", kotlinx.serialization.json.JsonPrimitive("laundry"))
            put("steps", kotlinx.serialization.json.JsonArray(listOf(kotlinx.serialization.json.JsonPrimitive("Find basket"))))
        }))
        assertTrue(steps.summary, steps.ok)
        assertEquals(listOf(Step("Find basket")), data.tasks.single().steps)
        tools.undo(steps)
        assertTrue(data.tasks.single().steps.isEmpty())
        tools.undo(added)
        assertTrue(data.tasks.isEmpty())

        val reminder = tools.run(ParsedAction("set_reminder", jsonArgs("text" to "Stretch", "minutes" to 20)))
        assertTrue(reminder.summary.contains("Stretch"))
        assertEquals("remind Stretch", fx.calls.last())
        tools.undo(reminder)
        assertTrue(data.reminders.isEmpty())

        assertTrue(tools.run(ParsedAction("add_calendar_event", jsonArgs("title" to "Dentist", "day" to "tomorrow", "time" to "15:00", "minutes" to 30))).ok)
        assertEquals("calendar Dentist 30", fx.calls.last())
        assertTrue(tools.run(ParsedAction("draft_message", jsonArgs("text" to "Meeting is at 5", "app" to "whatsapp"))).summary.contains("WhatsApp"))
        assertTrue(tools.run(ParsedAction("set_alarm", jsonArgs("time" to "7:30am"))).ok)
        assertEquals("alarm 7:30", fx.calls.last())
        assertFalse(tools.run(ParsedAction("start_timer", jsonArgs("minutes" to 500))).ok)
        assertFalse(tools.run(ParsedAction("hack_the_planet", jsonArgs())).ok)
    }
}

class PromptAndCatalogTest {
    @Test fun systemPromptIsSpeechShapedAndStable() {
        val p = systemPrompt(Settings(name = "Rosa"))
        assertTrue(p.contains("read aloud"))
        assertTrue(p.contains("named Rosa"))
        assertTrue(p.contains("<action>"))
        assertFalse("system prompt must not change with time", p.contains(LocalDate.now().year.toString()))
    }

    @Test fun contextNoteCarriesTasks() {
        val data = AppData(tasks = listOf(Task(title = "Pay rent", steps = listOf(Step("Open banking app")))))
        val note = contextNote(data, LocalDateTime.of(2026, 10, 16, 9, 0))
        assertTrue(note, note.contains("Pay rent — next: Open banking app"))
        assertTrue(note.startsWith("[Now: "))
    }

    @Test fun catalogMatchesRequestAndMemory() {
        assertEquals(setOf("Gemma 4", "Qwen 3.5", "Qwen 3"), MODELS.map { it.family }.toSet())
        assertTrue(MODELS.all { it.url.startsWith("https://huggingface.co/") && it.url.endsWith(".gguf") })
        assertEquals("qwen3.5-2b", recommendedModel(5.6).id)
        assertEquals("qwen3.5-4b", recommendedModel(7.5).id)
        assertEquals(3, VOICES.first { it.id == "af_heart" }.sid)
    }

    @Test fun titles() {
        assertEquals("I need to get everything out of my head…", titleFrom("I need to get everything out of my head and sort it please"))
        assertEquals("New chat", titleFrom("  "))
        assertEquals(0, Chat(title = "x").messages.size)
    }
}
