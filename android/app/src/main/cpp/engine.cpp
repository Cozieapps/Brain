#include "engine.h"

#include <chrono>
#include <cstdio>
#include <cstring>

#include "chat.h"
#include "common.h"
#include "llama.h"
#include "sampling.h"

namespace beside {

namespace {
// Room kept free so a reply never runs the context out mid-sentence.
constexpr int kHeadroom = 64;

using Clock = std::chrono::steady_clock;
double ms_since(Clock::time_point t) {
    return std::chrono::duration<double, std::milli>(Clock::now() - t).count();
}

// Length of the longest prefix of s that is complete UTF-8.
size_t utf8_complete_prefix(const std::string & s) {
    size_t i = s.size();
    size_t back = 0;
    while (i > 0 && back < 4) {
        unsigned char c = (unsigned char) s[i - 1];
        if ((c & 0xC0) != 0x80) {
            size_t need = (c & 0x80) == 0 ? 1 : (c & 0xE0) == 0xC0 ? 2 : (c & 0xF0) == 0xE0 ? 3 : 4;
            return back + 1 >= need ? s.size() : i - 1;
        }
        --i;
        ++back;
    }
    return s.size();
}
}  // namespace

Engine::Engine() {
    static bool initialised = false;
    if (!initialised) {
        llama_backend_init();
        initialised = true;
    }
}

Engine::~Engine() { unload(); }

std::string Engine::load(const std::string & path, int n_ctx, int n_threads) {
    unload();
    llama_model_params mp = llama_model_default_params();
    model_ = llama_model_load_from_file(path.c_str(), mp);
    if (!model_) return "This file couldn't be opened as a GGUF model.";

    llama_context_params cp = llama_context_default_params();
    const int trained = llama_model_n_ctx_train(model_);
    cp.n_ctx = trained > 0 && trained < n_ctx ? trained : n_ctx;
    cp.n_batch = n_batch_;
    cp.n_ubatch = n_batch_;
    cp.n_threads = n_threads;
    cp.n_threads_batch = n_threads;
    // Full-size sliding-window cache keeps Gemma's attention exact across long chats.
    cp.swa_full = true;
    ctx_ = llama_init_from_model(model_, cp);
    if (!ctx_) {
        unload();
        return "Not enough memory to start this model. Try a smaller one.";
    }
    batch_ = new common_batch(ctx_);
    templates_ = common_chat_templates_init(model_, "").release();
    const llama_vocab * vocab = llama_model_get_vocab(model_);
    fmt_ = std::make_unique<ChatFormat>(templates_, llama_vocab_get_add_bos(vocab), llama_vocab_get_add_eos(vocab));

    if (!make_sampler(temperature_)) {
        unload();
        return "The sampler couldn't be created.";
    }
    return "";
}

// Temperature 0 means always the most likely word (used by tests for repeatable answers).
bool Engine::make_sampler(float temperature) {
    if (sampler_) common_sampler_free(sampler_);
    common_params_sampling sp;
    sp.temp = temperature;
    sp.top_k = 40;
    sp.top_p = 0.9f;
    sp.min_p = 0.05f;
    sp.penalty_last_n = 64;
    sp.penalty_repeat = 1.05f;
    sampler_ = common_sampler_init(model_, sp);
    temperature_ = temperature;
    return sampler_ != nullptr;
}

void Engine::unload() {
    fmt_.reset();
    if (sampler_) common_sampler_free(sampler_);
    if (templates_) common_chat_templates_free(templates_);
    delete batch_;
    if (ctx_) llama_free(ctx_);
    if (model_) llama_model_free(model_);
    sampler_ = nullptr;
    templates_ = nullptr;
    batch_ = nullptr;
    ctx_ = nullptr;
    model_ = nullptr;
    system_state_.clear();
    system_n_past_ = 0;
    n_past_ = 0;
}

std::string Engine::describe() const {
    if (!model_) return "";
    char desc[256] = {0};
    llama_model_desc(model_, desc, sizeof(desc));
    char out[384];
    snprintf(out, sizeof(out), "%s · %.1fB params · %d-token context", desc,
             llama_model_n_params(model_) / 1e9, n_ctx());
    return out;
}

int Engine::n_ctx() const { return ctx_ ? (int) llama_n_ctx(ctx_) : 0; }

std::string Engine::decode_text(const std::string & text, bool first, bool want_logits) {
    auto tokens = common_tokenize(ctx_, text, /*add_special=*/first, /*parse_special=*/true);
    if (n_past_ + (int) tokens.size() + kHeadroom >= n_ctx()) return "context-full";
    for (size_t i = 0; i < tokens.size(); i += n_batch_) {
        const size_t n = std::min(tokens.size() - i, (size_t) n_batch_);
        batch_->clear();
        for (size_t j = 0; j < n; ++j) {
            const bool last = want_logits && i + j == tokens.size() - 1;
            batch_->add(tokens[i + j], n_past_ + (llama_pos) (i + j), 0, last);
        }
        if (llama_process(ctx_, LLAMA_PROCESS_TYPE_DECODE, batch_->get()) != 0) return "decode-failed";
        if (stop_.load()) {
            n_past_ += (int) n;
            return "stopped";
        }
    }
    n_past_ += (int) tokens.size();
    return "";
}

namespace {
// Cache file: magic, key length, key (model + context + prompt), token count, state bytes.
constexpr uint32_t kCacheMagic = 0x42534431;  // "BSD1"

bool read_cache(const std::string & path, const std::string & key, int & n_past, std::vector<uint8_t> & state) {
    FILE * f = fopen(path.c_str(), "rb");
    if (!f) return false;
    uint32_t magic = 0, key_len = 0;
    int32_t n = 0;
    uint64_t size = 0;
    bool ok = fread(&magic, 4, 1, f) == 1 && magic == kCacheMagic && fread(&key_len, 4, 1, f) == 1 && key_len == key.size();
    std::string stored(key_len, '\0');
    ok = ok && fread(stored.data(), 1, key_len, f) == key_len && stored == key && fread(&n, 4, 1, f) == 1 &&
         fread(&size, 8, 1, f) == 1 && size > 0 && size < (1ull << 33);
    if (ok) {
        state.resize(size);
        ok = fread(state.data(), 1, size, f) == size;
    }
    fclose(f);
    if (ok) n_past = n;
    return ok;
}

void write_cache(const std::string & path, const std::string & key, int n_past, const std::vector<uint8_t> & state) {
    const std::string tmp = path + ".tmp";
    FILE * f = fopen(tmp.c_str(), "wb");
    if (!f) return;
    const uint32_t key_len = (uint32_t) key.size();
    const int32_t n = n_past;
    const uint64_t size = state.size();
    bool ok = fwrite(&kCacheMagic, 4, 1, f) == 1 && fwrite(&key_len, 4, 1, f) == 1 &&
              fwrite(key.data(), 1, key_len, f) == key_len && fwrite(&n, 4, 1, f) == 1 && fwrite(&size, 8, 1, f) == 1 &&
              fwrite(state.data(), 1, state.size(), f) == state.size();
    ok = fclose(f) == 0 && ok;
    if (ok) rename(tmp.c_str(), path.c_str());
    else remove(tmp.c_str());
}
}  // namespace

std::string Engine::set_system(const std::string & system, const std::string & cache_path) {
    if (!ctx_) return "No model is loaded.";
    llama_memory_clear(llama_get_memory(ctx_), true);
    n_past_ = 0;
    stop_.store(false);
    std::string text;
    try {
        text = fmt_->start(system);
    } catch (const std::exception & e) {
        return std::string("This model's chat template failed: ") + e.what();
    }
    const std::string key = describe() + "\n" + text;
    if (!cache_path.empty() && read_cache(cache_path, key, system_n_past_, system_state_) &&
        llama_state_seq_set_data(ctx_, system_state_.data(), system_state_.size(), 0) != 0) {
        n_past_ = system_n_past_;
        return "";
    }
    llama_memory_clear(llama_get_memory(ctx_), true);
    std::string err = decode_text(text, /*first=*/true, false);
    if (!err.empty()) return "Couldn't read the system prompt (" + err + ").";
    system_n_past_ = n_past_;
    system_state_.resize(llama_state_seq_get_size(ctx_, 0));
    llama_state_seq_get_data(ctx_, system_state_.data(), system_state_.size(), 0);
    if (!cache_path.empty()) write_cache(cache_path, key, system_n_past_, system_state_);
    return "";
}

std::string Engine::reset_to_system() {
    if (!ctx_ || !fmt_ || fmt_->size() == 0) return "No conversation has started.";
    if (fmt_->size() == 1) return "";
    llama_memory_clear(llama_get_memory(ctx_), true);
    if (llama_state_seq_set_data(ctx_, system_state_.data(), system_state_.size(), 0) == 0)
        return "Couldn't restore the saved system prompt.";
    fmt_->rewind();
    n_past_ = system_n_past_;
    return "";
}

std::string Engine::append(const Message & msg) {
    if (!ctx_ || !fmt_ || fmt_->size() == 0) return "No conversation has started.";
    stop_.store(false);
    std::string delta;
    try {
        delta = fmt_->next(msg, false);
    } catch (const std::exception & e) {
        return std::string("chat template: ") + e.what();
    }
    return decode_text(delta, false, false);
}

GenerateResult Engine::generate(const std::string & user, int max_tokens, float temperature,
                                const std::function<bool(const std::string &)> & on_piece) {
    GenerateResult r;
    if (!ctx_ || !fmt_ || fmt_->size() == 0) {
        r.status = -1;
        r.error = "The model isn't ready yet.";
        return r;
    }
    if (temperature != temperature_ && !make_sampler(temperature)) {
        r.status = -1;
        r.error = "The sampler couldn't be created.";
        return r;
    }
    stop_.store(false);
    const auto started = Clock::now();
    Message msg{"user", user};
    const int before = n_past_;
    std::string delta;
    try {
        delta = fmt_->next(msg, true);
    } catch (const std::exception & e) {
        r.status = -1;
        r.error = std::string("chat template: ") + e.what();
        return r;
    }
    std::string err = decode_text(delta, false, true);
    r.prompt_tokens = n_past_ - before;
    if (err == "context-full") {
        r.status = -2;
        return r;
    }
    if (!err.empty()) {
        r.status = err == "stopped" ? 1 : -1;
        r.error = err;
        return r;
    }
    common_sampler_reset(sampler_);
    const llama_vocab * vocab = llama_model_get_vocab(model_);
    std::string pending;
    std::string tail;  // the end-of-turn token's text, already in memory
    Clock::time_point first_at;
    for (int i = 0; i < max_tokens; ++i) {
        if (stop_.load()) {
            r.status = 1;
            break;
        }
        if (n_past_ + kHeadroom / 2 >= n_ctx()) break;
        const llama_token tok = common_sampler_sample(sampler_, ctx_, -1);
        common_sampler_accept(sampler_, tok, true);
        if (r.tokens == 0) {
            first_at = Clock::now();
            r.first_token_ms = ms_since(started);
        }
        const bool eog = llama_vocab_is_eog(vocab, tok);
        // The end-of-turn token goes into memory too, so the next turn lines up with the template.
        batch_->clear();
        batch_->add(tok, n_past_, 0, true);
        if (llama_process(ctx_, LLAMA_PROCESS_TYPE_DECODE, batch_->get()) != 0) {
            r.status = -1;
            r.error = "decode-failed";
            break;
        }
        ++n_past_;
        if (eog) {
            tail = common_token_to_piece(ctx_, tok, true);
            break;
        }
        ++r.tokens;
        pending += common_token_to_piece(ctx_, tok, false);
        const size_t ok = utf8_complete_prefix(pending);
        if (ok > 0) {
            const std::string piece = pending.substr(0, ok);
            pending.erase(0, ok);
            r.text += piece;
            if (!on_piece(piece)) {
                r.status = 1;
                break;
            }
        }
    }
    if (r.tokens > 1) {
        const double gen_ms = ms_since(first_at);
        r.tokens_per_second = gen_ms > 0 ? (r.tokens - 1) * 1000.0 / gen_ms : 0;
    }
    fmt_->generated(r.text, tail);
    return r;
}

}  // namespace beside
