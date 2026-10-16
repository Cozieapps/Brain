#include "chat_format.h"

#include <algorithm>

#include "chat.h"

namespace beside {

namespace {
std::string trim(const std::string & s) {
    const size_t a = s.find_first_not_of(" \t\r\n");
    if (a == std::string::npos) return "";
    const size_t b = s.find_last_not_of(" \t\r\n");
    return s.substr(a, b - a + 1);
}

// Index just after the last place `needle` ends before `limit`, or npos.
size_t end_of_last(const std::string & hay, const std::string & needle, size_t limit) {
    if (needle.empty() || limit < needle.size()) return std::string::npos;
    const size_t at = hay.rfind(needle, limit - needle.size());
    return at == std::string::npos ? at : at + needle.size();
}
}  // namespace

std::string ChatFormat::render(const std::vector<Message> & msgs, bool add_generation_prompt) const {
    common_chat_templates_inputs in;
    in.use_jinja = true;
    in.enable_thinking = false;  // Qwen answers straight away instead of reasoning first
    in.chat_template_kwargs["enable_thinking"] = "false";
    in.add_bos = add_bos_;
    in.add_eos = add_eos_;
    in.add_generation_prompt = add_generation_prompt;
    for (const auto & m : msgs) {
        common_chat_msg c;
        c.role = m.role;
        c.content = m.content;
        in.messages.push_back(c);
    }
    return common_chat_templates_apply(templates_, in).prompt.str();
}

// Some templates refuse a system prompt on its own (Qwen 3.5) or fold it into the first user
// turn, so render two different first messages and keep what they share.
std::string ChatFormat::start(const std::string & system) {
    const std::string a = render({{"system", system}, {"user", "\x01"}}, false);
    const std::string b = render({{"system", system}, {"user", "\x02"}}, false);
    size_t n = 0;
    while (n < a.size() && n < b.size() && a[n] == b[n]) ++n;
    history_ = {{"system", system}};
    system_text_ = a.substr(0, n);
    tail_.clear();
    return system_text_;
}

void ChatFormat::rewind() {
    history_.resize(std::min<size_t>(history_.size(), 1));
    tail_.clear();
}

std::string ChatFormat::next(const Message & msg, bool add_generation_prompt) {
    std::vector<Message> all = history_;
    all.push_back(msg);
    const std::string after = render(all, add_generation_prompt);
    const std::string words = trim(msg.content);
    const size_t new_at = words.empty() ? after.size() : after.rfind(words);
    const size_t limit = new_at == std::string::npos ? after.size() : new_at;

    std::string delta;
    if (history_.size() <= 1) {
        delta = after.compare(0, system_text_.size(), system_text_) == 0 ? after.substr(system_text_.size()) : after;
    } else {
        // Templates may re-render earlier turns (Qwen drops the empty thinking block once a
        // newer message follows), so anchor on where the previous message's words end.
        const size_t prev_end = end_of_last(after, trim(history_.back().content), limit);
        if (prev_end != std::string::npos) {
            std::string rest = after.substr(prev_end);
            size_t k = 0;
            while (k < tail_.size() && k < rest.size() && tail_[k] == rest[k]) ++k;
            delta = rest.substr(k);
        } else {
            const std::string before = render(history_, false);
            delta = after.compare(0, before.size(), before) == 0 ? after.substr(before.size())
                                                                  : after.substr(std::min(after.size(), limit));
        }
    }
    // What memory will hold after this message's words, for lining up the next one.
    const size_t own_end = words.empty() ? std::string::npos : end_of_last(delta, words, delta.size());
    tail_ = own_end == std::string::npos ? "" : delta.substr(own_end);
    if (add_generation_prompt) tail_.clear();  // the reply follows directly
    history_.push_back(msg);
    return delta;
}

void ChatFormat::generated(const std::string & content, const std::string & tail) {
    history_.push_back({"assistant", content});
    tail_ = tail;
}

}  // namespace beside
