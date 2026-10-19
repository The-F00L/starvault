// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setInstance } from "../lib/instance";
import { ProfilePage } from "./ProfilePage";

vi.mock("../lib/api", async (orig) => ({
  ...(await orig<typeof import("../lib/api")>()),
  fetchUser: async () => ({ login: "octo", name: null, avatarUrl: "", bio: null, htmlUrl: "https://github.com/octo" }),
  fetchStarred: async () => [],
  fetchLists: async () => [],
}));

afterEach(() => {
  cleanup();
  setInstance({ mode: "public" });
});

describe("ProfilePage", () => {
  it("copies a link to the public site when self-hosted, since friends can't reach the homelab", async () => {
    setInstance({ mode: "self-hosted", login: "octo", avatarUrl: null, shareBaseUrl: "https://sv.example.workers.dev", tokenOk: true });
    const user = userEvent.setup(); // installs a clipboard stub
    render(
      <MemoryRouter initialEntries={["/u/octo"]}>
        <Routes>
          <Route path="/u/:username" element={<ProfilePage />} />
        </Routes>
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole("button", { name: "Copy link" }));
    expect(await navigator.clipboard.readText()).toBe("https://sv.example.workers.dev/u/octo");
  });
});
