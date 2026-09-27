// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../lib/db";
import { CollectionDialog } from "./CollectionDialog";

beforeAll(() => {
  // jsdom has no <dialog> modal support.
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});

beforeEach(async () => {
  await db.collections.clear();
});
afterEach(cleanup);

describe("CollectionDialog", () => {
  // Regression: `onSaved?.(await createCollection(...))` skipped the create call entirely when
  // no onSaved was passed (as on the Collections page), silently closing without saving.
  it("creates a collection when no onSaved callback is given", async () => {
    const onClose = vi.fn();
    render(<CollectionDialog open onClose={onClose} />);
    await userEvent.type(screen.getByPlaceholderText("AI & Machine Learning"), "My Tools");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect((await db.collections.toArray()).map((c) => c.name)).toEqual(["My Tools"]);
  });

  it("passes the created collection to onSaved", async () => {
    const onSaved = vi.fn();
    render(<CollectionDialog open onClose={() => {}} onSaved={onSaved} />);
    await userEvent.type(screen.getByPlaceholderText("AI & Machine Learning"), "Other");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ name: "Other" })));
    expect(await db.collections.count()).toBe(1);
  });

  it("keeps typed input when the edited collection object is refreshed by a live query", async () => {
    const c = { id: "c1", name: "Old", icon: "bolt", description: "", rules: [], createdAt: "", updatedAt: "" };
    const { rerender } = render(<CollectionDialog open onClose={() => {}} collection={c} />);
    const input = screen.getByDisplayValue("Old");
    await userEvent.clear(input);
    await userEvent.type(input, "New name");
    rerender(<CollectionDialog open onClose={() => {}} collection={{ ...c, updatedAt: "later" }} />);
    expect(screen.getByDisplayValue("New name")).toBeTruthy();
  });
});
