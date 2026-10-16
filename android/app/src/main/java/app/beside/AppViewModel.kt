package app.beside

import android.app.ActivityManager
import android.app.Application
import android.media.AudioManager
import android.media.ToneGenerator
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import app.beside.data.ActionResult
import app.beside.data.AppData
import app.beside.data.Chat
import app.beside.data.CheckIn
import app.beside.data.Message
import app.beside.data.Reminder
import app.beside.data.Settings
import app.beside.data.Stats
import app.beside.data.Step
import app.beside.data.Task
import app.beside.download.ModelFiles
import app.beside.llm.ChatSession
import app.beside.llm.MODELS
import app.beside.llm.ModelChoice
import app.beside.llm.contextNote
import app.beside.llm.findModel
import app.beside.llm.findVoice
import app.beside.llm.recommendedModel
import app.beside.llm.systemPrompt
import app.beside.system.AppEvent
import app.beside.system.Handoffs
import app.beside.system.Reminders
import app.beside.text.ParsedAction
import app.beside.text.sanitizeUserText
import app.beside.text.splitReply
import app.beside.text.titleFrom
import app.beside.tools.Effects
import app.beside.tools.ToolRunner
import app.beside.tools.parseSlash
import app.beside.voice.SpeechSettings
import app.beside.voice.Speaker
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.io.File
import java.time.LocalDateTime

sealed interface LoadState {
    data object Idle : LoadState
    data class Working(val label: String, val done: Long = 0, val total: Long = 0) : LoadState
    data class Ready(val detail: String) : LoadState
    data class Failed(val message: String) : LoadState
}

data class TimerState(
    val label: String,
    val startedAt: Long,
    val endsAt: Long,
    val halfwaySaid: Boolean = false,
    val endSaid: Boolean = false,
)

class AppViewModel(app: Application) : AndroidViewModel(app) {
    private val besideApp = app as BesideApp
    private val store = besideApp.store
    val data: StateFlow<AppData> = store.data
    val settings: StateFlow<Settings> = store.settings

    val files = ModelFiles(app)
    private val session = ChatSession()
    private val handoffs = Handoffs(app)
    val speaker = Speaker(app) {
        val s = store.settings.value
        SpeechSettings(s.engine, findVoice(s.voice).sid, s.speed)
    }
    val caption = speaker.caption

    val ramGb: Double = ActivityManager.MemoryInfo().also {
        app.getSystemService(ActivityManager::class.java).getMemoryInfo(it)
    }.totalMem / 1e9
    val recommended: ModelChoice = recommendedModel(ramGb)

    private val _model = MutableStateFlow<LoadState>(LoadState.Idle)
    val model = _model.asStateFlow()
    private val _voice = MutableStateFlow<LoadState>(LoadState.Idle)
    val voice = _voice.asStateFlow()
    private val _activeChat = MutableStateFlow<String?>(null)
    val activeChat = _activeChat.asStateFlow()
    private val _draft = MutableStateFlow<String?>(null)
    val draft = _draft.asStateFlow()
    private val _timer = MutableStateFlow<TimerState?>(null)
    val timer = _timer.asStateFlow()
    private val _now = MutableStateFlow(System.currentTimeMillis())
    val now = _now.asStateFlow()
    private val _toast = MutableStateFlow<String?>(null)
    val toast = _toast.asStateFlow()
    private val _showSettings = MutableStateFlow(!store.settings.value.setupDone)
    val showSettings = _showSettings.asStateFlow()
    private val _filesVersion = MutableStateFlow(0)
    val filesVersion = _filesVersion.asStateFlow()

    val generating get() = _draft.value != null
    private var generation: Job? = null
    private var loadedSystem = ""
    private var loadedModelId: String? = null

    private val effects = object : Effects {
        override fun startTimer(minutes: Int, label: String) = this@AppViewModel.startTimer(minutes, label)
        override fun scheduleReminder(reminder: Reminder) = Reminders.schedule(app, reminder)
        override fun cancelReminder(id: String) = Reminders.cancel(app, id)
        override fun openCalendar(title: String, startMillis: Long, endMillis: Long) = handoffs.calendar(title, startMillis, endMillis)
        override fun draftMessage(text: String, app: String) = handoffs.message(text, app)
        override fun setAlarm(hour: Int, minute: Int, label: String) = handoffs.alarm(hour, minute, label)
    }
    private val tools = ToolRunner(store::update, effects)

