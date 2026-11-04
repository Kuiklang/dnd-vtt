import { z } from "zod";
import { badRequest } from "./errors.js";

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    const first = issues[0];
    throw badRequest(first ? `${first.path ? `${first.path}: ` : ""}${first.message}` : "Invalid input", issues);
  }
  return result.data;
}

export const idParams = z.object({ id: z.uuid() });

// Control characters except tab (09), newline (0A) and carriage return (0D).
const CONTROL_CHARS = new RegExp("[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]", "g");

/** Trimmed user text with control characters stripped. */
export const cleanText = (max: number) =>
  z
    .string()
    .max(max)
    .transform((s) => s.replace(CONTROL_CHARS, "").trim());

export const httpsUrl = z
  .string()
  .trim()
  .max(500)
  .url()
  .refine((u) => u.startsWith("https://"), "Must be an https:// URL");
