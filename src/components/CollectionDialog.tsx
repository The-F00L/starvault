import { useEffect, useRef, useState } from "react";
import { createCollection, updateCollection } from "../lib/collections";
import type { Collection } from "../lib/types";
import { Button, cx, Field, Icon, inputClass, Modal } from "./ui";

const ICONS = ["neurology", "palette", "terminal", "cloud", "database", "speed", "build", "security", "science", "sports_esports", "code", "bolt", "format_list_bulleted"];

export function CollectionDialog({
  open,
  onClose,
  collection,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  collection?: Collection;
  onSaved?: (c: Collection) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState(ICONS[0]);
  const [rules, setRules] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const linked = !!collection?.githubListId;

  // Initialise the form only when the dialog opens. `collection` comes from a live query and gets a new
  // identity on every IndexedDB write, so depending on it would wipe what the user is typing.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      setName(collection?.name ?? "");
      setDescription(collection?.description ?? "");
      setIcon(collection?.icon ?? ICONS[0]);
      setRules(collection?.rules.join(", ") ?? "");
      setError(null);
      setSaving(false);
    }
    wasOpen.current = open;
  }, [open, collection]);

  async function save() {
    const parsedRules = rules
      .split(",")
      .map((r) => r.trim().toLowerCase())
      .filter(Boolean);
    setSaving(true);
    setError(null);
    try {
      if (collection) {
        const patch = linked ? { icon, rules: parsedRules } : { name: name.trim(), description: description.trim(), icon, rules: parsedRules };
        await updateCollection(collection, patch);
        onSaved?.({ ...collection, ...patch });
      } else {
        // Not `onSaved?.(await createCollection(...))`: optional-call short-circuits its arguments,
        // so without an onSaved callback the collection was never created.
        const created = await createCollection({ name: name.trim(), description: description.trim(), icon, rules: parsedRules });
        onSaved?.(created);
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={collection ? "Edit collection" : "New collection"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={!name.trim() || saving}>
            {saving ? "Saving…" : collection ? "Save" : "Create"}
          </Button>
        </>
      }
    >
      {linked && (
        <p className="flex items-start gap-2 p-2 rounded bg-surface-container text-on-surface-variant text-body-sm">
          <Icon name="cloud_sync" className="text-[1rem] shrink-0" />
          This collection mirrors a GitHub List. Its name, description and repositories come from GitHub (edit them on github.com); the icon and auto-tag rules are
          yours to change.
        </p>
      )}
      <Field label="Name">
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="AI & Machine Learning" autoFocus disabled={linked} />
      </Field>
      <Field label="Description">
        <textarea
          className={cx(inputClass, "h-20 py-2 resize-none")}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What belongs here?"
          disabled={linked}
        />
      </Field>
      <Field label="Icon">
        <div className="flex flex-wrap gap-1.5">
          {ICONS.map((i) => (
            <button
              key={i}
              type="button"
              onClick={() => setIcon(i)}
              aria-label={i}
              className={cx(
                "w-9 h-9 rounded flex items-center justify-center border transition-colors",
                icon === i ? "border-primary text-primary bg-primary/10" : "border-surface-container-highest text-on-surface-variant hover:text-on-surface",
              )}
            >
              <Icon name={i} />
            </button>
          ))}
        </div>
      </Field>
      <Field label="Auto-tag rules" hint="Comma-separated topics or languages used to suggest repos for this collection.">
        <input className={inputClass} value={rules} onChange={(e) => setRules(e.target.value)} placeholder="llm, ai, inference" />
      </Field>
      {error && <p className="p-2 rounded bg-error-container/30 text-error font-mono text-code-sm">{error}</p>}
    </Modal>
  );
}
