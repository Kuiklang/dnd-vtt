import { useState, type FormEvent } from "react";
import { api, errorMessage } from "../lib/api";
import type { SelfUser } from "../lib/types";
import { useAsync } from "../lib/useAsync";
import { useAuth } from "../stores/auth";
import { toast } from "../stores/toast";
import { Button, Card, ErrorBanner, Field, Input, Loading } from "../components/ui";

export function ProfilePage() {
  const { user, setUser } = useAuth();
  if (!user) return null;
  return (
    <div className="mx-auto grid max-w-5xl gap-6 px-4 py-8 lg:grid-cols-2">
      <ProfileCard user={user} onSaved={setUser} />
      {user.isGuest ? <UpgradeCard onSaved={setUser} /> : <PasswordCard />}
      <PreferencesCard user={user} onSaved={setUser} />
      <SessionsCard />
    </div>
  );
}

function ProfileCard({ user, onSaved }: { user: SelfUser; onSaved: (u: SelfUser) => void }) {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl ?? "");
  const [busy, setBusy] = useState(false);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api.patch<{ user: SelfUser }>("/api/me", { displayName, avatarUrl: avatarUrl || null });
      onSaved(res.user);
      toast.success("Profile saved");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Profile">
      <form onSubmit={save} className="space-y-4">
        <Field label="Username">
          <Input value={user.username} disabled />
        </Field>
        {user.email && (
          <Field label="Email">
            <Input value={user.email} disabled />
          </Field>
        )}
        <Field label="Display name">
          <Input required maxLength={40} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </Field>
        <Field label="Avatar URL" hint="An https:// image link. Image upload arrives with asset storage (Phase 2).">
          <Input type="url" value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} placeholder="https://…" />
        </Field>
        <Button type="submit" variant="primary" loading={busy}>
          Save profile
        </Button>
      </form>
    </Card>
  );
}

function PreferencesCard({ user, onSaved }: { user: SelfUser; onSaved: (u: SelfUser) => void }) {
  const update = async (settings: SelfUser["settings"]) => {
    try {
      const res = await api.patch<{ user: SelfUser }>("/api/me", { settings });
      onSaved(res.user);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  return (
    <Card title="Preferences">
      <div className="space-y-3 text-sm">
        <label className="flex items-center justify-between gap-4">
          <span>Dice roll animation</span>
          <input type="checkbox" className="h-4 w-4 accent-gold-500" checked={user.settings.diceAnimation ?? true} onChange={(e) => update({ diceAnimation: e.target.checked })} />
        </label>
        <label className="flex items-center justify-between gap-4">
          <span>Dice sound</span>
          <input type="checkbox" className="h-4 w-4 accent-gold-500" checked={user.settings.diceSound ?? true} onChange={(e) => update({ diceSound: e.target.checked })} />
        </label>
      </div>
    </Card>
  );
}

function PasswordCard() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/me/password", { currentPassword: current, newPassword: next });
      setCurrent("");
      setNext("");
      toast.success("Password changed. Other devices were signed out.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Change password">
      <form onSubmit={save} className="space-y-4">
        <Field label="Current password">
          <Input type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
        <Field label="New password" hint="At least 8 characters">
          <Input type="password" autoComplete="new-password" minLength={8} required value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
        {error && <ErrorBanner message={error} />}
        <Button type="submit" loading={busy}>
          Change password
        </Button>
      </form>
    </Card>
  );
}

function UpgradeCard({ onSaved }: { onSaved: (u: SelfUser) => void }) {
  const [form, setForm] = useState({ email: "", username: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ user: SelfUser }>("/api/me/upgrade", form);
      onSaved(res.user);
      toast.success("Account upgraded — your characters and campaigns are kept.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Keep your account">
      <p className="mb-4 text-sm text-parchment-400">Guest accounts expire. Add an email and password to keep everything and create campaigns.</p>
      <form onSubmit={save} className="space-y-4">
        <Field label="Email">
          <Input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <Field label="Username">
          <Input required minLength={3} maxLength={24} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
        </Field>
        <Field label="Password">
          <Input type="password" required minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </Field>
        {error && <ErrorBanner message={error} />}
        <Button type="submit" variant="primary" loading={busy}>
          Upgrade account
        </Button>
      </form>
    </Card>
  );
}

interface SessionRow {
  id: string;
  userAgent: string | null;
  createdAt: string;
  lastUsedAt: string;
  current: boolean;
}

function SessionsCard() {
  const sessions = useAsync(() => api.get<{ sessions: SessionRow[] }>("/api/me/sessions").then((r) => r.sessions), []);
  const revokeOthers = async () => {
    await api.post("/api/me/sessions/revoke-others").catch((e) => toast.error(errorMessage(e)));
    void sessions.reload();
  };
  const revoke = async (id: string) => {
    await api.del(`/api/me/sessions/${id}`).catch((e) => toast.error(errorMessage(e)));
    void sessions.reload();
  };
  return (
    <Card title="Signed-in devices" actions={<Button size="sm" variant="ghost" onClick={revokeOthers}>Sign out others</Button>}>
      {sessions.loading ? (
        <Loading />
      ) : sessions.error ? (
        <ErrorBanner message={sessions.error} onRetry={sessions.reload} />
      ) : (
        <ul className="divide-y divide-ink-700 text-sm">
          {sessions.data?.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="truncate">{describeAgent(s.userAgent)}</p>
                <p className="text-xs text-parchment-500">Last active {new Date(s.lastUsedAt).toLocaleString()}</p>
              </div>
              {s.current ? (
                <span className="text-xs text-moss-400">This device</span>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => revoke(s.id)}>
                  Sign out
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function describeAgent(ua: string | null): string {
  if (!ua) return "Unknown device";
  const browser = /Firefox/.test(ua) ? "Firefox" : /Edg\//.test(ua) ? "Edge" : /Chrome/.test(ua) ? "Chrome" : /Safari/.test(ua) ? "Safari" : "Browser";
  const os = /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "macOS" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Linux/.test(ua) ? "Linux" : "";
  return [browser, os].filter(Boolean).join(" on ");
}
