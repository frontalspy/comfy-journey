import { expect, type Page, test } from "@playwright/test";

const PROMPT = "a lighthouse at sunset";

async function createPicture(page: Page, prompt: string): Promise<void> {
  await page.goto("/");
  await page.getByPlaceholder("Describe what you want to see…").fill(prompt);
  await page.getByPlaceholder("Describe what you want to see…").press("Enter");
}

test("a prompt becomes a picture in the feed", async ({ page }) => {
  await createPicture(page, PROMPT);
  const picture = page.getByRole("button", { name: `Open: ${PROMPT}` }).first();
  await expect(picture).toBeVisible();
  await expect(picture.locator("img")).toHaveJSProperty("complete", true);
});

test("the library lists it and the viewer shows its details", async ({ page }) => {
  await createPicture(page, PROMPT);
  await page
    .getByRole("button", { name: `Open: ${PROMPT}` })
    .first()
    .waitFor();
  await page.goto("/library");
  await page
    .getByRole("button", { name: `Open: ${PROMPT}` })
    .first()
    .click();
  const details = page.getByRole("complementary", { name: "Details" });
  await expect(details).toContainText(PROMPT);
  await page.getByRole("button", { name: "Close" }).click();
  await expect(details).toBeHidden();
});

for (const path of ["/", "/library", "/activity", "/workflows", "/settings"]) {
  test(`${path} fits the screen width`, async ({ page }) => {
    await page.goto(path);
    await page.getByRole("navigation", { name: "Main" }).waitFor();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test("the workflows page reports the example as ready", async ({ page }) => {
  await page.goto("/workflows");
  await expect(page.getByText("Ready").first()).toBeVisible();
});
