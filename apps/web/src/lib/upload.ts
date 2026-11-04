import { ApiError } from "./api";
import type { AssetDto } from "../features/table/types";

export const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp,image/gif";

/** Uploads an image through the server's multipart endpoint (server validates type/size). */
export async function uploadImage(file: File, kind: "map" | "token" | "portrait" | "handout", campaignId: string | null): Promise<AssetDto> {
  const form = new FormData();
  form.append("kind", kind);
  if (campaignId) form.append("campaignId", campaignId);
  form.append("file", file);
  let res: Response;
  try {
    res = await fetch("/api/assets", { method: "POST", body: form, credentials: "same-origin" });
  } catch {
    throw new ApiError(0, "offline", "Can't reach the server. Check your connection.");
  }
  const json = (await res.json().catch(() => null)) as { asset?: AssetDto; error?: { code?: string; message?: string } } | null;
  if (!res.ok || !json?.asset) {
    throw new ApiError(res.status, json?.error?.code ?? "error", json?.error?.message ?? `Upload failed (${res.status})`);
  }
  return json.asset;
}

/** Posts fields + one file as multipart and returns the JSON body (errors become ApiError). */
export async function postMultipart<T>(url: string, fields: Record<string, string>, file: File): Promise<T> {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  form.append("file", file);
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", body: form, credentials: "same-origin" });
  } catch {
    throw new ApiError(0, "offline", "Can't reach the server. Check your connection.");
  }
  const json = (await res.json().catch(() => null)) as (T & { error?: { code?: string; message?: string } }) | null;
  if (!res.ok || !json) throw new ApiError(res.status, json?.error?.code ?? "error", json?.error?.message ?? `Request failed (${res.status})`);
  return json;
}
