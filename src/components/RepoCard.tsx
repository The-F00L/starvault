import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { updateMeta } from "../lib/db";
import { compactNumber, relativeTime } from "../lib/format";
import type { Collection, Repo, RepoMeta } from "../lib/types";
import { AssignMenu } from "./AssignMenu";
import { Chip, cx, Icon, LanguageDot } from "./ui";

const iconButton = "p-1.5 rounded text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors";

export const repoPath = (r: Repo) => `/repo/${r.fullName}`;

function useCopy() {
  const [copied, setCopied] = useState(false);
  return {
    copied,
    copy: async (text: string) => {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    },
  };
}

function Badge({ repo }: { repo: Repo }) {
  return (
    <span
      className={cx(
        "px-1.5 py-0.5 rounded border font-mono text-[0.625rem] uppercase tracking-wider",
        repo.archived ? "border-error/40 text-error" : "border-surface-container-highest text-on-surface-variant",
      )}
    >
      {repo.archived ? "Archived" : repo.isPrivate ? "Private" : "Public"}
    </span>
  );
}

export function RepoCard({
  repo,
  meta,
  collections,
  onTag,
}: {
  repo: Repo;
  meta?: RepoMeta;
  collections: Collection[];
  onTag?: (tag: string) => void;
}) {
  const { copied, copy } = useCopy();
  const navigate = useNavigate();
  const tags = [...new Set([...(meta?.tags ?? []), ...repo.topics])].slice(0, 4);

  return (
    <article className="group flex flex-col gap-4 p-5 bg-surface-container-low border border-surface-container-highest rounded-lg hover:border-secondary/40 hover:shadow-[0_0_16px_rgba(227,179,65,0.08)] transition-all">
      <header className="flex items-start justify-between gap-2">
        <Link to={repoPath(repo)} className="flex items-baseline flex-wrap gap-x-1.5 gap-y-1 min-w-0">
          <span className="text-on-surface-variant truncate">{repo.owner}</span>
          <span className="text-on-surface-variant/50">/</span>
          <span className="text-headline-sm text-secondary group-hover:underline truncate">{repo.name}</span>
          <Badge repo={repo} />
        </Link>
        <div className="flex items-center shrink-0 -mr-1.5 -mt-1">
          <button
            type="button"
            className={cx(iconButton, meta?.pinned && "text-primary")}
            onClick={() => updateMeta(repo.fullName, { pinned: !meta?.pinned })}
            title={meta?.pinned ? "Unpin" : "Pin to Vanguard"}
          >
            <Icon name="keep" fill={meta?.pinned} className="text-[1.125rem]" />
          </button>
          <button type="button" className={iconButton} onClick={() => navigate(repoPath(repo))} title="Inspect">
            <Icon name="visibility" className="text-[1.125rem]" />
          </button>
          <AssignMenu
            fullName={repo.fullName}
            trigger={(toggle) => (
              <button type="button" className={iconButton} onClick={toggle} title="Assign to collection">
                <Icon name="bookmark_add" className="text-[1.125rem]" />
              </button>
            )}
          />
          <button type="button" className={iconButton} onClick={() => copy(`git clone ${repo.htmlUrl}.git`)} title="Copy clone command">
            <Icon name={copied ? "check" : "content_copy"} className={cx("text-[1.125rem]", copied && "text-success")} />
          </button>
        </div>
      </header>

      <p className="text-body-lg text-on-surface/90 line-clamp-2">{repo.description ?? <span className="italic text-on-surface-variant">No description</span>}</p>

      {meta?.note && (
        <div className="flex gap-2 px-3 py-2 bg-surface-container rounded font-mono text-code-sm">
          <Icon name="sticky_note_2" className="text-[1rem] text-primary shrink-0" />
          <p className="line-clamp-2">
            <span className="text-primary">Vault Note: </span>
            {meta.note}
          </p>
        </div>
      )}

      {(collections.length > 0 || tags.length > 0) && (
        <div className="flex flex-wrap gap-1.5">
          {collections.map((c) => (
            <Link key={c.id} to={`/collections/${c.id}`}>
              <Chip tone="primary">
                <Icon name={c.icon} className="text-[0.875rem]" />
                {c.name}
              </Chip>
            </Link>
          ))}
          {tags.map((t) => (
            <Chip key={t} onClick={onTag && (() => onTag(t))}>
              #{t}
            </Chip>
          ))}
        </div>
      )}

      <footer className="mt-auto flex items-center flex-wrap gap-x-4 gap-y-1 font-mono text-code-sm text-on-surface-variant">
        <span className="flex items-center gap-1 text-primary">
          <Icon name="star" fill className="text-[1rem]" />
          {compactNumber(repo.stars)}
        </span>
        <span className="flex items-center gap-1">
          <Icon name="fork_right" className="text-[1rem]" />
          {compactNumber(repo.forks)}
        </span>
        {repo.language && (
          <span className="flex items-center gap-1.5 text-on-surface">
            <LanguageDot language={repo.language} />
            {repo.language}
          </span>
        )}
        {repo.license && <span className="opacity-70">{repo.license}</span>}
        <span className="ml-auto flex items-center gap-1" title="Last push">
          <Icon name="schedule" className="text-[1rem]" />
          {relativeTime(repo.pushedAt)}
        </span>
      </footer>
    </article>
  );
}

export function RepoRow({ repo, meta }: { repo: Repo; meta?: RepoMeta }) {
  return (
    <Link
      to={repoPath(repo)}
      className="grid grid-cols-[1fr_auto] md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)_7rem_5rem_7rem] items-center gap-4 px-4 py-2.5 border-b border-surface-container-highest last:border-0 hover:bg-surface-container transition-colors"
    >
      <span className="flex items-center gap-1.5 min-w-0">
        {meta?.pinned && <Icon name="keep" fill className="text-[0.875rem] text-primary" />}
        <span className="text-on-surface-variant truncate">{repo.owner}/</span>
        <span className="text-secondary font-medium truncate">{repo.name}</span>
      </span>
      <span className="hidden md:block text-body-sm text-on-surface-variant truncate">{meta?.note || repo.description}</span>
      <span className="hidden md:flex items-center gap-1.5 font-mono text-code-sm truncate">
        {repo.language && <LanguageDot language={repo.language} />}
        {repo.language ?? "—"}
      </span>
      <span className="flex items-center gap-1 font-mono text-code-sm text-primary justify-end">
        <Icon name="star" fill className="text-[0.875rem]" />
        {compactNumber(repo.stars)}
      </span>
      <span className="hidden md:block font-mono text-code-sm text-on-surface-variant text-right">{relativeTime(repo.pushedAt)}</span>
    </Link>
  );
}
