import { config } from "zod";

/**
 * In the browser our CSP forbids eval. Zod's object schemas probe `new Function` when
 * they are constructed (which happens at module load for this package's schemas), and
 * that probe logs a CSP violation. Turning on jitless skips the probe. It must run
 * before any schema module in this package evaluates, so index.ts imports it first.
 * On the server (no `document`) Zod keeps its faster JIT path.
 */
if (typeof (globalThis as { document?: unknown }).document !== "undefined") config({ jitless: true });
