import { test, expect } from "@playwright/test";
test("create, search, update, tailor, download, export, delete and mobile layout", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Your next chapter, organised." }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Add application", exact: true })
    .click();
  const modal = page.getByRole("dialog");
  await modal.getByLabel("Company", { exact: true }).fill("Browser Test Co");
  await modal.getByLabel("Job title").fill("Frontend Engineer");
  await modal.getByLabel("Location", { exact: true }).fill("London");
  await modal
    .getByLabel("Job description")
    .fill(
      "We need an engineer with JavaScript, accessible user interfaces, testing, and collaborative software development skills to build useful digital products.",
    );
  await modal.getByRole("button", { name: "Save application" }).click();
  await expect(modal).toBeHidden();
  await page
    .getByRole("textbox", { name: "Search applications" })
    .fill("Browser Test Co");
  await page
    .getByRole("button", { name: "Frontend Engineer", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Application stage").selectOption("Interview");
  await expect(dialog.getByLabel("Application stage")).toHaveValue("Interview");
  await dialog
    .getByRole("button", { name: "Tailor documents", exact: true })
    .click();
  await dialog
    .getByRole("textbox", { name: /Your CV/ })
    .fill(
      "Alex Smith\nFrontend Engineer\nBuilt accessible JavaScript interfaces at Example Company. Collaborated with engineers and designers to deliver tested software.",
    );
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "Create demo preview" }).click();
  await expect(dialog.getByText("What changed", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Tailored CV", { exact: true })).toBeVisible();
  const [document] = await Promise.all([
    page.waitForEvent("download"),
    dialog
      .getByRole("button", { name: "Download", exact: true })
      .first()
      .click(),
  ]);
  expect(document.suggestedFilename()).toContain("-cv.txt");
  await dialog.getByText("Original documents", { exact: true }).click();
  await expect(
    dialog.getByRole("heading", { name: "Original CV" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  const [exported] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export my data" }).click(),
  ]);
  expect(exported.suggestedFilename()).toBe("folio-export.json");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "Add application", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Frontend Engineer", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Delete application & documents" })
    .click();
  await page.getByRole("button", { name: "Delete permanently" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Frontend Engineer", exact: true }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});
