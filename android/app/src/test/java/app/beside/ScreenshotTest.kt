package app.beside

import app.beside.data.ActionResult
import app.beside.data.AppData
import app.beside.data.Chat
import app.beside.data.CheckIn
import app.beside.data.Message
import app.beside.data.Note
import app.beside.data.Reminder
import app.beside.data.Settings
import app.beside.data.Stats
import app.beside.data.Step
import app.beside.data.Task
import app.beside.data.Undo
import app.cash.paparazzi.DeviceConfig
import app.cash.paparazzi.Paparazzi
import app.beside.ui.BesideScreen
import app.beside.ui.BesideTheme
import app.beside.ui.SettingsContent
import app.beside.ui.UiActions
import app.beside.ui.UiState
import com.android.resources.Density
import com.android.resources.ScreenOrientation
import org.junit.Rule
import org.junit.Test

/** Renders the real screens at the Galaxy Tab S9 FE's size (2304 × 1440, xhdpi) for design review. */
class ScreenshotTest {
    private val landscape = DeviceConfig(
        screenWidth = 2304, screenHeight = 1440, xdpi = 320, ydpi = 320, density = Density.XHIGH,
        orientation = ScreenOrientation.LANDSCAPE, softButtons = false,
    )

    @get:Rule
    val paparazzi = Paparazzi(deviceConfig = landscape, showSystemUi = false, maxPercentDifference = 0.1)

    private val now = System.currentTimeMillis()
    private val chat = Chat(
        id = "c1", title = "Laundry and the dentist",
        messages = listOf(
            Message(role = "user", content = "I can't get started on the laundry. And remind me to call the dentist at 4."),
            Message(
                role = "assistant",
                content = "That stuck feeling is real, and it isn't laziness. Let's make the first step tiny: just carry the basket to the machine. I'll remind you about the dentist at four.",
                actions = listOf(
                    ActionResult("add_task", true, "Added “Laundry” with 3 small steps", Undo("task", "t1")),
                    ActionResult("set_reminder", true, "Reminder at 4:00 PM: Call the dentist", Undo("reminder", "r1")),
                ),
                stats = Stats(48, 7.4, 1900.0),
            ),
            Message(role = "user", content = "Okay. Body double me for 15 minutes?"),
        ),
    )
    private val data = AppData(
        chats = listOf(chat, Chat(id = "c2", title = "Plan Saturday", updatedAt = now - 90_000_000)),
        tasks = listOf(
            Task(id = "t1", title = "Laundry", steps = listOf(Step("Carry the basket to the machine"), Step("Start a quick wash"), Step("Set a 30 minute reminder"))),
            Task(id = "t2", title = "Email Sam about Friday"),
            Task(id = "t3", title = "Order prescription", done = true, doneAt = now - 3_600_000),
        ),
        reminders = listOf(Reminder(id = "r1", text = "Call the dentist", at = now + 2 * 3_600_000)),
        notes = listOf(Note(text = "Idea: birthday playlist for Mia")),
        checkins = listOf(CheckIn(energy = 2, at = now - 1_800_000)),
    )
    private val ready = LoadState.Ready("Qwen 3.5 4B is running on the tablet.")

    private fun shot(state: UiState) = paparazzi.snapshot {
        BesideTheme(state.settings.theme) { BesideScreen(state, object : UiActions {}) }
    }

    @Test fun homeLandscape() = shot(UiState(settings = Settings(name = "Rosa", setupDone = true, modelId = "qwen3.5-4b"), model = ready, modelName = "Qwen 3.5 4B"))

    @Test fun conversationLandscape() = shot(
        UiState(
            data = data, settings = Settings(setupDone = true, modelId = "qwen3.5-4b"), activeChatId = "c1",
            draft = "Yes. I'll be right here with you. Start the timer and tell me when the basket is",
            caption = "Yes. I'll be right here with you.", model = ready, modelName = "Qwen 3.5 4B",
            timer = TimerState("Laundry", now - 6 * 60_000, now + 9 * 60_000, halfwaySaid = false), now = now,
        ),
    )

    @Test fun conversationPortraitDark() {
        paparazzi.unsafeUpdateConfig(landscape.copy(screenWidth = 1440, screenHeight = 2304, orientation = ScreenOrientation.PORTRAIT))
        shot(UiState(data = data, settings = Settings(theme = "dark", setupDone = true, modelId = "gemma-4-e2b"), activeChatId = "c1", model = ready, modelName = "Gemma 4 E2B", now = now))
    }

    @Test fun setupSheet() = paparazzi.snapshot {
        BesideTheme {
            SettingsContent(
                UiState(model = LoadState.Working("Downloading Qwen 3.5 4B", 1_100_000_000, 2_583_221_408), downloaded = setOf("qwen3.5-0.8b"), ramGb = 7.6),
                object : UiActions {},
            )
        }
    }

    @Test fun voiceSheet() = paparazzi.snapshot {
        BesideTheme {
            SettingsContent(UiState(settings = Settings(setupDone = true), voice = LoadState.Ready("Natural voice ready. It runs on the tablet.")), object : UiActions {}, initial = 1)
        }
    }
}
