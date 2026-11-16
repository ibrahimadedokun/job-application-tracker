import { test, expect } from "@playwright/test";
import { Document, Packer, Paragraph } from "docx";

test("expired production sessions return to sign-in", async ({ page }) => {
  const authority = "https://cognito-idp.eu-west-2.amazonaws.com/test-pool";
  const clientId = "test-browser-client";
  await page.route("**/config.json", (route) =>
    route.fulfill({ json: { local: false, apiUrl: "", authority, clientId } }),
  );
  await page.route("**/api/jobs", (route) => route.fulfill({ json: [] }));
  await page.addInitScript(
    ({ authority, clientId }) => {
      sessionStorage.setItem(
        `oidc.user:${authority}:${clientId}`,
        JSON.stringify({
          access_token: "fictional-token",
          token_type: "Bearer",
          scope: "openid email profile",
          profile: { sub: "test-user" },
          expires_at: Math.floor(Date.now() / 1000) + 3,
        }),
      );
    },
    { authority, clientId },
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Your next chapter, organised." }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toContainText(
    "Your session has expired",
    { timeout: 10000 },
  );
  await expect(
    page.getByRole("button", { name: "Sign in securely" }),
  ).toBeEnabled();
  await expect(
    page.getByRole("heading", { name: "Your next chapter, organised." }),
  ).toBeHidden();
});

function createPdf(text) {
  const content = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ];
  let document = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(document));
    document += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const crossReferenceOffset = Buffer.byteLength(document);
  document += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  document += offsets
    .slice(1)
    .map((offset) => `${offset.toString().padStart(10, "0")} 00000 n \n`)
    .join("");
  document += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${crossReferenceOffset}\n%%EOF`;
  return Buffer.from(document);
}

test("create, search, update, tailor, download, export, delete and mobile layout", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
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
  const cv = await Packer.toBuffer(
    new Document({
      sections: [
        {
          children: [
            new Paragraph({ text: "Alex Smith" }),
            new Paragraph({ text: "Frontend Engineer" }),
            new Paragraph({
              text: "Built accessible JavaScript interfaces at Example Company. Collaborated with engineers and designers to deliver tested software.",
            }),
          ],
        },
      ],
    }),
  );
  await dialog.getByLabel("Upload CV").setInputFiles({
    name: "alex-cv.docx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: cv,
  });
  await expect(dialog.getByRole("textbox", { name: /Your CV/ })).toHaveValue(
    /Alex Smith/,
  );
  await dialog.getByLabel("Upload cover letter").setInputFiles({
    name: "cover-letter.pdf",
    mimeType: "application/pdf",
    buffer: createPdf(
      "I have built accessible products and enjoy collaborating with thoughtful teams on high-quality frontend software.",
    ),
  });
  await expect(dialog.getByRole("alert")).not.toBeVisible();
  await expect(
    dialog.getByRole("textbox", { name: /Your cover letter/ }),
  ).toHaveValue(/I have built accessible products/);
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "Create demo preview" }).click();
  await expect(dialog.getByText("What changed", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Tailored CV", { exact: true })).toBeVisible();
  const [document] = await Promise.all([
    page.waitForEvent("download"),
    dialog
      .getByRole("button", { name: "Download DOCX", exact: true })
      .first()
      .click(),
  ]);
  expect(document.suggestedFilename()).toContain("-cv.docx");
  expect(document.suggestedFilename()).toContain("Browser Test Co");
  await dialog.getByText("Original documents", { exact: true }).click();
  await expect(
    dialog.getByRole("heading", { name: "Original CV" }),
  ).toBeVisible();
  await expect(dialog.locator("details pre").last()).toContainText(
    "I have built accessible products",
  );
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
