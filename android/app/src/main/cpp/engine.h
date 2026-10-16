// On-device chat engine on top of llama.cpp. Plain C++ so it can be tested on a desktop
// (see test_cli.cpp) as well as called from Kotlin through jni.cpp.
#pragma once

#include <atomic>
#include <cstdint>
#include <functional>
#include <string>
#include <memory>
#include <vector>

#include "chat_format.h"

struct llama_model;
struct llama_context;
struct common_sampler;
struct common_chat_templates;
struct common_batch;

namespace beside {

struct GenerateResult {
    int status = 0;  // 0 ok, 1 stopped, -1 error, -2 context full
    int prompt_tokens = 0;
    int tokens = 0;
    double first_token_ms = 0;
    double tokens_per_second = 0;
    std::string text;
    std::string error;
};

class Engine {
  public:
    Engine();
    ~Engine();

    // Loads a GGUF file. Returns an empty string on success, otherwise the reason.
    std::string load(const std::string & path, int n_ctx, int n_threads);
    void unload();
    bool loaded() const { return ctx_ != nullptr; }
    std::string describe() const;

    // Starts a fresh conversation with this system prompt and keeps a snapshot of the
    // processed prompt, so later resets are instant. With a cache path, the snapshot is also
    // saved to disk and reused on the next launch instead of re-reading the prompt.
    std::string set_system(const std::string & system, const std::string & cache_path = "");
    // Back to just the system prompt (for a new chat or before replaying an old one).
    std::string reset_to_system();
    // Adds an earlier turn without generating (replaying a saved chat).
    std::string append(const Message & msg);

    // Adds the user turn, then streams the reply. on_piece returns false to stop.
    GenerateResult generate(const std::string & user, int max_tokens, float temperature,
                            const std::function<bool(const std::string &)> & on_piece);
    void request_stop() { stop_.store(true); }

    int n_past() const { return n_past_; }
    int n_ctx() const;
    int history_size() const { return fmt_ ? (int) fmt_->size() : 0; }

  private:
    std::string decode_text(const std::string & text, bool first, bool want_logits);

    llama_model * model_ = nullptr;
    llama_context * ctx_ = nullptr;
    common_sampler * sampler_ = nullptr;
    common_chat_templates * templates_ = nullptr;
    common_batch * batch_ = nullptr;
    std::unique_ptr<ChatFormat> fmt_;
    std::vector<uint8_t> system_state_;
    int system_n_past_ = 0;
    int n_past_ = 0;
    int n_batch_ = 256;
    bool add_bos_ = false;
    bool add_eos_ = false;
    std::atomic<bool> stop_{false};
};

}  // namespace beside
