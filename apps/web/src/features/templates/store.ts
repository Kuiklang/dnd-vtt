import { create } from "zustand";
import type { TemplateDto } from "../table/types";

/** What the template tool will place next (set from the toolbar or after casting a spell). */
export interface TemplatePreset {
  shape: TemplateDto["shape"];
  size: number;
  width: number;
  color: string;
  label: string;
}

export const DEFAULT_PRESET: TemplatePreset = { shape: "circle", size: 20, width: 5, color: "#e0603a", label: "" };

interface TemplateStore {
  preset: TemplatePreset;
  /** Bumped when something (e.g. a spell cast) asks the table to start placing a template. */
  request: number;
  setPreset(p: Partial<TemplatePreset>): void;
  place(p: TemplatePreset): void;
}

export const useTemplateStore = create<TemplateStore>((set) => ({
  preset: DEFAULT_PRESET,
  request: 0,
  setPreset: (p) => set((s) => ({ preset: { ...s.preset, ...p } })),
  place: (p) => set((s) => ({ preset: p, request: s.request + 1 })),
}));
