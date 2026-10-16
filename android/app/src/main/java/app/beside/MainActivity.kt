package app.beside

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.OpenableColumns
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.beside.data.Settings
import app.beside.llm.MODELS
import app.beside.llm.ModelChoice
import app.beside.ui.BesideScreen
import app.beside.ui.BesideTheme
import app.beside.ui.UiActions
import app.beside.ui.UiState
import java.io.File

class MainActivity : ComponentActivity() {
    private val vm: AppViewModel by viewModels()

    private val pickModel = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri: Uri? ->
        if (uri != null) vm.importModel(uri, displayName(uri) ?: "model.gguf")
    }
    private val askNotifications = registerForActivityResult(ActivityResultContracts.RequestPermission()) {}
    private val saveExport = registerForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri: Uri? ->
        if (uri != null) contentResolver.openOutputStream(uri)?.use { it.write(vm.exportJson().toByteArray()) }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        askNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
        setContent { App() }
    }

    private fun displayName(uri: Uri): String? =
        contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
            if (c.moveToFirst()) c.getString(0) else null
        }

    @Composable
    private fun App() {
        val data by vm.data.collectAsStateWithLifecycle()
        val settings by vm.settings.collectAsStateWithLifecycle()
        val model by vm.model.collectAsStateWithLifecycle()
        val voice by vm.voice.collectAsStateWithLifecycle()
        val active by vm.activeChat.collectAsStateWithLifecycle()
        val draft by vm.draft.collectAsStateWithLifecycle()
        val caption by vm.caption.collectAsStateWithLifecycle()
        val timer by vm.timer.collectAsStateWithLifecycle()
        val now by vm.now.collectAsStateWithLifecycle()
        val toast by vm.toast.collectAsStateWithLifecycle()
        val showSettings by vm.showSettings.collectAsStateWithLifecycle()
        val filesVersion by vm.filesVersion.collectAsStateWithLifecycle()
        val voiceRtf by vm.speaker.realTimeFactor.collectAsStateWithLifecycle()

        // Keep the screen awake during long downloads so they aren't interrupted.
        LaunchedEffect(model is LoadState.Working || voice is LoadState.Working) {
            if (model is LoadState.Working || voice is LoadState.Working) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }

        val files = remember(filesVersion) {
            Triple(
                MODELS.filter(vm.files::isDownloaded).map { it.id }.toSet(),
                vm.files.customModels().map(File::getName).filter { n -> MODELS.none { it.file == n } },
                vm.files.isVoiceReady(),
            )
        }
        val state = UiState(
            data = data, settings = settings, activeChatId = active, draft = draft, caption = caption,
            model = model, voice = voice,
            modelName = if (settings.modelId.isEmpty()) "Choose a model" else vm.displayName(settings.modelId),
            timer = timer, now = now, toast = toast, showSettings = showSettings,
            downloaded = files.first, customFiles = files.second, voiceDownloaded = files.third,
            ramGb = vm.ramGb, recommendedId = vm.recommended.id, freeGb = vm.files.freeBytes() / 1e9,
            voiceRtf = voiceRtf,
        )
        BesideTheme(settings.theme, settings.textScale) { BesideScreen(state, actions) }
    }

    private val actions = object : UiActions {
        override fun send(text: String) = vm.send(text)
        override fun stop() = vm.stop()
        override fun newChat() = vm.newChat()
        override fun openChat(id: String) = vm.openChat(id)
        override fun deleteChat(id: String) = vm.deleteChat(id)
        override fun undo(chatId: String, messageId: String, index: Int) = vm.undo(chatId, messageId, index)
        override fun speak(text: String) = vm.speak(text)
        override fun addTask(title: String) { vm.addTask(title) }
        override fun toggleTask(id: String) { vm.data.value.tasks.firstOrNull { it.id == id }?.let(vm::toggleTask) }
        override fun toggleStep(id: String, index: Int) { vm.data.value.tasks.firstOrNull { it.id == id }?.let { vm.toggleStep(it, index) } }
        override fun deleteTask(id: String) { vm.data.value.tasks.firstOrNull { it.id == id }?.let(vm::deleteTask) }
        override fun deleteReminder(id: String) { vm.data.value.reminders.firstOrNull { it.id == id }?.let(vm::deleteReminder) }
        override fun deleteNote(id: String) { vm.deleteNote(id) }
        override fun checkIn(energy: Int, cycle: String?) { vm.checkIn(energy, cycle) }
        override fun startTimer(minutes: Int, label: String) = vm.startTimer(minutes, label)
        override fun stopTimer() = vm.stopTimer()
        override fun openSettings() = vm.openSettings()
        override fun closeSettings() = vm.closeSettings()
        override fun updateSettings(change: (Settings) -> Settings) = vm.updateSettings(change)
        override fun startModel(id: String) = vm.startModel(id)
        override fun downloadVoice() = vm.downloadVoice()
        override fun deleteModel(m: ModelChoice) = vm.deleteModel(m)
        override fun importModel() = pickModel.launch(arrayOf("*/*"))
        override fun exportData() = saveExport.launch("beside-export.json")
        override fun eraseAll() = vm.eraseAll()
        override fun dismissToast() = vm.dismissToast()
        override fun previewVoice() {
            val name = vm.settings.value.name
            vm.speak("Hi${if (name.isNotBlank()) " $name" else ""}, I'm Beside. Let's pick one small thing, and do just that. No pressure.")
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
    }
}
