# Architecture

## ภาพรวม

```
┌──────────────────────────┐   HTTPS (REST, JSON)    ┌──────────────────────────────┐
│  apps/web (React SPA)    │ ──────────────────────▶ │  apps/server (Fastify)       │
│  - pages / features      │                         │  - auth / campaigns /        │
│  - Zustand stores        │ ◀────── WebSocket ────▶ │    characters / chat routes  │
│  - uses @vtt/rules for   │     (Socket.IO)         │  - Realtime (Socket.IO)      │
│    live sheet maths      │                         │  - Services (business logic) │
└──────────────────────────┘                         └──────────────┬───────────────┘
            ▲                                                       │ Drizzle ORM
            │ same TypeScript package                               ▼
┌──────────────────────────┐                         ┌──────────────────────────────┐
│ packages/rules           │ ◀── imported by both ──▶│  PostgreSQL                  │
│ dice · rulesets ·        │                         │  (migrations in              │
│ character schema/derive ·│                         │   apps/server/drizzle)       │
│ permissions · visibility │                         └──────────────────────────────┘
└──────────────────────────┘
```

หลักการสำคัญ:

1. **Rules Engine แยกจาก UI และ server** — `packages/rules` เป็น TypeScript ล้วน ไม่มี dependency กับ React/Fastify
   ใช้ร่วมกันทั้ง client (แสดงค่าทันทีขณะแก้ sheet) และ server (validate + roll ที่เชื่อถือได้)
2. **Server-authoritative** — ลูกเต๋าทุกลูกในแคมเปญทอยที่ server ด้วย `crypto.getRandomValues` (rejection sampling)
   สิทธิ์ทุกอย่างตรวจที่ server; client ใช้ permission module แค่เพื่อซ่อน/แสดงปุ่ม
3. **ข้อมูลลับไม่ออกจาก server** — chat / dice history ถูกกรองด้วย SQL ตาม viewer, broadcast realtime ถูกสร้าง payload
   แยกต่อผู้รับ (blind roll ส่งแบบ redacted ให้ผู้ทอย, DM-only ไม่ถูกส่งให้ผู้เล่นเลย)
4. **Ruleset เป็นข้อมูล (data) ไม่ใช่โค้ด** — `RulesetDefinition` เป็น JSON-serialisable ทำให้ homebrew ruleset เก็บใน DB ได้
   และการคำนวณจะไม่หยิบค่าจาก ruleset เวอร์ชันอื่นโดยอัตโนมัติ

## Module structure