    init {
        viewModelScope.launch {
            while (true) {
                _now.value = System.currentTimeMillis()
                tickTimer()
                delay(1000)
            }
        }
        viewModelScope.launch {
            besideApp.events.collect { e ->
                if (e is AppEvent.ReminderFired) announce("Reminder: ${e.text}", chime = true)
            }
        }
        val s = store.settings.value
        if (s.engine == "kokoro" && files.isVoiceReady()) loadVoice()
        val chosen = modelPath(s.modelId)
        if (chosen != null && chosen.exists()) startModel(s.modelId)
    }

    // ---------- models ----------

    private fun modelPath(id: String): File? = when {
        id.startsWith("file:") -> File(files.dir, id.removePrefix("file:"))
        else -> findModel(id)?.let { if (files.isDownloaded(it)) files.modelFile(it) else null }
    }

    fun displayName(id: String): String = findModel(id)?.name ?: id.removePrefix("file:").removeSuffix(".gguf")

    fun startModel(id: String) {
        if (_model.value is LoadState.Working) return
        viewModelScope.launch {
            try {
                val choice = findModel(id)
                if (choice != null && !files.isDownloaded(choice)) {
                    _model.value = LoadState.Working("Downloading ${choice.name}", 0, choice.bytes)
                    files.downloadModel(choice) { done, total -> _model.value = LoadState.Working("Downloading ${choice.name}", done, total) }
                    _filesVersion.value++
                }
                val path = modelPath(id) ?: throw IllegalStateException("That model isn't on the tablet yet.")
                _model.value = LoadState.Working("Starting ${displayName(id)}… the first start takes a little while")
                if (loadedModelId != null) session.unload()
                val system = systemPrompt(store.settings.value)
                val err = session.load(path.path, system, store.settings.value.threads)
                if (err.isNotEmpty()) throw IllegalStateException(err)
                loadedSystem = system
                loadedModelId = id
                store.updateSettings { it.copy(modelId = id, setupDone = true) }
                _model.value = LoadState.Ready("${displayName(id)} is running on the tablet.")
                if (store.settings.value.engine == "kokoro" && _voice.value !is LoadState.Ready && _voice.value !is LoadState.Working) downloadVoice()
            } catch (e: Exception) {
                _model.value = LoadState.Failed(e.message ?: "The model couldn't start.")
            }
        }
    }

    fun downloadVoice() {
        if (_voice.value is LoadState.Working) return
        viewModelScope.launch {
            try {
                if (!files.isVoiceReady()) {
                    _voice.value = LoadState.Working("Downloading the natural voice")
                    files.downloadVoice { d, t -> _voice.value = LoadState.Working("Downloading the natural voice", d, t) }
                    _filesVersion.value++
                }
                loadVoice()
            } catch (e: Exception) {
                _voice.value = LoadState.Failed(e.message ?: "The voice couldn't download.")
            }
        }
    }

    private fun loadVoice() {
        _voice.value = LoadState.Working("Preparing the voice…")
        speaker.loadKokoro(files.voiceDir) { err ->
            _voice.value = if (err == null) LoadState.Ready("Natural voice ready. It runs on the tablet.")
            else LoadState.Failed("The voice couldn't start: $err")
        }
    }

    fun importModel(uri: Uri, name: String) {
        viewModelScope.launch {
            val clean = name.substringAfterLast('/').let { if (it.endsWith(".gguf")) it else "$it.gguf" }
            val target = File(files.dir, MODELS.firstOrNull { it.file == clean }?.file ?: clean)
            try {
                _model.value = LoadState.Working("Copying $clean")
                files.importModel(uri, target) { d, t -> _model.value = LoadState.Working("Copying $clean", d, t) }
                _filesVersion.value++
                startModel(MODELS.firstOrNull { it.file == clean }?.id ?: "file:$clean")
            } catch (e: Exception) {
                _model.value = LoadState.Failed(e.message ?: "Couldn't import that file.")
            }
        }
    }

