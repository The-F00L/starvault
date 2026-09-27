import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { cx, Icon } from "../components/ui";

type Tone = "error" | "success" | "info";
interface Toast {
  id: number;
  message: string;
  tone: Tone;
}

interface ToastApi {
  notify: (message: string, tone?: Tone) => void;
  /** Run an async action and surface any failure as an error toast. Resolves to false on failure. */
  attempt: (action: () => Promise<unknown>, success?: string) => Promise<boolean>;
}

const Ctx = createContext<ToastApi | null>(null);
let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const notify = useCallback((message: string, tone: Tone = "info") => {
    const id = nextId++;
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "error" ? 8000 : 3500);
  }, []);

  const attempt = useCallback(
    async (action: () => Promise<unknown>, success?: string) => {
      try {
        await action();
        if (success) notify(success, "success");
        return true;
      } catch (e) {
        notify(e instanceof Error ? e.message : String(e), "error");
        return false;
      }
    },
    [notify],
  );

  return (
    <Ctx.Provider value={{ notify, attempt }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cx(
              "flex items-start gap-2 px-3 py-2.5 rounded-lg border shadow-[0_16px_32px_rgba(1,4,9,0.85)] bg-surface-container-low text-body-sm",
              t.tone === "error" ? "border-error/50" : t.tone === "success" ? "border-success/50" : "border-[#484f58]",
            )}
          >
            <Icon
              name={t.tone === "error" ? "error" : t.tone === "success" ? "check_circle" : "info"}
              className={cx("text-[1.125rem] shrink-0", t.tone === "error" ? "text-error" : t.tone === "success" ? "text-success" : "text-secondary")}
            />
            <span className="flex-1">{t.message}</span>
            <button type="button" aria-label="Dismiss" onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))} className="text-on-surface-variant hover:text-on-surface">
              <Icon name="close" className="text-[1rem]" />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}
