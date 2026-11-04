import { useEffect, useState, type ReactNode } from "react";
import { cx } from "../../components/ui";

/** Integer input that only commits valid, clamped values (keeps typing smooth). */
export function NumberField({
  value,
  onChange,
  min,
  max,
  disabled,
  className,
  label,
}: {
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
  disabled?: boolean;
  className?: string;
  label: string;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = (t: string) => {
    const n = Number.parseInt(t, 10);
    if (Number.isNaN(n)) return setText(String(value));
    const clamped = Math.min(max, Math.max(min, n));
    setText(String(clamped));
    if (clamped !== value) onChange(clamped);
  };
  return (
    <input
      type="number"
      inputMode="numeric"
      aria-label={label}
      disabled={disabled}
      value={text}
      min={min}
      max={max}
      onChange={(e) => {
        setText(e.target.value);
        const n = Number.parseInt(e.target.value, 10);
        if (!Number.isNaN(n) && n >= min && n <= max) onChange(n);
      }}
      onBlur={(e) => commit(e.target.value)}
      className={cx(
        "w-full rounded border border-ink-600 bg-ink-900/80 px-2 py-1 text-center text-parchment-50 focus:border-gold-500 focus:outline-none disabled:border-transparent disabled:bg-transparent",
        className,
      )}
    />
  );
}

export function TextField({
  value,
  onChange,
  disabled,
  placeholder,
  className,
  label,
  maxLength = 100,
}: {
  value: string;
  onChange: (s: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  label: string;
  maxLength?: number;
}) {
  return (
    <input
      aria-label={label}
      disabled={disabled}
      value={value}
      maxLength={maxLength}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={cx(
        "w-full rounded border border-ink-600 bg-ink-900/80 px-2 py-1 text-parchment-50 placeholder:text-parchment-500/50 focus:border-gold-500 focus:outline-none disabled:border-transparent disabled:bg-transparent",
        className,
      )}
    />
  );
}

export function Section({ title, children, actions, className }: { title: string; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={cx("rounded-lg border border-ink-700 bg-ink-900/50 p-3", className)}>
      <header className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-xs font-bold uppercase tracking-widest text-gold-400">{title}</h3>
        {actions}
      </header>
      {children}
    </section>
  );
}

/** Small clickable modifier that rolls a d20 test. */
export function RollButton({ value, onRoll, title, className }: { value: string; onRoll?: () => void; title: string; className?: string }) {
  if (!onRoll) return <span className={cx("font-mono", className)}>{value}</span>;
  return (
    <button
      type="button"
      onClick={onRoll}
      title={title}
      className={cx("rounded px-1.5 font-mono text-parchment-50 hover:bg-gold-500/20 hover:text-gold-300", className)}
    >
      {value}
    </button>
  );
}

export function SourceTag({ source }: { source: "computed" | "override" }) {
  return source === "override" ? (
    <span className="ml-1 rounded bg-arcane-500/20 px-1 text-[9px] uppercase text-arcane-400" title="Manually overridden value">
      override
    </span>
  ) : null;
}
