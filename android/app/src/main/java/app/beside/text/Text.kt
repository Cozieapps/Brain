package app.beside.text

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject

/** A tool request found in a model reply. */
data class ParsedAction(val tool: String, val args: JsonObject)

data class SplitReply(val text: String, val actions: List<ParsedAction>)

private val json = Json { ignoreUnknownKeys = true; isLenient = true }
private val actionBlock = Regex("<action>([\\s\\S]*?)</action>")
private val qwenToolCall = Regex("<tool_call>([\\s\\S]*?)</tool_call>")
private val openTagAtEnd = Regex("<(action|tool_call|think)>[\\s\\S]*$")
private val partialTagAtEnd = Regex("</?[a-z_]*$")

/** Remove reasoning blocks. An unterminated block at the end is still being written. */
fun stripThinking(text: String): String =
    text.replace(Regex("<think>[\\s\\S]*?</think>"), "")
        .replace(Regex("<think>[\\s\\S]*$"), "")
        .replace(Regex("^\\s*</think>"), "")

private fun parseAction(raw: String): ParsedAction? = try {
    val obj = json.parseToJsonElement(raw.trim()).jsonObject
    val tool = (obj["tool"] ?: obj["name"]) as? JsonPrimitive
    val args = (obj["args"] ?: obj["arguments"] ?: JsonObject(emptyMap())) as? JsonObject
    if (tool == null || !tool.isString || args == null) null else ParsedAction(tool.content, args)
} catch (_: Exception) {
    null
}

/**
 * Split a model reply into what is shown and spoken, and the actions it asked for.
 * Accepts the app's <action>{...}</action> blocks and Qwen's native <tool_call> format.
 * Blocks still being streamed are hidden until complete.
 */
fun splitReply(raw: String): SplitReply {
    val actions = mutableListOf<ParsedAction>()
    var text = stripThinking(raw)
    for (pattern in listOf(actionBlock, qwenToolCall)) {
        text = pattern.replace(text) { m ->
            parseAction(m.groupValues[1])?.let(actions::add)
            ""
        }
    }
    text = openTagAtEnd.replace(text, "").replace(partialTagAtEnd, "")
    return SplitReply(text.replace(Regex("\\n{3,}"), "\n\n").trim(), actions)
}

private val emoji = Regex("[\\x{1F000}-\\x{1FAFF}\\x{2600}-\\x{27BF}\\x{FE0F}\\x{200D}\\x{1F1E6}-\\x{1F1FF}]")

/** Turn displayed markdown into something that sounds natural read aloud. */
fun toSpeakable(text: String): String = text
    .replace(Regex("```[\\s\\S]*?```"), " ")
    .replace(Regex("`([^`]*)`"), "$1")
    .replace(Regex("!\\[[^\\]]*]\\([^)]*\\)"), "")
    .replace(Regex("\\[([^\\]]+)]\\([^)]*\\)"), "$1")
    .replace(Regex("https?://\\S+"), "a link")
    .replace(Regex("(?m)^#{1,6}\\s+(.*)$"), "$1.")
    .replace(Regex("(?m)^\\s*[-*•]\\s+(.*?)[.!?]?\\s*$"), "$1.")
    .replace(Regex("(?m)^\\s*(\\d+)[.)]\\s+(.*?)[.!?]?\\s*$"), "$2.")
    .replace(Regex("(\\*\\*|__|\\*|_|~~)(.+?)\\1"), "$2")
    .replace(emoji, "")
    .replace(Regex("\\s*[—–]\\s*"), ", ")
    .replace("&", " and ")
    .replace(Regex("\\s*/\\s*"), " or ")
    .replace(Regex("[ \\t]+"), " ")
    .replace(Regex("\\s*\\n+\\s*"), " ")
    .replace(Regex("([.!?]),"), "$1")
    .replace(Regex("\\.{2,}(?!\\.)"), "…")
    .trim()

/** Typed text must never be read by the model as its own control tokens. */
fun sanitizeUserText(text: String): String =
    text.replace(Regex("<\\|[^<>\\s]{0,40}\\|?>|<[a-z_]{1,20}\\|>"), "")

