import { forwardRef, useEffect, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { useToasts } from "../stores/toast";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "ghost" | "danger";

const variants: Record<Variant, string> = {
  primary: "bg-gold-500 text-ink-950 hover:bg-gold-400 shadow-[0_0_0_1px_rgba(0,0,0,0.4),0_6px_18px_-6px_rgba(195,154,51,0.6)]",
  secondary: "bg-ink-700 text-parchment-50 hover:bg-ink-600 border border-ink-600",
  ghost: "text-parchment-200 hover:bg-ink-700/60",
  danger: "bg-blood-700 text-parchment-50 hover:bg-blood-500",
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md"; loading?: boolean }
>(function Button({ variant = "secondary", size = "md", loading, className, children, disabled, ...rest }, ref) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-8 px-3 text-sm" : "h-10 px-4 text-sm",
        variants[variant],
        className,
      )}
      {...rest}
    >
      {loading && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  );
});

const fieldBase =
  "w-full rounded-md border border-ink-600 bg-ink-900/80 px-3 text-parchment-50 placeholder:text-parchment-500/60 focus:border-gold-500 focus:outline-none disabled:opacity-60";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} className={cx(fieldBase, "h-10", className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...rest },
  ref,
) {
  return <textarea ref={ref} className={cx(fieldBase, "min-h-24 py-2 leading-relaxed", className)} {...rest} />;
});

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(fieldBase, "h-10 pr-8", className)} {...rest}>
      {children}
    </select>
  );
}

export function Field({ label, hint, error, children, className }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode; className?: string }) {
  return (
    <label className={cx("block", className)}>
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-parchment-400">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-parchment-500">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-blood-400">{error}</span>}
    </label>
  );
}

export function Card({ children, className, title, actions, bodyClassName }: { children: ReactNode; className?: string; title?: ReactNode; actions?: ReactNode; bodyClassName?: string }) {
  return (
    <section className={cx("min-w-0 rounded-xl border border-ink-700 bg-ink-850/90 shadow-xl shadow-black/30", className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-ink-700 px-4 py-3">
          {title && <h2 className="text-sm font-bold uppercase tracking-widest text-gold-400">{title}</h2>}
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cx("p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cx("animate-spin", className ?? "h-5 w-5")} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-parchment-400" role="status">
      <Spinner /> {label}
    </div>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-blood-700 bg-blood-700/20 px-4 py-3 text-sm text-blood-400" role="alert">
      <span>{message}</span>
      {onRetry && (
        <Button size="sm" variant="ghost" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-ink-600 px-6 py-10 text-center">
      <p className="font-display text-lg text-parchment-50">{title}</p>
      {children && <p className="mx-auto mt-2 max-w-md text-sm text-parchment-400">{children}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function Badge({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "gold" | "green" | "red" | "blue" }) {
  const tones = {
    default: "bg-ink-700 text-parchment-200",
    gold: "bg-gold-500/15 text-gold-300 ring-1 ring-gold-500/30",
    green: "bg-moss-600/20 text-moss-400 ring-1 ring-moss-600/40",
    red: "bg-blood-700/30 text-blood-400 ring-1 ring-blood-700/50",
    blue: "bg-arcane-500/15 text-arcane-400 ring-1 ring-arcane-500/30",
  };
  return <span className={cx("inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide", tones[tone])}>{children}</span>;
}

export function Toaster() {
  const { toasts, dismiss } = useToasts();
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2" aria-live="polite">
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => dismiss(t.id)}
          className={cx(
            "pointer-events-auto rounded-md border px-4 py-3 text-left text-sm shadow-lg",
            t.kind === "success" && "border-moss-600 bg-ink-850 text-moss-400",
            t.kind === "error" && "border-blood-700 bg-ink-850 text-blood-400",
            t.kind === "info" && "border-ink-600 bg-ink-850 text-parchment-200",
          )}
        >
          {t.message}
        </button>
      ))}
    </div>
  );
}

const modalStack: object[] = [];

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  // Escape closes the dialog wherever focus is (not only inside it).
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    // Only the top-most dialog closes, so Escape in a nested picker keeps the sheet open.
    const token = {};
    modalStack.push(token);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && modalStack[modalStack.length - 1] === token && closeRef.current();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      modalStack.splice(modalStack.indexOf(token), 1);
    };
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/70 p-4 pt-16" onMouseDown={onClose} role="dialog" aria-modal aria-label={title}>
      <div
        className={cx("w-full rounded-xl border border-ink-600 bg-ink-850 shadow-2xl", wide ? "max-w-5xl" : "max-w-lg")}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-ink-700 px-5 py-3">
          <h2 className="text-lg text-parchment-50">{title}</h2>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
            ✕
          </Button>
        </header>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
