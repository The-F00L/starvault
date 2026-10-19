import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { fetchLists, fetchStarred, fetchUser } from "../lib/api";
import { db, getSettings, saveSettings } from "../lib/db";
import { getInstance } from "../lib/instance";
import { applyListsSync, applySync, assertStarSyncAllowed } from "../lib/sync";
import { useToast } from "./Toast";

interface SyncState {
  running: boolean;
  fetched: number;
  error: string | null;
  sync: () => Promise<void>;
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
}

const Ctx = createContext<SyncState | null>(null);

export function SyncProvider({ children }: { children: ReactNode }) {
  const [running, setRunning] = useState(false);
  const [fetched, setFetched] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { notify } = useToast();

  const sync = useCallback(async () => {
    const { username } = await getSettings();
    if (!username) {
      setSettingsOpen(true);
      return;
    }
    setRunning(true);
    setFetched(0);
    setError(null);
    try {
      assertStarSyncAllowed(getInstance());
      const user = await fetchUser(username);
      await saveSettings({ username: user.login, avatarUrl: user.avatarUrl });
      const repos = await fetchStarred(user.login, setFetched);
      await applySync(db, repos);
      await saveSettings({ lastSyncedAt: new Date().toISOString() });
      try {
        const lists = await fetchLists(user.login);
        const { skipped } = await applyListsSync(db, lists);
        notify(
          `Synced ${repos.length} stars and ${lists.length} GitHub List${lists.length === 1 ? "" : "s"}` +
            (skipped ? ` (${skipped} list entr${skipped === 1 ? "y" : "ies"} for repos you haven't starred skipped)` : ""),
          "success",
        );
      } catch (e) {
        notify(`Synced ${repos.length} stars, but GitHub Lists couldn't be imported: ${e instanceof Error ? e.message : e}`, "error");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }, [notify]);

  return <Ctx.Provider value={{ running, fetched, error, sync, settingsOpen, setSettingsOpen }}>{children}</Ctx.Provider>;
}

export function useSync() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSync must be used inside SyncProvider");
  return ctx;
}
