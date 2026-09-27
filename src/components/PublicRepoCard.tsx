import { Link } from "react-router";
import { compactNumber } from "../lib/format";
import { Icon, LanguageDot } from "./ui";

/** Read-only card for repos shown on public profiles and shared collections (may not be in the viewer's vault). */
export function PublicRepoCard({
  fullName,
  description,
  language,
  stars,
  inVault,
}: {
  fullName: string;
  description: string | null;
  language: string | null;
  stars: number | null;
  inVault?: boolean;
}) {
  const [owner, name] = fullName.split("/");
  const body = (
    <>
      <p className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate">
          <span className="text-on-surface-variant">{owner}/</span>
          <span className="text-secondary font-medium">{name}</span>
        </span>
        {stars !== null && (
          <span className="flex items-center gap-1 font-mono text-code-sm text-primary shrink-0">
            <Icon name="star" fill className="text-[0.875rem]" />
            {compactNumber(stars)}
          </span>
        )}
      </p>
      <p className="text-body-sm text-on-surface-variant line-clamp-2 min-h-[2.25rem]">{description ?? "No description"}</p>
      <p className="flex items-center justify-between font-mono text-code-sm">
        <span className="flex items-center gap-1.5">
          {language && <LanguageDot language={language} />}
          {language ?? "—"}
        </span>
        {inVault ? (
          <span className="text-success flex items-center gap-1">
            <Icon name="check_circle" className="text-[0.875rem]" /> in your vault
          </span>
        ) : (
          <span className="text-on-surface-variant flex items-center gap-1">
            github <Icon name="open_in_new" className="text-[0.875rem]" />
          </span>
        )}
      </p>
    </>
  );
  const className = "flex flex-col gap-2 p-4 bg-surface-container-low border border-surface-container-highest rounded-lg hover:border-secondary/40 transition-colors";
  return inVault ? (
    <Link to={`/repo/${fullName}`} className={className}>
      {body}
    </Link>
  ) : (
    <a href={`https://github.com/${fullName}`} target="_blank" rel="noreferrer" className={className}>
      {body}
    </a>
  );
}
