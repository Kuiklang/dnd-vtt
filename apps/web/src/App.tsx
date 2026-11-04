import { Suspense, lazy, useEffect, type ReactNode } from "react";
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "./stores/auth";
import { Button, Loading, Toaster } from "./components/ui";
import { AuthPage } from "./pages/AuthPage";
import { DashboardPage } from "./pages/DashboardPage";
import { CreateCampaignPage } from "./pages/CreateCampaignPage";
import { JoinPage } from "./pages/JoinPage";
import { LobbyPage } from "./features/lobby/LobbyPage";
import { CharacterPage } from "./features/character/CharacterPage";
import { ProfilePage } from "./pages/ProfilePage";
// The table pulls in the canvas engine; load it only when a player opens the map.
const TablePage = lazy(() => import("./features/table/TablePage").then((m) => ({ default: m.TablePage })));
const ImportSheetPage = lazy(() => import("./features/character/ImportSheetPage").then((m) => ({ default: m.ImportSheetPage })));
const CreateCharacterPage = lazy(() => import("./features/character/CreateCharacterPage").then((m) => ({ default: m.CreateCharacterPage })));
import { LANGS, useLang, useT } from "./i18n";

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, status } = useAuth();
  const location = useLocation();
  if (status === "loading") return <Loading />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return <>{children}</>;
}

function LanguageSwitch() {
  const { lang, setLang } = useLang();
  const t = useT();
  return (
    <select
      aria-label={t("lang.label")}
      value={lang}
      onChange={(e) => setLang(e.target.value as typeof lang)}
      className="h-8 rounded border border-ink-700 bg-ink-900 px-1 text-xs text-parchment-200"
      data-testid="lang-switch"
    >
      {LANGS.map((l) => (
        <option key={l.id} value={l.id}>
          {l.label}
        </option>
      ))}
    </select>
  );
}

function TopBar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const t = useT();
  return (
    <header className="sticky top-0 z-30 border-b border-ink-700/80 bg-ink-950/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
        <Link to="/" className="flex items-center gap-2">
          <span className="text-xl" aria-hidden>
            🎲
          </span>
          <span className="whitespace-nowrap font-display text-lg font-bold text-gold-400">Arcane Table</span>
        </Link>
        {user && (
          <nav className="flex items-center gap-1 text-sm">
            <Link to="/" className="hidden rounded px-3 py-1.5 hover:bg-ink-800 sm:inline">
              {t("nav.campaigns")}
            </Link>
            <Link to="/profile" className="flex items-center gap-2 rounded px-3 py-1.5 hover:bg-ink-800">
              {user.avatarUrl ? (
                <img src={user.avatarUrl} alt="" className="h-6 w-6 rounded-full object-cover" referrerPolicy="no-referrer" />
              ) : (
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-ink-700 text-xs">{user.displayName[0]?.toUpperCase()}</span>
              )}
              <span className="hidden max-w-40 truncate sm:inline">{user.displayName}</span>
              {user.isGuest && <span className="hidden text-xs text-parchment-500 sm:inline">{t("nav.guest")}</span>}
            </Link>
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                await logout();
                navigate("/login");
              }}
            >
              {t("nav.logout")}
            </Button>
            <LanguageSwitch />
          </nav>
        )}
        {!user && <LanguageSwitch />}
      </div>
    </header>
  );
}

export function App() {
  const load = useAuth((s) => s.load);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <BrowserRouter>
      <div className="flex min-h-full flex-col">
        <TopBar />
        <main className="flex-1">
          <Routes>
            <Route path="/login" element={<AuthPage />} />
            <Route path="/join/:code" element={<RequireAuth><JoinPage /></RequireAuth>} />
            <Route path="/" element={<RequireAuth><DashboardPage /></RequireAuth>} />
            <Route path="/campaigns/new" element={<RequireAuth><CreateCampaignPage /></RequireAuth>} />
            <Route path="/campaigns/:id" element={<RequireAuth><LobbyPage /></RequireAuth>} />
            <Route path="/campaigns/:id/table" element={<RequireAuth><Suspense fallback={<Loading />}><TablePage /></Suspense></RequireAuth>} />
            <Route path="/characters/new" element={<RequireAuth><Suspense fallback={<Loading />}><CreateCharacterPage /></Suspense></RequireAuth>} />
            <Route path="/characters/import" element={<RequireAuth><Suspense fallback={<Loading />}><ImportSheetPage /></Suspense></RequireAuth>} />
            <Route path="/characters/:id" element={<RequireAuth><CharacterPage /></RequireAuth>} />
            <Route path="/profile" element={<RequireAuth><ProfilePage /></RequireAuth>} />
            <Route path="*" element={<div className="p-10 text-center text-parchment-400">Page not found. <Link className="text-gold-400 underline" to="/">Go home</Link></div>} />
          </Routes>
        </main>
        <Toaster />
      </div>
    </BrowserRouter>
  );
}
