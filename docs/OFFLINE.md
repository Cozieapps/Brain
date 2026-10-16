# Beside on-device: type, and it answers out loud

`/offline.html` is a separate app in this repository. It runs a language model and a neural voice inside the browser on the tablet. You type; Beside streams a reply and starts speaking after the first phrase. Chats, tasks, reminders, notes and check-ins are stored in the browser's IndexedDB on that device. Nothing is sent anywhere. After the one-time download it works with Wi-Fi off.

It does not need the Node server or an account. It does need to be served once over HTTPS (or from `127.0.0.1`) so Chrome can install it.

## Put it on the Galaxy Tab

1. Deploy as usual (see [CLOUDFLARE.md](CLOUDFLARE.md)) or run `npm run build && npm start` on a computer on the same network.
2. On the tablet, open `https://<your-site>/offline.html` in Chrome, then use **⋮ → Add to home screen → Install**.
3. On first launch pick a model and tap **Download and start**. Stay on Wi-Fi until it says the model is running. The voice (about 90 MB) downloads at the same time.
4. In **Settings → Privacy & storage**, turn on **Offline lock**. From then on nothing is downloaded, even if the tablet is online.

No internet on the tablet at all? On a computer run `hf download <repo>` for the model (and `onnx-community/Kokoro-82M-v1.0-ONNX` for the voice). Copy the folders to the tablet, then use **Settings → Privacy & storage → Import without internet**.

## Which model on the Tab S9 FE 5G

The Tab S9 FE uses an Exynos 1380 (4× Cortex-A78, Mali-G68 MP5 GPU) and ships with **6 GB or 8 GB** of RAM. Android and Chrome use roughly 2–3 GB of that, which is the real limit.

| Model         | Download | Best for                                             | Tablet       |
| ------------- | -------- | ---------------------------------------------------- | ------------ |
| Qwen 3.5 4B   | ~2.9 GB  | Smartest that fits; best at planning and using tools | 8 GB         |
| Gemma 4 E4B   | ~3.6 GB  | Warmest, most natural writing                        | 8 GB (tight) |
| Qwen 3 4B     | ~2.8 GB  | Steady and reliable with tools                       | 8 GB         |
| Gemma 4 E2B   | ~2.1 GB  | Gemma's style, roughly twice as fast                 | 6 GB         |
| Qwen 3.5 2B   | ~1.6 GB  | Everyday pick on 6 GB: fast and still capable        | 6 GB         |
| Qwen 3.5 0.8B | ~0.6 GB  | Very quick captures and simple chats                 | any          |

**Is there something more capable?** Not really, on this tablet. The current small models (Qwen 3.5 4B, Gemma 4 E4B) are the most capable that fit its memory. Qwen 3 8B or Qwen 3.5 9B need about 5–6 GB for the weights alone: they would not load on the 6 GB model, and on 8 GB they would be painfully slow and likely crash. A faster chip (Snapdragon 8 Gen 2/3, for example the Tab S9 or S10 series) is what unlocks bigger models.

For speed, Qwen 3.5 and Qwen 3 run with "thinking" switched off. Replies are short by default, because the model writes faster and the voice starts sooner. **Settings → About you → Fuller answers** changes that.

Sizes are estimates for the 4-bit ONNX builds. The setup screen shows the real byte count while downloading. The Qwen 3.5 entries list two candidate repository names (the community ONNX naming wasn't confirmed from the build machine). If neither exists, paste the current repository under **Settings → Assistant → Advanced**.

## Why the voice sounds more human now

- **Kokoro-82M**, a neural voice that runs on the tablet. "Heart" and "Bella" are its highest-rated voices; the lower-rated ones sound more synthetic, so they aren't offered.
- **Speed is changed inside the voice model**, which re-paces the speech. Speeding up already-made audio is what makes most voices sound chipmunky and robotic. It stays natural up to about 1.3×.
- **It starts after the first phrase.** Speech is split into sentences as the model writes. The first short clause is spoken right away, and later short sentences are grouped so the rhythm isn't choppy.
- **Even pauses.** Silence is trimmed from each sentence, then a consistent pause is added: a little longer after a question, shorter after a comma.
- **The model writes for speaking**: short sentences and contractions, with no markdown, emoji or headings. Those read badly aloud. Anything still left over (bullets, links, symbols) is cleaned up before it reaches the voice.
- If the natural voice isn't loaded yet, the tablet's own voice is used. Samsung/Google "Natural" voices are preferred when installed.

## What it can do (tools)

The model can use these by itself. Each one appears as a card with a check mark and **Undo**:

- add a task, with tiny first steps · break an existing task into steps · mark done
- set a reminder ("in 20 minutes", "at 17:30"): chime, spoken aloud, and a notification
- start a focus timer: visible ring, spoken check-in at halfway, chime at the end (body doubling)
- save a note or brain-dump item · log energy (and, optionally, cycle phase)

Slash commands work instantly, even before a model is loaded: `/task Call the dentist`, `/timer 25 Inbox`, `/remind 20 take meds`, `/remind 17:30 leave for pickup`, `/note idea`, `/energy 2 foggy`, `/done dentist`.

The **Today** panel (docked in landscape, slides in for portrait) shows "One thing now", the focus timer, to-dos with steps, reminders, an energy check-in, and notes. The model is told the open tasks, the last check-in and the time, so its suggestions match the day.

## Honest limits

- **Not tried on a real Galaxy Tab yet.** The build machine couldn't download models (Hugging Face is blocked there), so real inference speed and memory use are unmeasured. Expect the 4B models to be noticeably slower than the 2B ones; each reply shows its real tokens per second and time to first word, so you can compare on the device.
- **Reminders and timers fire while Beside is open** (in the foreground, or recently in the background). Chrome can't wake a closed web app on a schedule without a push server, and that would break "100% offline".
- **No WhatsApp, Calendar, web search or other apps.** A web page can't control other Android apps; that would need a native Android app with accessibility permissions. Search would also need the internet.
- The model runs on the GPU through WebGPU when Chrome allows it, otherwise on the CPU (slower). Half-precision (`q4f16`) is used only if the GPU supports it.
- On Cloudflare, the 26 MB ONNX Runtime binary exceeds the 25 MiB per-file asset limit. There the app downloads a version-pinned copy from jsDelivr once, during setup, and keeps it in Cache Storage. The Node server serves its own copy.

## If you want it faster: the native route

A native Android app would be about 2–3× faster on this chip, and could use other apps. The stack: LiteRT-LM (Google's runtime for Gemma 4 `.litertlm` files, GPU/NPU) or llama.cpp (Qwen GGUF), with sherpa-onnx running the same Kokoro voice. The UI, prompt, tools and speech chunking here are designed to carry over. That build needs the Android SDK, which the current build machine can't download.

## Verify

```sh
npm test               # includes tests/offline.test.ts (chunking, speech cleanup, tools, prompt)
npm run build
npm run test:browser   # includes tests/browser/offline.spec.ts
```

The browser tests use stand-in model and voice engines through `window.__besideTest` (never set in normal use). Everything else is the real code: UI, IndexedDB, tools, the speech queue and audio scheduling, the service worker reload with no connection, and WCAG A/AA checks at tablet landscape and portrait sizes. They also assert that the page makes no external requests.
