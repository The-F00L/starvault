// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { cleanup, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { SyncProvider, useSync } from "../hooks/SyncContext";
import { ToastProvider } from "../hooks/Toast";
import { setInstance } from "../lib/instance";
import { SettingsDialog } from "./SettingsDialog";

beforeAll(() => {
  // jsdom has no <dialog> modal support.
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});
afterEach(() => {
  cleanup();
  setInstance({ mode: "public" });
});

function OpenSettings() {
  const { setSettingsOpen } = useSync();
  useEffect(() => setSettingsOpen(true), [setSettingsOpen]);
  return null;
}
const renderDialog = () =>
  render(
    <ToastProvider>
      <SyncProvider>
        <OpenSettings />
        <SettingsDialog />
      </SyncProvider>
    </ToastProvider>,
  );

describe("SettingsDialog", () => {
  it("asks for a username on the public site", async () => {
    renderDialog();
    expect(await screen.findByPlaceholderText("octocat")).toBeTruthy();
    expect(screen.queryByText("Server sync")).toBeNull();
  });

  it("shows the server's account, sync status and token problems when self-hosted", async () => {
    setInstance({ mode: "self-hosted", login: "octo", avatarUrl: null, shareBaseUrl: null, tokenOk: false, tokenError: "GitHub rejected the token" });
    renderDialog();
    expect(await screen.findByText("octo")).toBeTruthy();
    expect(screen.getByText("self-hosted")).toBeTruthy();
    expect(screen.queryByPlaceholderText("octocat")).toBeNull();
    expect(screen.getByText("Server sync")).toBeTruthy();
    expect(screen.getByRole("button", { name: /sync now/i })).toBeTruthy();
    expect(screen.getByText(/GitHub rejected the token/)).toBeTruthy();
  });
});
