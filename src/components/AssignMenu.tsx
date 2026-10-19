import { useEffect, useRef, useState } from "react";
import { useToast } from "../hooks/Toast";
import { useCollections } from "../hooks/useVault";
import { setMembership } from "../lib/collections";
import { cx, GitHubListBadge, Icon } from "./ui";

/** Popover to toggle a repo's membership in collections. */
export function AssignMenu({ fullName, trigger, align = "right" }: { fullName: string; trigger: (toggle: () => void) => React.ReactNode; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const { attempt } = useToast();
  const ref = useRef<HTMLDivElement>(null);
  const { collections, membership } = useCollections();
  const mine = membership.get(fullName) ?? new Set<string>();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      {trigger(() => setOpen((o) => !o))}
      {open && (
        <div
          className={cx(
            "absolute z-20 mt-1 w-60 bg-surface-container-low border border-[#484f58] rounded-lg py-1 shadow-[0_16px_32px_rgba(1,4,9,0.85)]",
            align === "right" ? "right-0" : "left-0",
          )}
        >
          <p className="px-3 py-1.5 label-caps text-on-surface-variant">Assign to collections</p>
          {collections.length === 0 && <p className="px-3 py-2 text-body-sm text-on-surface-variant">Create a collection first.</p>}
          {collections.map((c) => {
            const checked = mine.has(c.id);
            const readOnly = !!c.githubListId;
            return (
              <button
                key={c.id}
                type="button"
                disabled={readOnly || pending !== null}
                title={readOnly ? "GitHub Lists are read-only here — edit on github.com" : undefined}
                onClick={async () => {
                  setPending(c.id);
                  await attempt(() => setMembership(c.id, fullName, !checked));
                  setPending(null);
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-body-sm hover:bg-surface-container-high disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span
                  className={cx(
                    "w-4 h-4 rounded-sm border flex items-center justify-center shrink-0",
                    checked ? "bg-accent border-accent text-white" : "bg-surface-container-lowest border-surface-container-highest",
                  )}
                >
                  {pending === c.id ? <Icon name="progress_activity" className="text-[0.75rem] animate-spin" /> : checked && <Icon name="check" className="text-[0.75rem]" />}
                </span>
                <Icon name={c.icon} className="text-[1rem] text-on-surface-variant" />
                <span className="truncate flex-1">{c.name}</span>
                {c.githubListId && <GitHubListBadge isPrivate={c.isPrivate} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
