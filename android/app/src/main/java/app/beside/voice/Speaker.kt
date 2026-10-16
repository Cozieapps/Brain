package app.beside.voice

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import app.beside.text.SentenceChunker
import app.beside.text.toSpeakable
import com.k2fsa.sherpa.onnx.OfflineTts
import com.k2fsa.sherpa.onnx.OfflineTtsConfig
import com.k2fsa.sherpa.onnx.OfflineTtsKokoroModelConfig
import com.k2fsa.sherpa.onnx.OfflineTtsModelConfig
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.abs

/** Trim near-silent edges so pauses between sentences are even, not random. */
fun trimSilence(samples: FloatArray, sampleRate: Int, threshold: Float = 0.004f, padSeconds: Float = 0.03f): FloatArray {
    var start = 0
    var end = samples.size - 1
    while (start < end && abs(samples[start]) < threshold) start++
    while (end > start && abs(samples[end]) < threshold) end--
    val pad = (padSeconds * sampleRate).toInt()
    return samples.copyOfRange(maxOf(0, start - pad), minOf(samples.size, end + pad + 1))
}

/** Gap after a chunk: longer after a question, shorter after an early comma split. */
fun pauseAfter(text: String): Float = when {
    Regex("[?!][\"')”’]*$").containsMatchIn(text) -> 0.32f
    Regex("[.…][\"')”’]*$").containsMatchIn(text) -> 0.26f
    else -> 0.12f
}

data class SpeechSettings(val engine: String, val sid: Int, val speed: Float)

/**
 * Streams the reply into speech. Sentences are rendered by Kokoro on their own thread as soon
 * as they are complete, and played back-to-back through one AudioTrack. Speed is applied inside
 * the voice model (re-pacing speech), never by fast-forwarding audio, so it stays human.
 */
class Speaker(private val context: Context, private val settings: () -> SpeechSettings) {
    private val _caption = MutableStateFlow<String?>(null)
    val caption: StateFlow<String?> = _caption

    private val _kokoroReady = MutableStateFlow(false)
    val kokoroReady: StateFlow<Boolean> = _kokoroReady

    private val synthThread = Executors.newSingleThreadExecutor { r -> Thread(r, "beside-voice") }.asCoroutineDispatcher()
    private val scope = CoroutineScope(SupervisorJob() + synthThread)
    private val generation = AtomicInteger(0)
    private var chunker = SentenceChunker()
    private var tts: OfflineTts? = null
    private var jobs = Channel<Pair<Int, String>>(Channel.UNLIMITED)

    private val player = Player { text -> _caption.value = text }
    private var system: TextToSpeech? = null
    private var systemReady = false

    init {
        scope.launch { for ((gen, chunk) in jobs) render(gen, chunk) }
        system = TextToSpeech(context) { status -> systemReady = status == TextToSpeech.SUCCESS }
    }

    /** Load Kokoro from an extracted model folder. Runs on the voice thread. */
    fun loadKokoro(dir: File, onDone: (String?) -> Unit) {
        scope.launch {
            val err = runCatching {
                tts?.release()
                val config = OfflineTtsConfig(
                    model = OfflineTtsModelConfig(
                        kokoro = OfflineTtsKokoroModelConfig(
                            model = File(dir, "model.int8.onnx").takeIf { it.exists() }?.path ?: File(dir, "model.onnx").path,
                            voices = File(dir, "voices.bin").path,
                            tokens = File(dir, "tokens.txt").path,
                            dataDir = File(dir, "espeak-ng-data").path,
                            lexicon = File(dir, "lexicon-us-en.txt").path,
                        ),
                        // Two threads leave the big cores to the language model.
                        numThreads = 2,
                        debug = false,
                        provider = "cpu",
                    ),
                )
                val t = OfflineTts(null, config)
                t.generate("Hi.", settings().sid, 1f) // warm up
                tts = t
            }.exceptionOrNull()?.message
            _kokoroReady.value = err == null
            onDone(err)
        }
    }

    fun begin() {
        stop()
        chunker = SentenceChunker()
    }

    fun feed(delta: String) = chunker.push(delta).forEach(::enqueue)

    fun end() = chunker.flush().forEach(::enqueue)

