import { test, expect } from "@playwright/test";

const tenant = "11111111-1111-4111-8111-111111111111";
const clientId = "22222222-2222-4222-8222-222222222222";
const authority = `https://login.microsoftonline.com/${tenant}/v2.0`;
const scope = `openid profile email api://${clientId}/access_as_user`;

async function azureRoutes(page) {
  // Exercise the Azure CSP rather than the AWS preview's deployment policy.
  await page.route("http://127.0.0.1:5173/", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: {
        ...response.headers(),
        "content-security-policy":
          "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self' https://login.microsoftonline.com; frame-ancestors 'none'",
      },
    });
  });
  await page.route("**/config.json", (route) =>
    route.fulfill({
      json: {
        local: false,
        provider: "azure",
        apiUrl: "",
        authority,
        clientId,
        scope,
      },
    }),
  );
  await page.route("https://login.microsoftonline.com/**", (route) => {
    if (route.request().url().includes("/.well-known/openid-configuration"))
      return route.fulfill({
        headers: { "access-control-allow-origin": "*" },
        json: {
          issuer: authority,
          authorization_endpoint: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
          token_endpoint: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
          end_session_endpoint: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/logout`,
          jwks_uri: `https://login.microsoftonline.com/${tenant}/discovery/v2.0/keys`,
        },
      });
    return route.fulfill({
      contentType: "text/html",
      body: "Mock Microsoft sign-in/sign-out",
    });
  });
}

test("Azure sign-in requests the delegated API scope with PKCE", async ({
  page,
}) => {
  await azureRoutes(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await expect(page).toHaveURL(/login\.microsoftonline\.com\/.*\/authorize\?/);
  const parameters = new URL(page.url()).searchParams;
  expect(parameters.get("scope")).toBe(scope);
  expect(parameters.get("code_challenge_method")).toBe("S256");
  expect(parameters.get("code_challenge")).toBeTruthy();
  expect(parameters.get("client_id")).toBe(clientId);
});

test("Azure sessions send the access token and use Entra sign-out", async ({
  page,
}) => {
  await azureRoutes(page);
  let authorization;
  await page.route("**/api/jobs", (route) => {
    authorization = route.request().headers().authorization;
    return route.fulfill({ json: [] });
  });
  await page.addInitScript(
    ({ authority, clientId, scope }) => {
      sessionStorage.setItem(
        `oidc.user:${authority}:${clientId}`,
        JSON.stringify({
          access_token: "fictional-azure-access-token",
          token_type: "Bearer",
          scope,
          profile: { sub: "fictional-user" },
          expires_at: Math.floor(Date.now() / 1000) + 300,
        }),
      );
    },
    { authority, clientId, scope },
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Your next chapter, organised." }),
  ).toBeVisible();
  expect(authorization).toBe("Bearer fictional-azure-access-token");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/login\.microsoftonline\.com\/.*\/logout\?/);
  const parameters = new URL(page.url()).searchParams;
  expect(parameters.get("post_logout_redirect_uri")).toBe(
    "http://127.0.0.1:5173/",
  );
});
