package app.beside.data

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.Json
import java.io.File

/**
 * Everything lives in two JSON files in the app's private storage. Nothing leaves the device.
 * Writes go to a temporary file first, so a crash mid-write never loses data.
 */
class Store(private val dir: File, private val scope: CoroutineScope) {
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true; prettyPrint = false }
    private val dataFile = File(dir, "beside-data.json")
    private val settingsFile = File(dir, "beside-settings.json")
    private val writeLock = Mutex()

    private val _data = MutableStateFlow(read(dataFile) { json.decodeFromString<AppData>(it) } ?: AppData())
    val data: StateFlow<AppData> = _data.asStateFlow()

    private val _settings = MutableStateFlow(read(settingsFile) { json.decodeFromString<Settings>(it) } ?: Settings())
    val settings: StateFlow<Settings> = _settings.asStateFlow()

    private fun <T> read(file: File, parse: (String) -> T): T? = try {
        if (file.exists()) parse(file.readText()) else null
    } catch (_: Exception) {
        // Keep a copy of an unreadable file instead of silently overwriting it.
        file.copyTo(File(file.path + ".unreadable"), overwrite = true)
        null
    }

    fun update(change: (AppData) -> AppData): AppData {
        val next = synchronized(this) {
            val n = change(_data.value)
            _data.value = n
            n
        }
        save(dataFile) { json.encodeToString(AppData.serializer(), _data.value) }
        return next
    }

    fun updateSettings(change: (Settings) -> Settings) {
        val next = synchronized(this) {
            val n = change(_settings.value)
            _settings.value = n
            n
        }
        save(settingsFile) { json.encodeToString(Settings.serializer(), _settings.value) }
    }

    // Encodes the latest state when the write runs, so writes can never land out of order.
    private fun save(file: File, encode: () -> String) {
        scope.launch(Dispatchers.IO) {
            writeLock.withLock {
                val text = encode()
                val tmp = File(file.path + ".tmp")
                tmp.writeText(text)
                tmp.renameTo(file)
            }
        }
    }

    fun exportJson(): String = json.encodeToString(AppData.serializer(), _data.value)

    fun eraseAll() = update { AppData() }
}