```
packages/rules/src
├── rng.ts                 Rng interface: cryptoRng (default), sequenceRng / seededRng (tests)
├── dice/
│   ├── ast.ts             AST types + formatAst()
│   ├── parser.ts          recursive-descent parser + limits (no eval)
│   └── roller.ts          roll(), advantage/disadvantage, crit/fumble detection
├── rulesets/
│   ├── types.ts           RulesetDefinition (abilities, skills, conditions, PB table, movement, combat, exhaustion…)
│   ├── dnd5e.ts           DND5E_2014, DND5E_2024 (SRD data only)
│   └── registry.ts        builtin lookup + buildHomebrewRuleset() (validated overrides)
├── character/
│   ├── schema.ts          Zod schema of character data (versioned), migrateCharacterData(), export envelope
│   └── derive.ts          deriveCharacter() → modifiers, saves, skills, passive, DC, attacks, hit dice…; applyHpChange()
├── permissions.ts         roles → capabilities, per-campaign overrides, role hierarchy
├── visibility.ts          who sees which roll / chat message
└── map/
    ├── geometry.ts        grid settings (square/hex/none), snapToGrid, cellAt, cellDistance/pathDistance (ruleset diagonal rule)
    ├── fog.ts             manual fog model (ordered reveal/hide shapes), isPointRevealed, normalizeShape
    └── tokens.ts          TokenState, canSeeToken (hidden / DM layer / fog / ownership), canControlToken

apps/server/src
├── app.ts                 Fastify setup, security headers, Origin check, error handler, static SPA
├── config.ts              env (Zod)
├── context.ts             AppContext + request typing
├── db/                    schema.ts (Drizzle), client.ts, migrate.ts
├── lib/                   crypto (scrypt, tokens, invite codes), errors, validation helpers
├── auth/                  service.ts (sessions, guests, upgrade), routes.ts
├── campaigns/             service.ts (membership, invites, roles, sessions), routes.ts
├── characters/            service.ts (access rules, optimistic locking, import/export), routes.ts
├── chat/                  service.ts (chat + dice persistence & filtering), routes.ts (history + REST mirror)
├── assets/                storage.ts (Storage interface + LocalDiskStorage), service.ts (magic-byte sniffing, limits, access), routes.ts
├── scenes/                service.ts (scenes, tokens, fog, per-viewer state), routes.ts (scene REST + Zod schemas)
└── realtime/socket.ts     Socket.IO: auth, presence, rate limit, per-recipient broadcasts, scene rooms

apps/web/src
├── App.tsx                routes + auth guard + top bar + language switch (TablePage is lazy-loaded)
├── i18n/                  en.ts (keys), th.ts, translate()/useT()/useLang (localStorage)
├── lib/                   api client, socket client, shared types, useAsync
├── stores/                auth, toast (Zustand)
├── components/            ui primitives (Button, Card, Modal…), Avatar
├── pages/                 Auth, Dashboard, CreateCampaign, Join, Profile
└── features/
    ├── lobby/             LobbyPage, useLobby (socket state), Feed (chat+dice), DiceTray, RollCard, InvitePanel, settings
    ├── character/         CharacterPage, CharacterSheet (+ sections), CharacterSheetLoader (autosave/conflicts)
    └── table/             TablePage (layout, tools, shortcuts), useTable (scene socket state, optimistic tokens),
                           ScenePanel (maps + grid settings), TokenPanel (add/edit tokens),
                           canvas/MapCanvas (Konva stage: pan/zoom, grid, tokens, fog, ruler), TokenNode, draw.ts
```

กฎ: business logic อยู่ใน service / rules package, routes ทำแค่ validate + เรียก service, component ใหญ่ถูกแยกเป็น section

## Realtime

- Socket.IO บน HTTP server เดียวกับ Fastify (`/socket.io`) — auth ด้วย session cookie ตอน handshake
- `allowRequest` ตรวจ Origin ป้องกัน Cross-Site WebSocket Hijacking
- ห้อง: `campaign:{id}` (สมาชิกที่เปิด lobby) และ `user:{id}` (ทุก socket ของ user)
- Client → server events (ทุกตัวมี ack `{ok,data}|{ok:false,error}` และ validate ด้วย Zod):
  `campaign:join`, `campaign:leave`, `lobby:ready`, `chat:send`, `chat:edit`, `chat:delete`, `dice:roll`
- Server → client: `presence:update`, `chat:message`, `dice:roll`, `campaign:changed` (ให้ client refetch ผ่าน REST
  ที่ตรวจสิทธิ์แล้ว), `character:changed`, `campaign:removed`
- ตรวจ membership จาก DB ทุก event → เปลี่ยน role / kick มีผลทันที
- Presence เก็บใน memory: disconnect ไม่ตั้งใจ → `reconnecting` 10 วินาที แล้วจึง `offline` (ready state คงไว้ถ้ากลับมาทัน)
- Reconnect: client ส่ง `campaign:join` ใหม่ได้ snapshot (presence + history) แล้ว merge ตาม id จึงไม่มีข้อความซ้ำ
- Rate limit ต่อ socket (token bucket 60 burst / 15 ต่อวินาที)

### Scene (map) realtime — Phase 2

- ห้อง `scene:{id}`: client ส่ง `scene:join` ได้ state ที่กรองแล้วสำหรับตัวเอง (scene + tokens + fog ops)
  ผู้เล่นเข้าได้เฉพาะ active scene ของแคมเปญ; GM เปิดได้ทุก scene
- Client → server: `scene:join|leave`, `token:create|update|delete`, `fog:add|reset|undo|enable`
- Server → client: `token:upsert` / `token:remove` (คำนวณ**ต่อผู้รับ** ด้วย `canSeeToken` — token ที่ซ่อนหรืออยู่ในหมอกจะถูกส่ง
  เป็น `token:remove` ให้ผู้เล่นแทน), `scene:state` (หลังเปลี่ยนหมอก/ตั้งค่า), `scenes:changed`, `scene:activated`, `scene:deleted`