    fun deleteModel(m: ModelChoice) {
        if (loadedModelId == m.id) return
        files.delete(m)
        _filesVersion.value++
    }

    /** Re-read the instructions if her name, notes or reply length changed. */
    fun applySettings() {
        val system = systemPrompt(store.settings.value)
        if (loadedModelId == null || system == loadedSystem) return
        viewModelScope.launch {
            if (session.setSystem(system).isEmpty()) loadedSystem = system
        }
    }

    fun updateSettings(change: (Settings) -> Settings) = store.updateSettings(change)
    fun openSettings() { _showSettings.value = true }
    fun closeSettings() {
        _showSettings.value = false
        applySettings()
    }

    // ---------- chat ----------

    fun newChat() {
        speaker.stop()
        _activeChat.value = null
    }

    fun openChat(id: String) {
        speaker.stop()
        _activeChat.value = id
    }

    fun deleteChat(id: String) {
        store.update { d -> d.copy(chats = d.chats.filter { it.id != id }) }
        if (_activeChat.value == id) _activeChat.value = null
    }

    private fun saveChat(chat: Chat) {
        store.update { d -> d.copy(chats = listOf(chat) + d.chats.filter { it.id != chat.id }) }
    }

    fun send(raw: String) {
        val text = raw.trim()
        if (text.isEmpty() || generating) return
        speaker.stop()
        val s = store.settings.value
        val existing = data.value.chats.firstOrNull { it.id == _activeChat.value }
        val before = existing ?: Chat(title = titleFrom(text.replace(Regex("^/\\w+\\s*"), "")))
        val user = Message(role = "user", content = text)
        var chat = before.copy(updatedAt = System.currentTimeMillis(), messages = before.messages + user)
        _activeChat.value = chat.id

        parseSlash(text)?.let { action ->
            val result = runActions(listOf(action)).first()
            saveChat(chat.copy(messages = chat.messages + Message(role = "assistant", content = if (result.ok) "Done." else result.summary, actions = listOf(result))))
            if (s.autoSpeak) speaker.say(result.summary)
            return
        }
        saveChat(chat)
        if (_model.value !is LoadState.Ready) {
            val waiting = _model.value is LoadState.Working
            saveChat(chat.copy(messages = chat.messages + Message(role = "assistant", content = "",
                error = if (waiting) "Still getting ready. Your message is saved; send it again in a moment."
                else "No model is running yet. Choose one in Settings to start chatting.")))
            if (!waiting) openSettings()
            return
        }

        _draft.value = ""
        if (s.autoSpeak) speaker.begin()
        generation = viewModelScope.launch {
            val note = contextNote(data.value, LocalDateTime.now())
            val raw2 = StringBuilder()
            var spoken = ""
            try {
                val r = session.reply(before, "$note\n\n${sanitizeUserText(text)}", if (s.replyLength == "short") 320 else 640) { piece ->
                    raw2.append(piece)
                    val visible = splitReply(raw2.toString()).text
                    if (s.autoSpeak && visible.startsWith(spoken) && visible.length > spoken.length) {
                        speaker.feed(visible.substring(spoken.length))
                        spoken = visible
                    }
                    _draft.value = visible
                }
                val split = splitReply(raw2.toString())
                if (s.autoSpeak) speaker.end()
                val results = if (r.stopped) emptyList() else runActions(split.actions)
                val content = split.text.ifEmpty { results.joinToString(". ") { it.summary } }
                if (s.autoSpeak && split.text.isEmpty() && content.isNotEmpty()) speaker.say(content)
                chat = chat.copy(updatedAt = System.currentTimeMillis(), messages = chat.messages + Message(
                    role = "assistant", content = content, actions = results,
                    stats = Stats(r.tokens, r.tokensPerSecond, r.firstTokenMs),
                    error = if (r.status < 0) "Something went wrong while answering." else null,
                ))
            } catch (e: Exception) {
                speaker.stop()
                chat = chat.copy(messages = chat.messages + Message(role = "assistant", content = splitReply(raw2.toString()).text, error = "Something went wrong: ${e.message}"))
            } finally {
                saveChat(chat)
                _draft.value = null
            }
        }
    }

