# Database

PostgreSQL + Drizzle ORM. Schema: `apps/server/src/db/schema.ts`, migrations: `apps/server/drizzle/*.sql`
(สร้างด้วย `pnpm db:generate`, apply ด้วย `pnpm db:migrate` หรืออัตโนมัติเมื่อ server เริ่ม)

## Conventions

- PK เป็น UUID (`gen_random_uuid()`), เวลาเป็น `timestamptz`
- Soft delete ด้วย `deleted_at` สำหรับเนื้อหาของผู้ใช้ (campaigns, characters, chat_messages)
- ทุกตารางที่อยู่ในแคมเปญมี `campaign_id` + FK + index (multi-tenant isolation) และทุก query กรองด้วย campaign_id
- JSONB ใช้เฉพาะเอกสารที่ยืดหยุ่นและผ่าน schema validation แล้ว (character sheet, roll breakdown, settings)
- Optimistic locking ด้วยคอลัมน์ `version` (characters, campaigns)
- Unique index แบบ case-insensitive บน `lower(email)` และ `lower(username)`

## Phase 1 tables (implemented)

| Table | หน้าที่ | Key points |
| --- | --- | --- |
| `users` | บัญชี (รวม guest) | `is_guest`, `guest_expires_at`, `settings` JSONB, `password_hash` (null สำหรับ guest) |
| `auth_sessions` | login sessions | เก็บ `token_hash` (SHA-256) ไม่เก็บ token จริง, `expires_at`, `revoked_at` |
| `campaigns` | แคมเปญ | `ruleset_id`, `privacy` enum, `password_hash`, `max_players`, `settings.permissions`, soft delete |
| `campaign_members` | สมาชิก + role | unique(campaign_id,user_id), `role` enum, `active_character_id` → characters |
| `campaign_invitations` | invite link/code | unique `code`, `role`, `max_uses`/`uses`, `expires_at`, `revoked_at` |
| `characters` | PC (library) / NPC / Monster | `campaign_id` null = library; `data` JSONB (validated), `player_visible`, `version`, soft delete |
| `game_sessions` | session ของการเล่น | partial unique index: เปิดได้ครั้งละ 1 session ต่อแคมเปญ; `number` ต่อเนื่อง |
| `dice_rolls` | ประวัติลูกเต๋า | `visibility` enum, `recipient_ids uuid[]`, `total`, `result` JSONB (ทุกลูก), `game_session_id` |
| `chat_messages` | แชท | `channel` enum (global/party/dm/whisper/system), `recipient_ids`, edit/soft delete |

Enums: `campaign_role`, `campaign_privacy`, `character_kind`, `chat_channel`, `roll_visibility`, `game_session_status`

### Integrity rules ที่บังคับใน DB

- ลบ user → cascade sessions/characters/memberships; ลบ campaign (hard) → cascade ทุกอย่างในแคมเปญ
- เจ้าของแคมเปญลบบัญชีไม่ได้จนกว่าจะโอน/ลบแคมเปญ (`owner_id ... on delete restrict`)
- ตัวละครถูกลบ → `active_character_id` ถูก set null
- การ join ล็อกแถว campaign (`SELECT … FOR UPDATE`) จึงไม่เกิน max players แม้ join พร้อมกัน
- การใช้ invite เพิ่ม `uses` แบบมีเงื่อนไขใน UPDATE เดียว (atomic)

## Planned entities (Phase 2+)

ออกแบบไว้ล่วงหน้าเพื่อให้ schema โตได้โดยไม่ต้องรื้อ:

| Entity | Phase | หมายเหตุ |
| --- | --- | --- |
| `assets` | 2 | ไฟล์ใน object storage (S3-compatible): owner, campaign, mime, size, sha256, status (scan) |
| `maps`, `map_layers`, `map_objects` | 2 | layer มี order/opacity/visibility; object มี geometry JSONB + layer_id |
| `tokens` | 2 | map_id, character_id (nullable), owner/controller, x/y/rotation/size, hidden, locked, appearance JSONB |
| `fog_regions` | 2 | polygon JSONB ต่อ map (reveal/hide) — **ไม่ส่งให้ client ที่ไม่มีสิทธิ์** |
| `scenes`, `scene_templates` | 7 | snapshot ของ map+tokens+music+notes; template export/import JSON พร้อม schemaVersion |
| `combats`, `combatants` | 4 | round/turn index, initiative, action economy JSONB, concentration |
| `undo_history` | 7 | append-only operation log ต่อ entity type (command pattern: do/undo payload) |
| `spells`, `items`, `homebrew_content` | 5–7 | SRD seed + user content; `source` และ licence field |
| `rulesets` (custom) | 5 | base_ruleset_id + overrides JSONB (ใช้ `buildHomebrewRuleset`) |
| `journals`, `handouts`, `random_tables` | 5 | visibility per entry + links (note ↔ map/character/item) |
| `audio_tracks`, `playlists` | 6 | asset_id, category (music/ambient/sfx), tags |
| `session_recaps`, `timeline_events` | 7 | เชื่อม game_sessions; recap มีสถานะ draft/approved |

`permission` overrides ปัจจุบันเก็บใน `campaigns.settings.permissions` (ผ่าน `sanitizePermissionOverrides`)
ถ้าต้องการ permission ระดับ entity (เช่น token ทีละตัว) จะเพิ่มตาราง `entity_permissions` ใน Phase 2
