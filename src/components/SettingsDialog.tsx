import { useEffect, useRef, useState } from "react";
import { useSync } from "../hooks/SyncContext";
import { useSettings } from "../hooks/useVault";
import { db, exportVault, importVault, saveSettings } from "../lib/db";
import { LOGIN } from "../lib/github";
import { Button, Field, Icon, inputClass, Modal } from "./ui";

export const profileShareUrl = (username: string) => `${location.origin}/u/${encodeURIComponent(username)}`;

export function SettingsDialog() {
  const { settingsOpen, setSettingsOpen, sync } = useSync();
  const settings = useSettings();
  const [username, setUsername] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (settingsOpen) {
      setUsername(settings.username);
      setMessage(null);
    }
  }, [settingsOpen, settings.username]);

  const close = () => setSettingsOpen(false);
  const trimmed = username.trim().replace(/^@/, "");
  const valid = LOGIN.test(trimmed);

  async function saveAndSync() {
    await saveSettings({ username: trimmed });
    close();
    await sync();
  }

  async function downloadBackup() {
    const data = await exportVault();
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    Object.assign(document.createElement("a"), { href: url, download: `starvault-backup-${data.exportedAt.slice(0, 10)}.json` }).click();
    URL.revokeObjectURL(url);
  }

  async function restoreBackup(file: File) {
    try {
      await importVault(JSON.parse(await file.text()));
      setMessage("Backup restored.");
    } catch (e) {
      setMessage(`Restore failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  async function resetVault() {
    await db.delete();
    location.reload();
  }

  return (
    <Modal
      open={settingsOpen}
      onClose={close}
      title="Your GitHub account"
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" icon="sync" onClick={saveAndSync} disabled={!valid}>
            Save &amp; sync
          </Button>
        </>
      }
    >
      <Field
        label="GitHub username"
        hint="StarVault only reads public data — your public stars and public GitHub Lists. No password or token needed, ever."
      >
        <input className={inputClass} value={username} onChange={(e) => setUsername(e.target.value)} placeholder="octocat" autoComplete="off" autoFocus />
      </Field>
      {settings.lastSyncedAt === null && <p className="text-body-sm text-primary">The first sync replaces the demo vault with your stars.</p>}
      {settings.username && settings.lastSyncedAt && (
        <div className="flex items-center gap-2 p-3 rounded bg-surface-container">
          <Icon name="share" className="text-secondary" />
          <span className="flex-1 min-w-0 font-mono text-code-sm truncate">{profileShareUrl(settings.username)}</span>
          <Button
            icon={copied ? "check" : "content_copy"}
            onClick={async () => {
              await navigator.clipboard.writeText(profileShareUrl(settings.username));
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? "Copied" : "Copy profile link"}
          </Button>
        </div>
      )}
      <p className="text-body-sm text-on-surface-variant">
        Notes, tags and your own collections stay in this browser. GitHub Lists are imported read-only — edit them on github.com and sync again.
      </p>
      <div className="border-t border-surface-container-highest pt-4 flex flex-wrap gap-2">
        <Button icon="download" onClick={downloadBackup}>
          Export backup
        </Button>
        <Button icon="upload" onClick={() => fileRef.current?.click()}>
          Import backup
        </Button>
        <Button variant="danger" icon="delete_forever" onClick={resetVault}>
          Reset vault
        </Button>
        <input ref={fileRef} type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && restoreBackup(e.target.files[0])} />
      </div>
      {message && <p className="text-body-sm text-secondary">{message}</p>}
    </Modal>
  );
}
