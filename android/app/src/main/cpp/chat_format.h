// Turns a chat into the exact text to feed the model, one message at a time.
#pragma once

#include <string>
#include <vector>

struct common_chat_templates;

namespace beside {

struct Message {
    std::string role;  // "system", "user" or "assistant"
    std::string content;
};

class ChatFormat {
  public:
    ChatFormat(const common_chat_templates * templates, bool add_bos, bool add_eos)
        : templates_(templates), add_bos_(add_bos), add_eos_(add_eos) {}

    // Text a conversation begins with: everything before the first user message's words.
    std::string start(const std::string & system);
    // Text to add for one more message. With add_generation_prompt, it ends where the reply begins.
    std::string next(const Message & msg, bool add_generation_prompt);
    // Record a reply the model wrote; tail is what it emitted after the words (its end token).
    void generated(const std::string & content, const std::string & tail);
    // Forget everything after the system prompt.
    void rewind();

    size_t size() const { return history_.size(); }
    const std::string & system_text() const { return system_text_; }
    std::string render(const std::vector<Message> & msgs, bool add_generation_prompt) const;

  private:
    const common_chat_templates * templates_;
    bool add_bos_;
    bool add_eos_;
    std::vector<Message> history_;
    std::string system_text_;
    std::string tail_;  // text the model's memory holds after the last message's words
};

}  // namespace beside
