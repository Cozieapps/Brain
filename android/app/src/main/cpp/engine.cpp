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
    add_bos_ = llama_vocab_get_add_bos(vocab);
    add_eos_ = llama_vocab_get_add_eos(vocab);

    common_params_sampling sp;
    sp.temp = 0.7f;
    sp.top_k = 40;
    sp.top_p = 0.9f;
    sp.min_p = 0.05f;
    sp.penalty_last_n = 64;
    sp.penalty_repeat = 1.05f;
    sampler_ = common_sampler_init(model_, sp);
    if (!sampler_) {
        unload();
        return "The sampler couldn't be created.";
    }
    return "";
}

void Engine::unload() {
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
    history_.clear();
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

// Text added to the prompt by one more message: the template applied to the history with
// and without it. Thinking is switched off so Qwen answers straight away.
std::string Engine::format_delta(const Message & msg, bool add_generation_prompt) {
    common_chat_templates_inputs in;
    in.use_jinja = true;
    in.enable_thinking = false;
    in.chat_template_kwargs["enable_thinking"] = "false";
    in.add_bos = add_bos_;
    in.add_eos = add_eos_;

    auto to_chat = [](const Message & m) {
        common_chat_msg c;
        c.role = m.role;
        c.content = m.content;
        return c;
    };
    std::string before;
    if (!history_.empty()) {
        for (const auto & m : history_) in.messages.push_back(to_chat(m));
        in.add_generation_prompt = false;
        before = common_chat_templates_apply(templates_, in).prompt.str();
    }
    in.messages.push_back(to_chat(msg));
    in.add_generation_prompt = add_generation_prompt;
    std::string after = common_chat_templates_apply(templates_, in).prompt.str();
    std::string delta;
    if (add_generation_prompt && !before.empty() && before.back() == '\n') delta = "\n";
    if (after.size() >= before.size() && after.compare(0, before.size(), before) == 0)
        delta += after.substr(before.size());
    else
        delta += after;  // template rewrote earlier turns; append the new rendering
    return delta;
}

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

std::string Engine::set_system(const std::string & system) {
    if (!ctx_) return "No model is loaded.";
    llama_memory_clear(llama_get_memory(ctx_), true);
    history_.clear();
    n_past_ = 0;
    stop_.store(false);
    Message msg{"system", system};
    std::string err = decode_text(format_delta(msg, false), /*first=*/true, false);
    if (!err.empty()) return "Couldn't read the system prompt (" + err + ").";
    history_.push_back(msg);
    system_n_past_ = n_past_;
    system_state_.resize(llama_state_seq_get_size(ctx_, 0));
    llama_state_seq_get_data(ctx_, system_state_.data(), system_state_.size(), 0);
    return "";
}

std::string Engine::reset_to_system() {
    if (!ctx_ || history_.empty()) return "No conversation has started.";
    if (history_.size() == 1) return "";
    llama_memory_clear(llama_get_memory(ctx_), true);
    if (llama_state_seq_set_data(ctx_, system_state_.data(), system_state_.size(), 0) == 0)
        return "Couldn't restore the saved system prompt.";
    history_.resize(1);
    n_past_ = system_n_past_;
    return "";
}

std::string Engine::append(const Message & msg) {
    if (!ctx_ || history_.empty()) return "No conversation has started.";
    stop_.store(false);
    std::string err = decode_text(format_delta(msg, false), false, false);
    if (!err.empty()) return err;
    history_.push_back(msg);
    return "";
}

GenerateResult Engine::generate(const std::string & user, int max_tokens, float temperature,
                                const std::function<bool(const std::string &)> & on_piece) {
    GenerateResult r;
    if (!ctx_ || history_.empty()) {
        r.status = -1;
        r.error = "The model isn't ready yet.";
        return r;
    }
    (void) temperature;  // fixed in the sampler for now
    stop_.store(false);
    const auto started = Clock::now();
    Message msg{"user", user};
    const int before = n_past_;
    std::string err = decode_text(format_delta(msg, true), false, true);
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
    history_.push_back(msg);

    common_sampler_reset(sampler_);
    const llama_vocab * vocab = llama_model_get_vocab(model_);
    std::string pending;
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
        if (eog) break;
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
    history_.push_back({"assistant", r.text});
    return r;
}

}  // namespace beside
