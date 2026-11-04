import { create } from "zustand";
import { api } from "../lib/api";
import type { SelfUser } from "../lib/types";

interface AuthState {
  user: SelfUser | null;
  status: "loading" | "ready";
  load(): Promise<void>;
  setUser(user: SelfUser | null): void;
  logout(): Promise<void>;
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  status: "loading",
  async load() {
    try {
      const { user } = await api.get<{ user: SelfUser | null }>("/api/auth/me");
      set({ user, status: "ready" });
    } catch {
      set({ user: null, status: "ready" });
    }
  },
  setUser(user) {
    set({ user });
  },
  async logout() {
    await api.post("/api/auth/logout").catch(() => undefined);
    set({ user: null });
  },
}));