private val abbreviations = setOf(
    "mr", "mrs", "ms", "dr", "prof", "st", "vs", "etc", "e.g", "i.e", "approx", "min", "no",
)

/**
 * Incremental sentence splitter for streamed text. The first chunk is released early (at a
 * comma once it is long enough) so speech starts while the model is still writing; later short
 * sentences are grouped so the voice keeps natural phrasing instead of choppy fragments.
 */
class SentenceChunker(
    private val firstChunkWords: Int = 9,
    private val targetChars: Int = 180,
) {
    private var buffer = StringBuilder()
    private var emitted = 0

    fun push(delta: String): List<String> {
        buffer.append(delta)
        return drain(false)
    }

    fun flush(): List<String> = drain(true)

    private fun drain(final: Boolean): List<String> {
        val out = mutableListOf<String>()
        var pending = ""
        while (true) {
            val cut = findBoundary(pending.length)
            if (cut < 0) break
            val sentence = buffer.substring(0, cut).trim()
            buffer.delete(0, cut)
            if (sentence.isEmpty()) continue
            pending = if (pending.isEmpty()) sentence else "$pending $sentence"
            if (emitted == 0 || pending.length >= targetChars / 2) {
                out += pending
                emitted++
                pending = ""
            }
        }
        if (pending.isNotEmpty()) buffer = StringBuilder("$pending ${buffer.toString().trimStart()}")
        if (final) {
            val rest = buffer.toString().trim()
            buffer = StringBuilder()
            if (rest.isNotEmpty()) {
                out += rest
                emitted++
            }
        }
        return out.filter { s -> s.any { it.isLetterOrDigit() } }
    }

    private fun findBoundary(alreadyPending: Int): Int {
        val b = buffer
        for (i in 0 until b.length) {
            val ch = b[i]
            if (ch == '\n' && b.substring(0, i).isNotBlank()) return i + 1
            if (ch in ".!?…") {
                var end = i + 1
                while (end < b.length && b[end] in ".!?…\"')”’") end++
                if (end >= b.length) return -1 // could be "3.5" or "..." still streaming
                if (!b[end].isWhitespace()) continue
                if (ch == '.') {
                    val word = b.substring(0, i).split(Regex("\\s+")).last().lowercase().trimStart { !it.isLetterOrDigit() }
                    if (word.isNotEmpty() && (word in abbreviations || word.all { it.isDigit() })) continue
                }
                return end
            }
            if (emitted == 0 && alreadyPending == 0 && (ch == ',' || ch == ';' || ch == ':') &&
                b.substring(0, i).trim().split(Regex("\\s+")).size >= firstChunkWords &&
                i + 1 < b.length && b[i + 1].isWhitespace()
            ) return i + 1
        }
        return -1
    }
}

/** A short title for a conversation from its first message. */
fun titleFrom(text: String): String {
    val clean = text.replace(Regex("\\s+"), " ").trim()
    if (clean.length <= 42) return clean.ifEmpty { "New chat" }
    val cut = clean.substring(0, 42)
    val space = cut.lastIndexOf(' ')
    return (if (space > 20) cut.substring(0, space) else cut) + "…"
}

fun JsonObject.str(key: String): String =
    (this[key] as? JsonPrimitive)?.takeIf { it.isString || it.content.isNotEmpty() }?.content?.trim() ?: ""

fun JsonObject.num(key: String): Double? = (this[key] as? JsonPrimitive)?.content?.toDoubleOrNull()

fun JsonObject.strList(key: String): List<String> =
    (this[key] as? kotlinx.serialization.json.JsonArray)
        ?.mapNotNull { (it as? JsonPrimitive)?.content?.trim()?.takeIf(String::isNotEmpty) }
        ?.take(8) ?: emptyList()

fun jsonArgs(vararg pairs: Pair<String, Any?>): JsonObject = JsonObject(
    pairs.filter { it.second != null }.associate { (k, v) ->
        k to when (v) {
            is Number -> JsonPrimitive(v)
            is JsonElement -> v
            else -> JsonPrimitive(v.toString())
        }
    },
)
