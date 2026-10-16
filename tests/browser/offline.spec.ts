import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// The real models are multi-gigabyte downloads, so these tests swap in deterministic
// engines through the app's test hook. Everything else (UI, storage, tools, speech
// queue, audio scheduling, service worker) is the real code.
async function installFakeEngines(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    const spoken: string[] = [];
    w.__spoken = spoken;
    w.__besideTest = {
      llm: () => ({
        async load() {
          await new Promise((r) => setTimeout(r, 150));
          return { repo: "test/model", device: "wasm", dtype: "q4" };
        },
        async generate(
          messages: { role: string; content: string }[],
          _max: number,
          onToken: (t: string) => void,
        ) {
          const last = messages.at(-1)!.content.toLowerCase();
          if (!messages[0].content.includes("<action>"))
            throw new Error("missing tool guide");
          const reply = last.includes("remind")
            ? 'Of course. I\'ll remind you in twenty minutes to stretch, so you don\'t have to hold it in your head. <action>{"tool": "set_reminder", "args": {"text": "Stretch", "minutes": 20}}</action>'
            : last.includes("stuck")
              ? 'That stuck feeling is real, and it isn\'t laziness. Let\'s shrink it. I added one tiny task for you. <action>{"tool": "add_task", "args": {"title": "Open the laundry basket", "steps": ["Stand up", "Walk to the basket"]}}</action>'
              : "Hi. I'm here with you. What's on your mind?";
          for (const piece of reply.match(/.{1,4}/gs)!) {
            await new Promise((r) => setTimeout(r, 4));
            onToken(piece);
          }
          return { tokens: 40, firstTokenMs: 120, tokensPerSecond: 9.5 };
        },
        stop() {},
      }),
      tts: () => ({
        async load() {},
        async synth(_id: number, text: string) {
          spoken.push(text);
          const samples = new Float32Array(2400);
          for (let i = 600; i < 1800; i++) samples[i] = 0.1 * Math.sin(i / 8);
          return { samples, sampleRate: 24000 };
        },
        cancel() {},
      }),
    };
  });
}

async function firstRun(page: Page) {
  await page.goto("/offline.html");
  const sheet = page.getByRole("dialog", { name: "Settings" });
  await expect(sheet).toBeVisible();
  await sheet.getByRole("radio", { name: /Qwen 3\.5 4B/ }).check();
  await sheet.getByRole("button", { name: "Download and start" }).click();
  await expect(
    sheet.getByText("Qwen 3.5 4B is running on the tablet's processor."),
  ).toBeVisible();
  await sheet.getByRole("button", { name: "Close settings" }).click();
  await expect(page.getByText("On device", { exact: true })).toBeVisible();
}

test.describe("on-device voice companion", () => {
  test.use({ viewport: { width: 1152, height: 720 }, hasTouch: true });

  test("type, hear the reply, and let the assistant use tools", async ({
    page,
  }) => {
    const errors: string[] = [];
    const external: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => {
      if (
        !r.url().startsWith("http://127.0.0.1:3100") &&
        !r.url().startsWith("blob:")
      )
        external.push(r.url());
    });
    await installFakeEngines(page);
    await firstRun(page);
    expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);

    await page.screenshot({ path: "test-results/offline-empty.png" });
    await page.getByLabel("Message").fill("Remind me to stretch in 20 minutes");
    await page.keyboard.press("Enter");

    const log = page.getByLabel("Conversation", { exact: true });
    await expect(
      log.getByText("Remind me to stretch in 20 minutes"),
    ).toBeVisible();
    await expect(
      log.getByText(/I'll remind you in twenty minutes/),
    ).toBeVisible();
    await expect(log.getByText(/Reminder at .*: Stretch/)).toBeVisible();
    await expect(log.getByText("<action>")).toHaveCount(0);
    await expect(
      page.getByLabel("Today", { exact: true }).getByText("Stretch"),
    ).toBeVisible();

    const spoken = await page.evaluate(
      () => (window as unknown as { __spoken: string[] }).__spoken,
    );
    expect(spoken.length).toBeGreaterThan(0);
    expect(spoken.join(" ")).toContain("remind you");
    expect(spoken.join(" ")).not.toMatch(/action|tool|\{/);

    // A second turn creates a task with steps; Undo removes it again.
    await page.getByLabel("Message").fill("I'm stuck");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(
      log.getByText(/Added “Open the laundry basket” with 2 small steps/),
    ).toBeVisible();
    const today = page.getByLabel("Today", { exact: true });
    await expect(
      today.getByText("Open the laundry basket").first(),
    ).toBeVisible();
    await page.screenshot({ path: "test-results/offline-chat.png" });
    await log.getByRole("button", { name: "Undo" }).last().click();
    await expect(
      today.getByRole("button", { name: /Open the laundry basket/ }),
    ).toHaveCount(0);

    // Slash commands work instantly.
    await page.getByLabel("Message").fill("/task Call the dentist");
    await page.keyboard.press("Enter");
    await expect(
      today.getByRole("button", { name: "Call the dentist", exact: true }),
    ).toBeVisible();
    await page.getByLabel("Message").fill("/timer 15 Inbox");
    await page.keyboard.press("Enter");
    await expect(today.getByRole("timer")).toBeVisible();
    await expect(today.getByText("Inbox", { exact: true })).toBeVisible();

    // Energy check-in is saved locally.
    await today.getByRole("button", { name: "Low" }).click();
    await expect(today.getByText(/Last: low at/)).toBeVisible();

    // Everything survives a reload.
    await page.reload();
    await expect(
      page.getByRole("button", {
        name: "Remind me to stretch in 20 minutes",
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", {
        name: "Remind me to stretch in 20 minutes",
        exact: true,
      })
      .click();
    await expect(
      log.getByText(/I'll remind you in twenty minutes/),
    ).toBeVisible();
    await expect(
      page
        .getByLabel("Today", { exact: true })
        .getByRole("button", { name: "Call the dentist", exact: true }),
    ).toBeVisible();

    expect(external).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("passes accessibility checks in landscape and portrait", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" }); // check settled colours, not fade-ins
    await installFakeEngines(page);
    await firstRun(page);
    for (const size of [
      { width: 1152, height: 720 },
      { width: 720, height: 1152 },
    ]) {
      await page.setViewportSize(size);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa"])
        .analyze();
      expect(
        results.violations.map(
          (v) =>
            `${v.id}: ${v.help} ${v.nodes.map((n) => n.target.join(" ") + " " + n.failureSummary).join(" | ")}`,
        ),
      ).toEqual([]);
    }
    await page.screenshot({ path: "test-results/offline-portrait.png" });
    await page.getByRole("button", { name: /Change model/ }).click();
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });

  test("opens with no connection once installed", async ({ page, context }) => {
    await installFakeEngines(page);
    await page.goto("/offline.html");
    await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      return reg.active?.state;
    });
    await page.reload();
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
    await expect(page.getByText("Offline · all working")).toBeVisible();
    await context.setOffline(false);
  });
});
