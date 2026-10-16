package app.beside.llm

/** A downloadable on-device model. File names and sizes were checked against Hugging Face. */
data class ModelChoice(
    val id: String,
    val name: String,
    val family: String,
    val repo: String,
    val file: String,
    val bytes: Long,
    /** Device RAM, in GB, for a comfortable experience. */
    val minRamGb: Int,
    val blurb: String,
) {
    val url get() = "https://huggingface.co/$repo/resolve/main/$file"
    val sizeGb get() = bytes / 1e9
}

val MODELS = listOf(
    ModelChoice(
        "qwen3.5-4b", "Qwen 3.5 4B", "Qwen 3.5", "unsloth/Qwen3.5-4B-GGUF", "Qwen3.5-4B-Q4_0.gguf",
        2_583_221_408, 8, "Smartest that fits a tablet. Best at planning and using the tools.",
    ),
    ModelChoice(
        "gemma-4-e4b", "Gemma 4 E4B", "Gemma 4", "ggml-org/gemma-4-E4B-it-GGUF", "gemma-4-E4B-it-Q4_0.gguf",
        4_590_807_392, 8, "Warmest, most natural writing. Large; slowest of these on this tablet.",
    ),
    ModelChoice(
        "qwen3-4b-2507", "Qwen 3 4B Instruct", "Qwen 3", "unsloth/Qwen3-4B-Instruct-2507-GGUF",
        "Qwen3-4B-Instruct-2507-Q4_0.gguf", 2_375_773_280, 8,
        "Answers straight away (no thinking step). Steady and reliable with tools.",
    ),
    ModelChoice(
        "gemma-4-e2b", "Gemma 4 E2B", "Gemma 4", "ggml-org/gemma-4-E2B-it-GGUF", "gemma-4-E2B-it-Q4_0.gguf",
        2_841_481_184, 6, "Gemma's warmth at about twice the speed. Good on the 6 GB tablet.",
    ),
    ModelChoice(
        "qwen3.5-2b", "Qwen 3.5 2B", "Qwen 3.5", "unsloth/Qwen3.5-2B-GGUF", "Qwen3.5-2B-Q4_0.gguf",
        1_214_873_856, 6, "Fast replies, still capable. The everyday pick on 6 GB.",
    ),
    ModelChoice(
        "qwen3.5-0.8b", "Qwen 3.5 0.8B", "Qwen 3.5", "unsloth/Qwen3.5-0.8B-GGUF", "Qwen3.5-0.8B-Q4_0.gguf",
        507_154_688, 4, "Very quick and light. Simple chats and quick captures only.",
    ),
)

fun findModel(id: String): ModelChoice? = MODELS.firstOrNull { it.id == id }

fun recommendedModel(totalRamGb: Double): ModelChoice =
    if (totalRamGb >= 7.0) MODELS.first { it.id == "qwen3.5-4b" } else MODELS.first { it.id == "qwen3.5-2b" }

/**
 * Kokoro v1.0 from sherpa-onnx; speaker ids come from the model's own metadata. The full-precision
 * build is used because on CPUs it renders about twice as fast as the int8 one (measured in CI).
 */
object KokoroModel {
    const val URL = "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-multi-lang-v1_0.tar.bz2"
    const val BYTES = 349_906_910L
    const val DIR = "kokoro-multi-lang-v1_0"
}

data class VoiceChoice(val id: String, val sid: Int, val name: String, val accent: String, val note: String)

/** Kokoro's best-rated voices. Lower-graded ones sound noticeably more synthetic. */
val VOICES = listOf(
    VoiceChoice("af_heart", 3, "Heart", "American", "Warm and expressive"),
    VoiceChoice("af_bella", 2, "Bella", "American", "Bright, energetic"),
    VoiceChoice("af_nicole", 6, "Nicole", "American", "Soft, close, calm"),
    VoiceChoice("bf_emma", 21, "Emma", "British", "Clear and steady"),
    VoiceChoice("af_aoede", 1, "Aoede", "American", "Relaxed"),
    VoiceChoice("af_kore", 5, "Kore", "American", "Even and grounded"),
    VoiceChoice("bf_isabella", 22, "Isabella", "British", "Gentle"),
    VoiceChoice("am_michael", 16, "Michael", "American", "Low and easy"),
)

fun findVoice(id: String) = VOICES.firstOrNull { it.id == id } ?: VOICES.first()
