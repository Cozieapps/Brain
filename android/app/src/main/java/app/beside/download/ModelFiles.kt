package app.beside.download

import android.content.Context
import android.net.Uri
import app.beside.llm.KokoroModel
import app.beside.llm.ModelChoice
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import org.apache.commons.compress.archivers.tar.TarArchiveInputStream
import org.apache.commons.compress.compressors.bzip2.BZip2CompressorInputStream
import java.io.BufferedInputStream
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import kotlin.coroutines.coroutineContext

/**
 * Model files live in the app's own storage folder (Android/data/app.beside.companion/files/models).
 * A GGUF copied into that folder over USB is picked up too, so setup can happen with no internet.
 */
class ModelFiles(private val context: Context) {
    val dir: File = (context.getExternalFilesDir("models") ?: File(context.filesDir, "models")).apply { mkdirs() }

    fun modelFile(m: ModelChoice) = File(dir, m.file)
    fun isDownloaded(m: ModelChoice) = modelFile(m).let { it.exists() && it.length() == m.bytes }
    /** Any other GGUF she put in the folder herself. */
    fun customModels(): List<File> = dir.listFiles { f -> f.extension == "gguf" }?.toList().orEmpty()

    val voiceDir get() = File(dir, KokoroModel.DIR)
    fun isVoiceReady() = File(voiceDir, "voices.bin").exists() && File(voiceDir, "tokens.txt").exists()

    fun delete(m: ModelChoice) {
        modelFile(m).delete()
        File(modelFile(m).path + ".part").delete()
        File(modelFile(m).path + ".system-cache").delete()
    }

    fun freeBytes(): Long = dir.usableSpace

    suspend fun downloadModel(m: ModelChoice, onProgress: (Long, Long) -> Unit) =
        download(m.url, modelFile(m), m.bytes, onProgress)

    suspend fun downloadVoice(onProgress: (Long, Long) -> Unit) = withContext(Dispatchers.IO) {
        val archive = File(dir, "kokoro.tar.bz2")
        download(KokoroModel.URL, archive, KokoroModel.BYTES, onProgress)
        val tmp = File(dir, "kokoro-extracting").apply { deleteRecursively(); mkdirs() }
        archive.inputStream().use { extractTarBz2(it, tmp) }
        val extracted = File(tmp, KokoroModel.DIR).takeIf { it.isDirectory } ?: tmp
        voiceDir.deleteRecursively()
        if (!extracted.renameTo(voiceDir)) throw IOException("Couldn't move the voice files into place.")
        tmp.deleteRecursively()
        archive.delete()
    }

    /** Import a GGUF picked with the system file picker (e.g. from Downloads or a USB stick). */
    suspend fun importModel(uri: Uri, target: File, onProgress: (Long, Long) -> Unit) = withContext(Dispatchers.IO) {
        val total = context.contentResolver.openAssetFileDescriptor(uri, "r")?.use { it.length } ?: -1L
        val part = File(target.path + ".part")
        context.contentResolver.openInputStream(uri)?.use { input ->
            part.outputStream().use { out ->
                val buf = ByteArray(1 shl 20)
                var done = 0L
                while (true) {
                    coroutineContext.ensureActive()
                    val n = input.read(buf)
                    if (n < 0) break
                    out.write(buf, 0, n)
                    done += n
                    onProgress(done, total)
                }
            }
        } ?: throw IOException("Couldn't open that file.")
        if (!part.renameTo(target)) throw IOException("Couldn't save the model.")
    }

    /** Resumable download: keeps a .part file and continues where it stopped. */
    private suspend fun download(url: String, target: File, expected: Long, onProgress: (Long, Long) -> Unit) =
        withContext(Dispatchers.IO) {
            if (target.exists() && target.length() == expected) return@withContext
            val part = File(target.path + ".part")
            if (part.length() > expected) part.delete()
            if (freeBytes() < expected - part.length() + 200_000_000)
                throw IOException("Not enough free space. Needs about ${"%.1f".format((expected - part.length()) / 1e9)} GB.")
            var attempts = 0
            while (part.length() < expected) {
                try {
                    fetchRange(url, part, expected, onProgress)
                } catch (e: IOException) {
                    if (++attempts >= 5) throw IOException("Download interrupted. Tap again to continue where it stopped.", e)
                    delay(2000L * attempts)
                }
            }
            if (part.length() != expected) throw IOException("The download was incomplete.")
            if (!part.renameTo(target)) throw IOException("Couldn't save the file.")
        }

    private suspend fun fetchRange(url: String, part: File, expected: Long, onProgress: (Long, Long) -> Unit) {
        val have = part.length()
        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
            instanceFollowRedirects = true
            connectTimeout = 20_000
            readTimeout = 30_000
            setRequestProperty("User-Agent", "Beside-Android")
            if (have > 0) setRequestProperty("Range", "bytes=$have-")
        }
        try {
            val code = conn.responseCode
            val append = code == 206
            if (code != 200 && code != 206) throw IOException("Server answered $code.")
            if (!append && have > 0) part.delete()
            conn.inputStream.use { input ->
                java.io.FileOutputStream(part, append).use { out ->
                    val buf = ByteArray(1 shl 16)
                    var done = part.length()
                    var lastReport = 0L
                    while (true) {
                        coroutineContext.ensureActive()
                        val n = input.read(buf)
                        if (n < 0) break
                        out.write(buf, 0, n)
                        done += n
                        if (done - lastReport > 2_000_000 || done == expected) {
                            onProgress(done, expected)
                            lastReport = done
                        }
                    }
                }
            }
        } finally {
            conn.disconnect()
        }
    }
}

fun extractTarBz2(input: InputStream, dest: File) {
    val root = dest.canonicalFile
    TarArchiveInputStream(BZip2CompressorInputStream(BufferedInputStream(input))).use { tar ->
        while (true) {
            val entry = tar.nextEntry ?: break
            val out = File(dest, entry.name).canonicalFile
            // Never write outside the target folder, whatever the archive says.
            if (!out.path.startsWith(root.path + File.separator) && out != root) continue
            if (entry.isDirectory) out.mkdirs()
            else {
                out.parentFile?.mkdirs()
                out.outputStream().use { tar.copyTo(it) }
            }
        }
    }
}
