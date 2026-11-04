import { useState, type FormEvent } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { api, errorMessage } from "../lib/api";
import type { SelfUser } from "../lib/types";
import { useAuth } from "../stores/auth";
import { Button, Card, ErrorBanner, Field, Input, cx } from "../components/ui";

type Mode = "login" | "register" | "guest";

export function AuthPage() {
  const { user, setUser } = useAuth();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>(next.startsWith("/join/") ? "guest" : "login");
  const [form, setForm] = useState({ identifier: "", email: "", username: "", displayName: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (user) return <Navigate to={next} replace />;

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      let res: { user: SelfUser };
      if (mode === "login") res = await api.post("/api/auth/login", { identifier: form.identifier, password: form.password });
      else if (mode === "register")
        res = await api.post("/api/auth/register", {
          email: form.email,
          username: form.username,
          password: form.password,
          displayName: form.displayName || undefined,
        });
      else res = await api.post("/api/auth/guest", { displayName: form.displayName });
      setUser(res.user);
      navigate(next, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto grid max-w-5xl gap-10 px-4 py-14 md:grid-cols-2 md:items-center">
      <div>
        <h1 className="text-4xl font-bold leading-tight text-parchment-50">
          Everything you need to play D&amp;D, <span className="text-gold-400">in one place.</span>
        </h1>
        <p className="mt-4 text-parchment-400">
          Build characters, gather your party, roll dice together in real time, and run your campaign from a single table.
        </p>
        <ul className="mt-6 space-y-2 text-sm text-parchment-400">
          <li>⚔️ Character sheets with rules-accurate calculations (5e 2014 &amp; 2024)</li>
          <li>🎲 Server-verified dice with public, private, whisper and blind rolls</li>
          <li>🏰 Campaign lobby with invites, roles, presence and chat</li>
        </ul>
      </div>
      <Card>
        <div className="mb-5 grid grid-cols-3 gap-1 rounded-lg bg-ink-900 p-1 text-sm" role="tablist">
          {(["login", "register", "guest"] as const).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              onClick={() => {
                setMode(m);
                setError(null);
              }}
              className={cx("rounded-md py-2 font-medium", mode === m ? "bg-ink-700 text-gold-300" : "text-parchment-400 hover:text-parchment-200")}
            >
              {m === "login" ? "Sign in" : m === "register" ? "Create account" : "Play as guest"}
            </button>
          ))}
        </div>
        <form onSubmit={submit} className="space-y-4">
          {mode === "login" && (
            <>
              <Field label="Email or username">
                <Input autoComplete="username" required value={form.identifier} onChange={set("identifier")} />
              </Field>
              <Field label="Password">
                <Input type="password" autoComplete="current-password" required value={form.password} onChange={set("password")} />
              </Field>
            </>
          )}
          {mode === "register" && (
            <>
              <Field label="Email">
                <Input type="email" autoComplete="email" required value={form.email} onChange={set("email")} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Username" hint="3–24 letters, numbers, _ . -">
                  <Input autoComplete="username" required minLength={3} maxLength={24} value={form.username} onChange={set("username")} />
                </Field>
                <Field label="Display name">
                  <Input maxLength={40} value={form.displayName} onChange={set("displayName")} placeholder="Optional" />
                </Field>
              </div>
              <Field label="Password" hint="At least 8 characters">
                <Input type="password" autoComplete="new-password" required minLength={8} value={form.password} onChange={set("password")} />
              </Field>
            </>
          )}
          {mode === "guest" && (
            <>
              <Field label="Your name at the table" hint="Guest accounts last 7 days, can join campaigns and keep up to 5 characters. You can upgrade to a full account later.">
                <Input required maxLength={40} value={form.displayName} onChange={set("displayName")} />
              </Field>
            </>
          )}
          {error && <ErrorBanner message={error} />}
          <Button variant="primary" type="submit" className="w-full" loading={busy}>
            {mode === "login" ? "Sign in" : mode === "register" ? "Create account" : "Continue as guest"}
          </Button>
          <p className="text-center text-xs text-parchment-500">Google sign-in is planned and not available yet.</p>
        </form>
      </Card>
    </div>
  );
}

/** Only allow same-site relative redirects after login. */
function safeNext(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/";
  return next;
}
