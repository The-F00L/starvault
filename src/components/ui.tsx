import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { languageColor } from "../lib/languages";

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

export function Icon({ name, className, fill }: { name: string; className?: string; fill?: boolean }) {
  return (
    <span aria-hidden className={cx("material-symbols-outlined", fill && "icon-fill", className)}>
      {name}
    </span>
  );
}

export function LanguageDot({ language, className }: { language: string | null; className?: string }) {
  return <span className={cx("inline-block w-2 h-2 rounded-full shrink-0", className)} style={{ background: languageColor(language) }} />;
}

type Variant = "default" | "primary" | "accent" | "ghost" | "danger";

const VARIANTS: Record<Variant, string> = {
  default: "bg-surface-container hover:bg-surface-container-high text-on-surface border border-surface-container-highest",
  primary: "bg-primary-container hover:bg-primary text-on-primary font-semibold",
  accent: "bg-accent hover:bg-accent-hover text-white border border-white/10",
  ghost: "text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high",
  danger: "bg-error-container/40 hover:bg-error-container/70 text-error border border-error/30",
};

export function Button({
  variant = "default",
  icon,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; icon?: string }) {
  return (
    <button
      type="button"
      className={cx(
        "inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded font-mono text-code-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed",
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {icon && <Icon name={icon} className="text-[1rem]" />}
      {children}
    </button>
  );
}

export function Chip({
  children,
  onRemove,
  onClick,
  tone = "secondary",
  active,
}: {
  children: ReactNode;
  onRemove?: () => void;
  onClick?: () => void;
  tone?: "secondary" | "primary" | "neutral";
  active?: boolean;
}) {
  const toneClass = {
    secondary: "text-secondary",
    primary: "text-primary",
    neutral: "text-on-surface-variant",
  }[tone];
  const Tag = onClick ? "button" : "span";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cx(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface-container-high font-mono text-code-sm whitespace-nowrap",
        toneClass,
        onClick && "hover:bg-accent/20 transition-colors",
        active && "ring-1 ring-secondary",
      )}
    >
      {children}
      {onRemove && (
        <button type="button" aria-label="Remove" onClick={onRemove} className="hover:text-primary -mr-0.5">
          <Icon name="close" className="text-[0.875rem]" />
        </button>
      )}
    </Tag>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cx("bg-surface-container-low border border-surface-container-highest rounded-lg", className)}>{children}</section>;
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="m-auto w-[min(32rem,calc(100vw-2rem))] bg-surface-container-low text-on-surface border border-[#484f58] rounded-lg p-0 shadow-[0_16px_32px_rgba(1,4,9,0.85)] backdrop:bg-black/60"
    >
      {open && (
        <div className="flex flex-col">
          <header className="flex items-center justify-between px-5 py-4 border-b border-surface-container-highest">
            <h2 className="text-headline-sm">{title}</h2>
            <button type="button" onClick={onClose} aria-label="Close" className="text-on-surface-variant hover:text-on-surface">
              <Icon name="close" />
            </button>
          </header>
          <div className="px-5 py-4 flex flex-col gap-4">{children}</div>
          {footer && <footer className="px-5 py-3 border-t border-surface-container-highest flex justify-end gap-2">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="label-caps text-on-surface-variant">{label}</span>
      {children}
      {hint && <span className="text-body-sm text-on-surface-variant/70">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "w-full h-9 px-3 bg-surface-container-lowest border border-surface-container-highest rounded text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:border-secondary focus:shadow-[0_0_0_3px_rgba(88,166,255,0.2)] transition-colors";

export function EmptyState({ icon, title, children }: { icon: string; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center gap-3 py-16 px-6 border border-dashed border-surface-container-highest rounded-lg">
      <Icon name={icon} className="text-[2rem] text-primary" />
      <h3 className="text-headline-sm">{title}</h3>
      {children && <div className="text-on-surface-variant max-w-md">{children}</div>}
    </div>
  );
}

export function PageHeader({ eyebrow, title, children, actions }: { eyebrow: string; title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 mb-6">
      <div>
        <p className="label-caps text-primary flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-primary" />
          {eyebrow}
        </p>
        <h1 className="text-headline-xl-mobile lg:text-headline-xl font-bold tracking-tight mt-1">{title}</h1>
        {children && <p className="text-body-lg text-on-surface-variant mt-1 max-w-2xl">{children}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Marks a collection that mirrors a GitHub star List. */
export function GitHubListBadge({ isPrivate, className }: { isPrivate?: boolean; className?: string }) {
  return (
    <span
      title={isPrivate ? "Private GitHub List" : "GitHub List"}
      className={cx("inline-flex items-center gap-0.5 px-1 rounded border border-surface-container-highest font-mono text-[0.625rem] uppercase tracking-wider text-on-surface-variant", className)}
    >
      <Icon name={isPrivate ? "lock" : "cloud_sync"} className="text-[0.75rem]" />
      GH
    </span>
  );
}
