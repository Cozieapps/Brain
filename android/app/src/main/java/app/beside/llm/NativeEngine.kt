package app.beside.llm

/** Thin wrapper over libbeside.so (llama.cpp). Call from one thread; stop() is safe from any. */
class NativeEngine {
    fun interface PieceCallback {
        fun onPiece(utf8: ByteArray): Boolean
    }

    data class Result(
        val status: Int,
        val promptTokens: Int,
        val tokens: Int,
        val firstTokenMs: Double,
        val tokensPerSecond: Double,
    ) {
        val ok get() = status == 0
        val stopped get() = status == 1
        val contextFull get() = status == -2
    }

    private var handle = nativeCreate()

    fun load(path: String, nCtx: Int, threads: Int): String = nativeLoad(handle, path, nCtx, threads)
    fun unload() = nativeUnload(handle)
    fun describe(): String = nativeDescribe(handle)
    fun setSystem(text: String, cachePath: String = ""): String = nativeSetSystem(handle, text.toByteArray(), cachePath)
    fun reset(): String = nativeReset(handle)
    fun append(role: String, content: String): String = nativeAppend(handle, role, content.toByteArray())
    fun stop() = nativeStop(handle)
    val nPast get() = nativeNPast(handle)
    val nCtx get() = nativeNCtx(handle)

    fun generate(user: String, maxTokens: Int, onPiece: PieceCallback): Result {
        val r = nativeGenerate(handle, user.toByteArray(), maxTokens, onPiece)
        return Result(r[0].toInt(), r[1].toInt(), r[2].toInt(), r[3], r[4])
    }

    fun close() {
        if (handle != 0L) nativeDestroy(handle)
        handle = 0L
    }

    private external fun nativeCreate(): Long
    private external fun nativeDestroy(h: Long)
    private external fun nativeLoad(h: Long, path: String, nCtx: Int, threads: Int): String
    private external fun nativeUnload(h: Long)
    private external fun nativeDescribe(h: Long): String
    private external fun nativeSetSystem(h: Long, text: ByteArray, cachePath: String): String
    private external fun nativeReset(h: Long): String
    private external fun nativeAppend(h: Long, role: String, content: ByteArray): String
    private external fun nativeStop(h: Long)
    private external fun nativeNPast(h: Long): Int
    private external fun nativeNCtx(h: Long): Int
    private external fun nativeGenerate(h: Long, user: ByteArray, maxTokens: Int, cb: PieceCallback): DoubleArray

    companion object {
        init {
            System.loadLibrary("beside")
        }
    }
}
