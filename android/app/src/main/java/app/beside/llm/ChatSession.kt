package app.beside.llm

import app.beside.data.Chat
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.withContext
import java.util.concurrent.Executors

/**
 * Keeps the model's memory in step with the open chat. A reply only processes the new message;
 * opening another chat restores the saved system prompt and replays that chat's recent turns.
 */
class ChatSession(private val engine: NativeEngine = NativeEngine()) {
    private val thread = Executors.newSingleThreadExecutor { r -> Thread(r, "beside-llm") }.asCoroutineDispatcher()
    private var chatId: String? = null
    private var synced = -1

    var description: String = ""
        private set

    suspend fun load(path: String, system: String, threads: Int): String = withContext(thread) {
        val err = engine.load(path, CONTEXT, threads)
        if (err.isNotEmpty()) return@withContext err
        description = engine.describe()
        setSystemLocked(system)
    }

    suspend fun setSystem(system: String): String = withContext(thread) { setSystemLocked(system) }

    private fun setSystemLocked(system: String): String {
        chatId = null
        synced = -1
        return engine.setSystem(system)
    }

    suspend fun unload() = withContext(thread) {
        engine.unload()
        chatId = null
        synced = -1
    }

    /**
     * [history] is the chat before the new message. [user] already carries the context note.
     * Pieces arrive on the model thread.
     */
    suspend fun reply(history: Chat, user: String, maxTokens: Int, onPiece: (String) -> Unit): NativeEngine.Result =
        withContext(thread) {
            if (chatId != history.id || synced != history.messages.size) replay(history, keep = 10)
            val cb = NativeEngine.PieceCallback { onPiece(String(it, Charsets.UTF_8)); true }
            var r = engine.generate(user, maxTokens, cb)
            if (r.contextFull) {
                replay(history, keep = 4)
                r = engine.generate(user, maxTokens, cb)
            }
            chatId = history.id
            synced = history.messages.size + 2
            r
        }

    /** Back to the system prompt, then the chat's last turns, starting on one of hers. */
    private fun replay(chat: Chat, keep: Int) {
        engine.reset()
        val turns = chat.messages.filter { it.error == null && it.content.isNotBlank() }.takeLast(keep)
            .dropWhile { it.role != "user" }
        for (m in turns) if (engine.append(m.role, m.content).isNotEmpty()) break
        chatId = chat.id
        synced = chat.messages.size
    }

    fun stop() = engine.stop()

    companion object {
        const val CONTEXT = 4096
    }
}
