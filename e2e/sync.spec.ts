import { expect, test, type Browser, type Page } from "@playwright/test";

const USER = "e2e-user";
const PIXEL = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";
const STARRED = [
  {
    starred_at: "2026-10-01T00:00:00Z",
    repo: {
      id: 1, node_id: "R_1", full_name: "acme/rocket", name: "rocket", owner: { login: "acme", avatar_url: PIXEL },
      description: "Fast things", html_url: "https://github.com/acme/rocket", homepage: null, language: "TypeScript", topics: ["cli"],
      stargazers_count: 10, forks_count: 1, watchers_count: 10, open_issues_count: 0, license: null, archived: false, fork: false,
      private: false, default_branch: "main", created_at: "2020-01-01T00:00:00Z", pushed_at: "2026-09-01T00:00:00Z",
    },
  },
];

/**
 * A fresh browser profile. The server runs without a GitHub token, and the client refuses a star sync while the
 * token is broken, so the browser is told the token works and the server's GitHub proxy routes are faked.
 * /api/sync stays real: that's what this test is about.
 */
async function profile(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  await context.route("**/api/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/api/sync") return route.continue();
    if (pathname === "/api/instance") {
      const real = await (await route.fetch()).json();
      return route.fulfill({ json: { ...real, login: USER, avatarUrl: PIXEL, tokenOk: true, tokenError: undefined } });
    }
    if (pathname === `/api/users/${USER}`) return route.fulfill({ json: { login: USER, name: null, avatarUrl: PIXEL, bio: null, htmlUrl: `https://github.com/${USER}` } });
    if (pathname === "/api/me/starred") return route.fulfill({ json: { items: STARRED, hasNext: false } });
    if (pathname === "/api/me/lists") return route.fulfill({ json: [] });
    return route.fulfill({ status: 404, json: { error: "Not found on GitHub" } });
  });
  // Anything that still falls back to GitHub directly gets a 404, never the real network.
  await context.route("https://api.github.com/**", (route) => route.fulfill({ status: 404, json: { message: "Not Found" } }));
  return context.newPage();
}

async function connect(page: Page) {
  await page.goto("/");
  // The instance names its owner, so the username is already set and Sync starts right away.
  await page.getByTitle("Sync stars from GitHub").click();
  await expect(page.getByText("rocket", { exact: true }).first()).toBeVisible();
}

/** Fire the "tab became visible" trigger until `check` passes (the writer flushes 1 s after its edit). */
async function eventually(page: Page, check: () => Promise<void>) {
  await expect(async () => {
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await check();
  }).toPass({ timeout: 20_000 });
}

test("notes and collections sync between two browsers, deletions too", async ({ browser }) => {
  const a = await profile(browser);
  const b = await profile(browser);
  await connect(a);
  await connect(b);
  await b.goto("/collections");

  // A: a note and a collection.
  await a.goto("/repo/acme/rocket");
  await a.getByPlaceholder("Why did you star this? What is it good for?").fill("Synced from A");
  await a.getByRole("button", { name: "Save note" }).click();
  await expect(a.getByRole("button", { name: "Saved" })).toBeVisible(); // the IndexedDB write landed; navigating earlier could drop it
  await a.goto("/collections");
  await a.getByRole("button", { name: "New Collection", exact: true }).click();
  await a.getByPlaceholder("AI & Machine Learning").fill("E2E Tools");
  await a.getByRole("dialog").getByRole("button", { name: /create|save/i }).click();
  await expect(a.getByText("E2E Tools").first()).toBeVisible();

  // B sees both after the tab regains focus, without a reload.
  await eventually(b, () => expect(b.getByText("E2E Tools").first()).toBeVisible());
  await b.goto("/repo/acme/rocket");
  await expect(b.getByPlaceholder("Why did you star this? What is it good for?")).toHaveValue("Synced from A");

  // B deletes the collection; A loses it after focus.
  await b.goto("/collections");
  await b.getByText("E2E Tools").first().click();
  await b.getByRole("button", { name: /^delete$/i }).click();
  await b.getByRole("button", { name: /confirm delete/i }).click();
  await eventually(a, () => expect(a.getByText("E2E Tools")).toHaveCount(0));
});
