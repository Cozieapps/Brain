# Beside for Android (native APK)

`android/` is a native Kotlin + Jetpack Compose app for the Galaxy Tab. You type, and Beside answers out loud. The language model and the voice both run on the tablet. After the one-time download it works with Wi-Fi off. Chats, tasks, reminders, notes and check-ins are stored only in the app's private storage, and cloud backup is switched off.

## Install on the tablet

1. Get `beside-release.apk`, either from the **Android** workflow run's **beside-apk** artifact on GitHub or built yourself (below).
2. Copy it to the tablet and open it. Allow "Install unknown apps" for the app you opened it with (Files or Chrome) when asked.
3. Open **Beside**. The setup sheet suggests a model for the tablet's memory. Tap **Download and start** on Wi-Fi, with the tablet plugged in. The natural voice (350 MB) downloads straight after.
4. When the dot next to the model name turns green, it's running. Turn Wi-Fi off if you like; everything keeps working.

No internet on the tablet at all? Copy a `.gguf` file onto it, then use **Settings → Privacy & storage → Choose a model file**. You can also copy it into `Android/data/app.beside.companion/files/models/` over USB.

Updates install over the previous version, because every build is signed with the same key (`android/app/sideload.keystore`). That key is in the repository, so anyone with repo access can sign an update. Make your own private key before sharing the app with anyone else.

## Models (all checked against Hugging Face: names, sizes, and that they load and answer)

| Model                | File                               | Size    | Tablet        | Notes                                     |
| -------------------- | ---------------------------------- | ------- | ------------- | ----------------------------------------- |
| Qwen 3.5 4B          | `Qwen3.5-4B-Q4_0.gguf`             | 2.6 GB  | 8 GB          | Smartest that fits; best with tools       |
| Gemma 4 E4B          | `gemma-4-E4B-it-Q4_0.gguf`         | 4.6 GB  | 8 GB (tight)  | Warmest writing; slowest here             |
| Qwen 3 4B Instruct   | `Qwen3-4B-Instruct-2507-Q4_0.gguf` | 2.4 GB  | 8 GB          | No thinking step, answers straight away   |
| Gemma 4 E2B          | `gemma-4-E2B-it-Q4_0.gguf`         | 2.8 GB  | 6 GB          | Gemma's style, about twice as fast        |
| Qwen 3.5 2B          | `Qwen3.5-2B-Q4_0.gguf`             | 1.2 GB  | 6 GB          | Fast everyday pick on 6 GB                |
| Qwen 3.5 0.8B        | `Qwen3.5-0.8B-Q4_0.gguf`           | 0.5 GB  | any           | Quick captures, simple chats              |

Q4_0 builds are used on purpose. llama.cpp repacks them at load time for the Exynos 1380's dot-product instructions, which is the fastest path on these Cortex-A78 cores.

**Is there something more capable for the Tab S9 FE 5G?** Not really. It has an Exynos 1380 and 6 or 8 GB of RAM, of which Android uses 2–3 GB. An 8B or 9B model (Qwen 3 8B, Qwen 3.5 9B) needs about 5–6 GB for the weights alone. It would not load on the 6 GB tablet, and on the 8 GB one it would be very slow and likely be closed by Android. Qwen 3.5 4B is the most capable model that fits. A faster tablet (Snapdragon 8 Gen 2 or newer, e.g. Tab S9/S10) is what unlocks bigger models.

## Why it's faster and sounds more human

- **Native llama.cpp (b11700)** runs on the four big cores, built for ARMv8.2 with dot-product and fp16. No browser overhead.
- **Thinking is switched off** for Qwen (via the model's own chat template), so it answers instead of reasoning first.
- **The model never re-reads the chat.** Each turn only processes the new message. The ~900-token instructions are processed once and saved next to the model file. Later launches and chat switches load that snapshot instead of re-reading it, so only the very first start is slow.
- **Kokoro v1.0** (full precision, via sherpa-onnx; it renders about twice as fast on CPUs as the int8 build) speaks. Sentences are rendered on their own thread while the model is still writing, and the first phrase starts within moments. Silence is trimmed and even pauses are added (longer after a question). Speed is applied inside the voice model, which re-paces the speech. It never fast-forwards audio, which is what made other voices sound robotic when sped up. Heart (af_heart), Bella, Nicole and Emma are its best-rated voices.
- **Replies are written to be spoken:** short sentences and contractions, with no lists, markdown or emoji unless asked. The text is cleaned again before it reaches the voice.
- The tablet's own TTS is used until Kokoro is ready, or if you prefer it.

## ADHD tools (each one shows a ✓ card with Undo)

- Tasks with tiny first steps, breaking a task down, marking done. The Today panel shows "One thing now".
- Reminders scheduled with exact alarms. They ring as notifications **even when Beside is closed**, and are rescheduled after a restart.
- A focus timer with a visible ring, a spoken check-in at halfway and a chime at the end (body doubling). It also notifies if the app is in the background.
- Notes / brain dump, with "Sort these into tasks".
- Energy check-ins (and optional cycle phase). The model sees the latest one, so its suggestions match your energy.
- Hand-offs to other apps. Beside never sends anything itself, and she always confirms:
  - **Calendar**: opens the event prefilled; tap Save.
  - **WhatsApp / Messages**: opens with the message written; pick the person and tap send.
  - **Clock**: sets an alarm.
- Slash commands work instantly, without a model: `/task`, `/timer 25 Inbox`, `/remind 20 take meds`, `/remind 17:30 leave`, `/note`, `/energy 2`, `/done dentist`.

Not possible offline: web search, and reading WhatsApp messages. Reading other apps' messages would need accessibility-service permissions, which aren't included.

## Build it yourself

```sh
cd android
./gradlew :app:testDebugUnitTest :app:assembleRelease
# APK: android/app/build/outputs/apk/release/app-release.apk
```

Needs JDK 17+, Android SDK 36 and NDK 28.2.13676358 (`sdkmanager "ndk;28.2.13676358" "cmake;3.31.0"`). llama.cpp is fetched at the pinned tag. Pass `-PllamaSrc=/path/to/llama.cpp` to use a local checkout.

## What's verified and what isn't

- **Verified in CI:**
  - The C++ engine (`android/native-test`) loads and answers with real Qwen 3.5 0.8B, Gemma 4 E2B and Qwen 3 4B Instruct models.
  - Thinking stays off, a replayed chat is remembered, and the saved system prompt reloads.
  - Every catalog file name and byte size matches Hugging Face.
  - The Kokoro archive's layout and speaker IDs are correct, and test sentences are generated.
  - Unit tests and the release APK build pass.
- **Verified locally:** the release APK builds, the unit tests pass, and the UI renders at the Tab S9 FE's resolution (screenshot tests).
- **Not verified:** running on a real Galaxy Tab. No device was available, so on-tablet speed, memory use and audio playback still need a first try. Each reply shows tokens per second and time to the first word, so you can compare models.
