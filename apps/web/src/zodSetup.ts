import { config } from "zod";

// Our CSP forbids eval; tell Zod not to probe for `new Function` (avoids a CSP console error).
// Imported first in main.tsx so it runs before any schema is created.
config({ jitless: true });