- เปลี่ยน active scene → socket ของผู้เล่นถูกเอาออกจากห้อง scene เก่า (ไม่ได้รับ update ของแผนที่ที่ตัวเองมองไม่เห็นอีก)
- Token move: optimistic บน client → server validate (สิทธิ์ + field ที่ owner แก้ได้คือ x/y/rotation) → บันทึก DB ทันที
  → broadcast พร้อม `version` เพิ่มขึ้น; client ทิ้ง broadcast ที่ version เก่ากว่า; ถ้า server ปฏิเสธ client rollback
- Reconnect: `useTable` join scene ใหม่ทุกครั้งที่ socket กลับมา → state ล่าสุดจาก DB ไม่ซ้ำ ไม่หาย

**Scale-out (อนาคต):** presence และ room อยู่ใน process เดียว เมื่อรันหลาย instance ให้ใช้ `@socket.io/redis-adapter` +
ย้าย presence ไป Redis (ดู RISKS.md)

## Security

| เรื่อง | การป้องกัน |
| --- | --- |
| Password | scrypt (N=16384,r=8,p=1) + salt, `timingSafeEqual`, dummy hash กัน user enumeration ทาง timing |
| Session | token 256-bit ใน cookie `HttpOnly; SameSite=Lax; Secure (prod)`, DB เก็บเฉพาะ SHA-256, revoke ได้, หมดอายุ |
| CSRF | SameSite=Lax + ตรวจ `Origin` ทุก request ที่ไม่ใช่ GET |
| Authorization | capability-based RBAC ตรวจใน service ทุกครั้ง, campaign ที่ไม่ได้เป็นสมาชิกตอบ 404 (ไม่ leak ว่ามีอยู่) |
| Input validation | Zod ทุก route/socket event, strip control chars, จำกัดความยาว, body limit |
| Dice parser | hand-written parser, จำกัดความยาว/จำนวนลูก/หน้า/ความลึก/explode, ไม่มี `eval` |
| XSS | React escape ทุกข้อความ, ไม่มี `dangerouslySetInnerHTML`, CSP header, URL รูปต้องเป็น `https://` |
| File upload | ตรวจชนิดจาก magic bytes (PNG/JPEG/WEBP/GIF เท่านั้น, ไม่รับ SVG), จำกัดขนาดต่อชนิด + ขนาดภาพ ≤16384px, storage key สร้างโดย server, เสิร์ฟพร้อม `nosniff` + ตรวจสมาชิกแคมเปญ (ตอบ 404) |
| Map secrets | token ที่ซ่อน / layer DM / อยู่ในหมอก ไม่ถูกส่งให้ผู้เล่น, `dmNotes` ส่งเฉพาะผู้มี `dmNotes.view`, scene ที่ไม่ active ผู้เล่นเปิดไม่ได้ |
| SQL injection | Drizzle parameterised queries ทั้งหมด |
| Rate limiting | `@fastify/rate-limit` 300/นาที global, 10/นาที สำหรับ auth, socket token bucket |
| DM-only data | กรองที่ SQL + payload ต่อผู้รับ, character access level (owner/edit/view/summary) |
| Headers | CSP, X-Frame-Options DENY, nosniff, Referrer-Policy |

## Character data model

ข้อมูล sheet เก็บเป็น JSONB ที่ผ่าน Zod schema (`characterDataSchema`) พร้อม `schemaVersion`
ค่าที่คำนวณได้ (modifier, save, skill, DC, ฯลฯ) **ไม่ถูกเก็บ** แต่คำนวณสดจาก ruleset ทุกครั้ง → ไม่มีค่าเก่าค้าง
ผู้ใช้/DM pin ค่าได้ผ่าน `overrides` และ UI แสดง tag `override` (แยก "ค่าคำนวณ" กับ "ค่าที่ผู้ใช้แก้")

การบันทึกใช้ optimistic concurrency (`version`) — ถ้ามีคนอื่นบันทึกก่อน จะได้ 409 และ UI แสดง "Changed elsewhere"
พร้อมเก็บ edit ที่ยังไม่บันทึกไว้ (ไม่หายเงียบ)
