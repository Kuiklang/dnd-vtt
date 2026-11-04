import type { StatBlockRef } from "../table/types";

export type JournalVisibility = "gm" | "all" | "selected" | "author";

export interface JournalEntry {
  id: string;
  campaignId: string;
  authorId: string | null;
  title: string;
  body: string;
  folder: string;
  visibility: JournalVisibility;
  sharedWith: string[];
  imageAssetId: string | null;
  imageUrl: string | null;
  pinned: boolean;
  version: number;
  canEdit: boolean;
  updatedAt: string;
}

export interface EncounterEntry {
  ref: StatBlockRef;
  name: string;
  count: number;
  xp: number;
}

export interface Encounter {
  id: string;
  name: string;
  notes: string;
  entries: EncounterEntry[];
  totalXp: number;
  version: number;
  updatedAt: string;
}

export interface RandomTableEntry {
  min: number;
  max: number;
  text: string;
}

export interface RandomTable {
  id: string;
  name: string;
  formula: string;
  entries: RandomTableEntry[];
  version: number;
}
