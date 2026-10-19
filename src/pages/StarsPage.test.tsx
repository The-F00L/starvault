// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ToastProvider } from "../hooks/Toast";
import { saveSettings } from "../lib/db";
import { setInstance } from "../lib/instance";
import type { Collection, Repo } from "../lib/types";
import { CollectionHeader } from "./StarsPage";

const list: Collection = {
  id: "gh:L1", name: "Rust tools", icon: "star", description: "", rules: [], githubListId: "L1", githubSlug: "rust-tools", isPrivate: true,
  createdAt: "", updatedAt: "",
};
const repo = { fullName: "a/b", description: null, language: "Rust", stars: 3 } as Repo;

// jsdom's Blob has no stream(), which the share-link encoder uses (browsers and Node have it).
beforeAll(() => {
  Blob.prototype.stream ??= function (this: Blob) {
    const blob = this;
    return new ReadableStream({
      async start(c) {
        c.enqueue(new Uint8Array(await blob.arrayBuffer()));
        c.close();
      },
    });
  } as Blob["stream"];
});
afterEach(() => {
  cleanup();
  setInstance({ mode: "public" });
});

describe("CollectionHeader for a GitHub List", () => {
  it("copies a public-site share link, and still links to the List on GitHub", async () => {
    setInstance({ mode: "self-hosted", login: "octo", avatarUrl: null, shareBaseUrl: "https://sv.example.workers.dev", tokenOk: true });
    await saveSettings({ username: "octo" });
    const user = userEvent.setup(); // installs a clipboard stub
    render(
      <MemoryRouter>
        <ToastProvider>
          <CollectionHeader collection={list} repos={[repo]} />
        </ToastProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByRole("link", { name: /open on github/i })).toHaveProperty("href", "https://github.com/stars/octo/lists/rust-tools");
    await user.click(screen.getByRole("button", { name: "Copy share link" }));
    await expect.poll(() => navigator.clipboard.readText()).toMatch(/^https:\/\/sv\.example\.workers\.dev\/shared#[A-Za-z0-9_-]+$/);
  });
});
