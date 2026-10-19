import type { Change } from "../../server/protocol";

export interface Repo {
  id: number;
  /** GraphQL node ID (needed to edit GitHub Lists membership). Absent for demo repos. */
  nodeId?: string;
  fullName: string;
  owner: string;
  name: string;
  ownerAvatar: string;
  description: string | null;
  htmlUrl: string;
  homepage: string | null;
  language: string | null;
  topics: string[];
  stars: number;
  forks: number;
  watchers: number;
  openIssues: number;
  license: string | null;
  archived: boolean;
  fork: boolean;
  isPrivate: boolean;
  defaultBranch: string;
  createdAt: string;
  pushedAt: string;
  starredAt: string;
  source: "github" | "mock";
}

/** User-owned knowledge attached to a starred repo. */
export interface RepoMeta {
  fullName: string;
  note: string;
  tags: string[];
  pinned: boolean;
  /** Dismissed from the stale-stars audit. */
  keep?: boolean;
  updatedAt: string;
}

export interface Collection {
  id: string;
  name: string;
  icon: string;
  description: string;
  /** Topic/keyword rules used to suggest repos for this collection. */
  rules: string[];
  /** Set when this collection mirrors a GitHub star List (UserList node ID). */
  githubListId?: string | null;
  githubSlug?: string | null;
  isPrivate?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CollectionItem {
  collectionId: string;
  fullName: string;
  addedAt: string;
}

export interface Settings {
  key: "main";
  username: string;
  lastSyncedAt: string | null;
  avatarUrl: string | null;
}

export type Health = "active" | "maintained" | "stale" | "archived";

/** Icon and auto-tag rules: the only fields of a GitHub-List collection the user can edit. */
export interface ListOverride {
  icon: string;
  rules: string[];
}

/** A local change waiting to be pushed to the self-hosted server. */
export interface OutboxEntry extends Change {
  seq?: number;
  /** The server's error code when it refused this change. Kept aside (shown in Settings), never retried. */
  rejected?: string;
}

export interface SyncState {
  key: "main";
  /** Last server rev applied locally. */
  rev: number;
  lastPullAt: string | null;
  lastPushAt: string | null;
  lastError: string | null;
  firstSyncDone: boolean;
  /** The server database this device last synced with (PullPage.serverId). */
  serverId: string | null;
  /** List overrides pulled before this device imported the List; applyListsSync applies them. */
  pendingOverrides: Record<string, ListOverride>;
}
