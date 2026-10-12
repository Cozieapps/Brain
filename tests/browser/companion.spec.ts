import { test, expect } from "@playwright/test";
const headers = { "X-Beside": "1", "Content-Type": "application/json" };
test.beforeEach(async ({ request }) => {
  await request.post("/api/delete-all", {
    headers,
    data: { confirm: "DELETE" },
  });
});
test("desktop companion: capture, convert, checkpoint, reload and resume", async ({
  page,
}) => {
  const errors: string[] = [];
  const external: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (!r.url().startsWith("http://127.0.0.1:3100")) external.push(r.url());
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "A little less to carry." }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/beside-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Hold this", exact: true }).click();
  await page.getByLabel("A short label").fill("Passport paperwork");
  await page
    .getByLabel("The thought, text, or link")
    .fill("Renew passport before the trip");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page
    .getByRole("button", { name: "Things you’ve held", exact: true })
    .click();
  await page.getByRole("button", { name: /Passport paperwork/ }).click();
  await page
    .getByPlaceholder("One concrete next action")
    .fill("Find my passport");
  await page.getByRole("button", { name: "Make it a responsibility" }).click();
  await page
    .getByRole("button", { name: "Save my place", exact: true })
    .click();
  await page.getByLabel("Give this a name").fill("Passport form");
  await page.getByLabel("What were you trying to do?").fill("Renew passport");
  await page.getByLabel("Where are you leaving off?").fill("at section two");
  await page.getByLabel("The very next action").fill("Upload my photo");
  await page
    .getByRole("button", { name: "Save my place", exact: true })
    .last()
    .click();
  await page.reload();
  await page
    .getByRole("button", { name: "Your companion", exact: true })
    .click();
  await page.getByRole("button", { name: "Where was I?", exact: true }).click();
  await expect(
    page
      .getByLabel("Conversation")
      .getByText("You were at section two. Next: Upload my photo", {
        exact: true,
      }),
  ).toBeVisible();
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});
test("mobile keyboard, start help, capacity and all ten workflow choices", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "I’m stuck", exact: true }).click();
  await page
    .getByLabel("What are you trying to start?")
    .fill("Write the first email");
  await page.getByLabel("It feels difficult", { exact: true }).check();
  await page.getByRole("button", { name: "Find one first step" }).click();
  await expect(
    page.getByText(/Write a private, unsent first sentence/).first(),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Today’s too much", exact: true })
    .click();
  await page.getByRole("button", { name: /A little room/ }).click();
  await expect(
    page.getByText(/We can make today smaller/).first(),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "A few more ways I can help" })
    .click();
  await expect(page.getByRole("dialog").getByRole("button")).toHaveCount(11);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/beside-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("button", { name: "Your preferences" }).click();
  await expect(
    page.getByRole("heading", { name: "Make room for you." }),
  ).toBeVisible();
  await page.keyboard.press("Tab");
  const focused = await page.evaluate(() => document.activeElement?.tagName);
  expect(focused).not.toBe("BODY");
});
test("return never claims submission and reminder/permission controls are functional", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Responsibilities", exact: true })
    .click();
  await page.getByRole("button", { name: "Add something" }).click();
  await page.getByRole("button", { name: "A return or refund" }).click();
  await page.getByLabel("Give this a name").fill("Return shoes");
  await page.getByLabel("One concrete next action").fill("Find receipt");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: /Return shoes/ }).click();
  await page.getByRole("button", { name: "Prepare a draft" }).click();
  await page.getByRole("button", { name: /Return shoes/ }).click();
  await expect(
    page.getByRole("dialog").getByText("prepared", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Confirm outcome" }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: /evidence/ })
      .last(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Your preferences" }).click();
  await page
    .getByLabel("Allow guided tools to edit internal records and reminders")
    .uncheck();
  await page.getByRole("button", { name: "Your companion" }).click();
  await page.getByRole("button", { name: "Hold this", exact: true }).click();
  await page.getByLabel("A short label").fill("Blocked");
  await page.getByLabel("The thought, text, or link").fill("Should not save");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "permission",
  );
});

test("accessible contrast, keyboard labels and landmarks on mobile and desktop", async ({
  page,
}) => {
  const { default: AxeBuilder } = await import("@axe-core/playwright");
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(results.violations).toEqual([]);
  }
});
