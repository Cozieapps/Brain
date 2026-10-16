// Desktop check of the engine with a real GGUF: two turns, a reset, and a replayed chat.
// Build: see android/native-test/CMakeLists.txt. Usage: beside-test model.gguf
#include <cstdio>
#include <string>

#include "engine.h"

int main(int argc, char ** argv) {
    if (argc < 2) {
        fprintf(stderr, "usage: %s model.gguf\n", argv[0]);
        return 2;
    }
    beside::Engine e;
    std::string err = e.load(argv[1], 4096, 4);
    if (!err.empty()) {
        fprintf(stderr, "load failed: %s\n", err.c_str());
        return 1;
    }
    printf("model: %s\n", e.describe().c_str());
    const std::string system =
        "You are Beside, a warm companion. Reply in one or two short spoken sentences. "
        "To save a task, end with <action>{\"tool\": \"add_task\", \"args\": {\"title\": \"...\"}}</action>";
    const std::string cache = std::string(argv[1]) + ".system-cache";
    remove(cache.c_str());
    err = e.set_system(system, cache);
    if (!err.empty()) {
        fprintf(stderr, "system failed: %s\n", err.c_str());
        return 1;
    }
    const int system_tokens = e.n_past();
    printf("system tokens: %d\n", system_tokens);
    // The second time, the processed prompt comes from the cache file.
    err = e.set_system(system, cache);
    if (!err.empty() || e.n_past() != system_tokens) {
        fprintf(stderr, "system cache failed: %s (n_past %d)\n", err.c_str(), e.n_past());
        return 1;
    }
    printf("system prompt restored from cache\n");
    auto turn = [&](const char * user) {
        printf("\nUSER: %s\nBESIDE: ", user);
        auto r = e.generate(user, 160, 0.7f, [](const std::string & p) {
            fputs(p.c_str(), stdout);
            fflush(stdout);
            return true;
        });
        printf("\n[status %d · prompt %d tok · %d tok · first %.0f ms · %.1f tok/s · n_past %d]\n", r.status,
               r.prompt_tokens, r.tokens, r.first_token_ms, r.tokens_per_second, e.n_past());
        return r;
    };
    auto a = turn("I can't get started on the laundry. Please add it as a task.");
    auto b = turn("Thanks. What was the task you just added?");
    if (a.status != 0 || b.status != 0 || a.tokens == 0 || b.tokens == 0) return 1;
    if (a.text.find("<think>") != std::string::npos) {
        fprintf(stderr, "thinking was not disabled\n");
        return 1;
    }
    err = e.reset_to_system();
    if (!err.empty() || e.history_size() != 1) {
        fprintf(stderr, "reset failed: %s\n", err.c_str());
        return 1;
    }
    e.append({"user", "My name is Rosa."});
    e.append({"assistant", "Nice to meet you, Rosa."});
    auto c = turn("What's my name?");
    if (c.status != 0 || c.text.find("Rosa") == std::string::npos) {
        fprintf(stderr, "replayed history was not remembered\n");
        return 1;
    }
    remove(cache.c_str());
    printf("\nOK\n");
    return 0;
}