    fun say(text: String) {
        begin()
        feed(text)
        end()
    }

    fun stop() {
        generation.incrementAndGet()
        player.clear()
        system?.stop()
        _caption.value = null
    }

    private fun enqueue(chunk: String) {
        val spoken = toSpeakable(chunk)
        if (spoken.none { it.isLetterOrDigit() }) return
        val s = settings()
        val gen = generation.get()
        if (s.engine == "system" || !_kokoroReady.value) speakSystem(spoken, chunk, s)
        else jobs.trySend(gen to chunk)
    }

    private fun render(gen: Int, chunk: String) {
        if (gen != generation.get()) return
        val t = tts ?: return
        val s = settings()
        val audio = runCatching { t.generate(toSpeakable(chunk), s.sid, s.speed) }.getOrNull() ?: return
        if (gen != generation.get()) return
        player.play(gen, trimSilence(audio.samples, audio.sampleRate), audio.sampleRate, chunk, pauseAfter(chunk), generation)
    }

    private fun speakSystem(spoken: String, caption: String, s: SpeechSettings) {
        val t = system ?: return
        if (!systemReady) return
        t.setSpeechRate(s.speed)
        t.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(id: String) { _caption.value = caption }
            override fun onDone(id: String) { if (!t.isSpeaking) _caption.value = null }
            @Deprecated("Deprecated in Java")
            override fun onError(id: String) { _caption.value = null }
        })
        t.speak(spoken, TextToSpeech.QUEUE_ADD, null, "beside-${System.nanoTime()}")
    }

    fun release() {
        stop()
        jobs.close()
        tts?.release()
        system?.shutdown()
        player.release()
    }
}

/** Plays rendered sentences in order on its own thread, with a short natural pause after each. */
private class Player(private val onCaption: (String?) -> Unit) {
    private class Clip(val gen: Int, val samples: FloatArray, val rate: Int, val caption: String, val pause: Float, val current: AtomicInteger)

    private val queue = LinkedBlockingQueue<Clip>()
    private var track: AudioTrack? = null
    private var trackRate = 0
    @Volatile private var flushRequested = false

    private val thread = Thread({
        while (true) {
            val clip = try { queue.take() } catch (_: InterruptedException) { return@Thread }
            if (clip.gen != clip.current.get()) continue
            val t = trackFor(clip.rate)
            onCaption(clip.caption)
            write(t, clip.samples, clip)
            val silence = FloatArray((clip.pause * clip.rate).toInt())
            write(t, silence, clip)
            if (queue.isEmpty() && clip.gen == clip.current.get()) onCaption(null)
        }
    }, "beside-audio").apply { isDaemon = true; start() }

    private fun write(t: AudioTrack, data: FloatArray, clip: Clip) {
        var off = 0
        while (off < data.size) {
            if (flushRequested || clip.gen != clip.current.get()) return
            val n = t.write(data, off, minOf(4096, data.size - off), AudioTrack.WRITE_BLOCKING)
            if (n <= 0) return
            off += n
        }
    }

    private fun trackFor(rate: Int): AudioTrack {
        flushRequested = false
        track?.let { if (trackRate == rate) return it }
        track?.release()
        val min = AudioTrack.getMinBufferSize(rate, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_FLOAT)
        val t = AudioTrack.Builder()
            .setAudioAttributes(
                AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANT)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build(),
            )
            .setAudioFormat(
                AudioFormat.Builder().setSampleRate(rate).setEncoding(AudioFormat.ENCODING_PCM_FLOAT)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build(),
            )
            .setBufferSizeInBytes(maxOf(min, rate)) // about a quarter second of float audio
            .setTransferMode(AudioTrack.MODE_STREAM)
            .build()
        t.play()
        track = t
        trackRate = rate
        return t
    }

    fun play(gen: Int, samples: FloatArray, rate: Int, caption: String, pause: Float, current: AtomicInteger) {
        queue.put(Clip(gen, samples, rate, caption, pause, current))
    }

    fun clear() {
        queue.clear()
        flushRequested = true
        track?.let {
            it.pause()
            it.flush()
            it.play()
        }
        onCaption(null)
    }

    fun release() {
        thread.interrupt()
        track?.release()
    }
}