    private fun runActions(actions: List<ParsedAction>): List<ActionResult> = actions.take(3).map(tools::run)

    fun stop() {
        session.stop()
        speaker.stop()
    }

    fun undo(chatId: String, messageId: String, index: Int) {
        val chat = data.value.chats.firstOrNull { it.id == chatId } ?: return
        val msg = chat.messages.firstOrNull { it.id == messageId } ?: return
        val result = msg.actions.getOrNull(index) ?: return
        tools.undo(result)
        saveChat(chat.copy(messages = chat.messages.map { m ->
            if (m.id == messageId) m.copy(actions = m.actions.mapIndexed { i, a -> if (i == index) a.copy(undone = true) else a }) else m
        }))
    }

    fun speak(text: String) = speaker.say(text)

    // ---------- today ----------

    fun addTask(title: String) = store.update { it.copy(tasks = it.tasks + Task(title = title)) }
    fun toggleTask(t: Task) = store.update { d ->
        d.copy(tasks = d.tasks.map { if (it.id == t.id) it.copy(done = !it.done, doneAt = if (it.done) null else System.currentTimeMillis()) else it })
    }
    fun toggleStep(t: Task, i: Int) = store.update { d ->
        d.copy(tasks = d.tasks.map { task ->
            if (task.id == t.id) task.copy(steps = task.steps.mapIndexed { j, s -> if (j == i) Step(s.text, !s.done) else s }) else task
        })
    }
    fun deleteTask(t: Task) = store.update { d -> d.copy(tasks = d.tasks.filter { it.id != t.id }) }
    fun deleteReminder(r: Reminder) {
        Reminders.cancel(getApplication(), r.id)
        store.update { d -> d.copy(reminders = d.reminders.filter { it.id != r.id }) }
    }
    fun deleteNote(id: String) = store.update { d -> d.copy(notes = d.notes.filter { it.id != id }) }
    fun checkIn(energy: Int, cycle: String?) = store.update { it.copy(checkins = it.checkins + CheckIn(energy = energy, cycle = cycle)) }

    fun startTimer(minutes: Int, label: String) {
        val now = System.currentTimeMillis()
        val t = TimerState(label, now, now + minutes * 60_000L, halfwaySaid = minutes < 4)
        _timer.value = t
        // Also ring as a notification if Beside is in the background when time is up.
        Reminders.schedule(getApplication(), Reminder(id = Reminders.TIMER_ID, text = "Time's up: $label", at = t.endsAt))
    }

    fun stopTimer() {
        _timer.value = null
        Reminders.cancel(getApplication(), Reminders.TIMER_ID)
    }

    private fun tickTimer() {
        val t = _timer.value ?: return
        val now = _now.value
        if (!t.halfwaySaid && now >= (t.startedAt + t.endsAt) / 2) {
            _timer.value = t.copy(halfwaySaid = true)
            val left = ((t.endsAt - now) / 60_000.0).let { kotlin.math.round(it).toInt() }
            announce("Halfway there. About $left minutes left on ${t.label}. You're doing it.")
        } else if (!t.endSaid && now >= t.endsAt) {
            _timer.value = t.copy(halfwaySaid = true, endSaid = true)
            announce("Time's up on ${t.label}. Nice work. Want a short break, or another round?", chime = true)
        }
    }

    private fun announce(text: String, chime: Boolean = false) {
        _toast.value = text
        if (chime) runCatching { ToneGenerator(AudioManager.STREAM_NOTIFICATION, 70).startTone(ToneGenerator.TONE_PROP_ACK, 400) }
        if (store.settings.value.autoSpeak && !generating) speaker.say(text)
        viewModelScope.launch {
            delay(8000)
            if (_toast.value == text) _toast.value = null
        }
    }

    fun dismissToast() { _toast.value = null }

    // ---------- privacy ----------

    fun exportJson(): String = store.exportJson()
    fun eraseAll() {
        for (r in data.value.reminders) Reminders.cancel(getApplication(), r.id)
        store.eraseAll()
        _activeChat.value = null
    }

    override fun onCleared() {
        speaker.release()
    }
}
