// Checks ChatFormat against real chat templates (llama.cpp's models/templates/*.jinja):
// every turn must add only its own text, never repeat earlier turns.
// Usage: beside-format-test template.jinja [more.jinja ...]
#include <cstdio>
#include <fstream>
#include <sstream>
#include <string>

#include "chat.h"
#include "chat_format.h"

using beside::ChatFormat;
using beside::Message;

static int failures = 0;
static void check(bool ok, const char * what, const std::string & detail = "") {
    if (!ok) {
        ++failures;
        fprintf(stderr, "  FAIL: %s\n%s\n", what, detail.c_str());
    }
}

static std::string strip_empty_think(std::string s) {
    // Empty thinking blocks: the generation prompt opens one; templates drop it from older turns.
    for (const std::string t : {"<think>\n\n</think>\n\n", "<think>\n</think>\n\n", "<|channel>thought\n<channel|>"})
        for (size_t at; (at = s.find(t)) != std::string::npos;) s.erase(at, t.size());
    return s;
}

int main(int argc, char ** argv) {
    for (int i = 1; i < argc; ++i) {
        std::ifstream f(argv[i]);
        std::stringstream ss;
        ss << f.rdbuf();
        auto tmpls = common_chat_templates_init(nullptr, ss.str());
        printf("== %s\n", argv[i]);
        const std::string sys = "You are Beside. SYSTEM-TEXT.", u1 = "I can't start the laundry.",
                          a1 = "Okay. I added it.", u2 = "What did you add?", a2 = "Laundry.";
        ChatFormat fmt(tmpls.get(), false, false);

        // The text the model's memory would hold, built turn by turn.
        std::string kv = fmt.start(sys);
        check(kv.find("SYSTEM-TEXT") != std::string::npos, "system prompt present", kv);
        const std::string d1 = fmt.next({"user", u1}, true);
        check(d1.find(u1) != std::string::npos && d1.find("SYSTEM-TEXT") == std::string::npos, "first turn adds only itself", d1);
        // The model writes its reply and then its end-of-turn token, which comes right after the
        // words in the template's own rendering.
        const std::string full1 = fmt.render({{"system", sys}, {"user", u1}, {"assistant", a1}}, false);
        const size_t after_a1 = full1.rfind(a1) + a1.size();
        const std::string eog = full1.substr(after_a1, full1.find('>', after_a1) + 1 - after_a1);
        kv += d1 + a1 + eog;
        fmt.generated(a1, eog);
        const std::string d2 = fmt.next({"user", u2}, true);
        check(d2.find(u2) != std::string::npos, "second turn has its words", d2);
        check(d2.find(u1) == std::string::npos && d2.find(a1) == std::string::npos, "second turn does not repeat history", d2);
        kv += d2;
        const std::string expect = fmt.render({{"system", sys}, {"user", u1}, {"assistant", a1}, {"user", u2}}, true);
        check(strip_empty_think(kv) == strip_empty_think(expect), "memory matches the template",
              "--- memory ---\n" + kv + "\n--- template ---\n" + expect);

        // Replaying a saved chat, then continuing.
        fmt.rewind();
        std::string replay = fmt.system_text();
        replay += fmt.next({"user", u1}, false);
        replay += fmt.next({"assistant", a1}, false);
        const std::string d3 = fmt.next({"user", u2}, true);
        check(d3.find(u1) == std::string::npos && d3.find(a1) == std::string::npos, "replayed turn does not repeat history", d3);
        replay += d3;
        check(strip_empty_think(replay) == strip_empty_think(expect), "replayed memory matches the template",
              "--- memory ---\n" + replay + "\n--- template ---\n" + expect);
        (void) a2;
        printf("%s", failures ? "" : "  ok\n");
    }
    printf(failures ? "%d FAILED\n" : "all templates OK\n", failures);
    return failures ? 1 : 0;
}
