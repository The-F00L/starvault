import { useLiveQuery } from "dexie-react-hooks";
import { useSyncExternalStore } from "react";
import { db, DEFAULT_SYNC_STATE } from "../lib/db";
import { getInstance, subscribeInstance } from "../lib/instance";

export const useInstance = () => useSyncExternalStore(subscribeInstance, getInstance);

const NO_COUNTS = { pending: 0, rejected: 0 };

/** Self-hosted sync status for Settings. */
export function useRemoteStatus() {
  const state = useLiveQuery(() => db.syncState.get("main"), []) ?? DEFAULT_SYNC_STATE;
  const counts =
    useLiveQuery(async () => {
      const all = await db.outbox.toArray();
      const rejected = all.filter((e) => e.rejected).length;
      return { pending: all.length - rejected, rejected };
    }, []) ?? NO_COUNTS;
  return { ...state, ...counts };
}
