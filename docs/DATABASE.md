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

## Phase 2 tables (implemented — migration `0001_phase2_maps.sql`)

| Table | หน้าที่ | Key points |
| --- | --- | --- |
| `assets` | ไฟล์ที่อัปโหลด (map/token/portrait…) | `campaign_id` null = ไฟล์ส่วนตัว; `mime` (จาก magic bytes), `width/height`, `size_bytes`, `sha256`, `storage_key`, soft delete |
| `scenes` | แผนที่ / ฉาก | `background_asset_id` → assets, `width/height` px, `grid` JSONB (`GridSettings`), `fog_enabled`, `dm_notes`, `sort_order`, `version`, soft delete |
| `tokens` | token บนแผนที่ | `scene_id` + `campaign_id` (tenant), `character_id` (nullable), x/y (double), `size` (cells), `rotation`, `layer` enum, `shape` enum, สี, `hidden`, `locked`, `show_name`, `owner_ids uuid[]`, `version` |
| `fog_ops` | รูปหมอกตามลำดับ | `mode` (reveal/hide), `shape` JSONB (rect/circle/polygon), `seq` identity = ลำดับการ apply |

`campaigns.active_scene_id` = scene ที่ผู้เล่นเห็น (ไม่ใส่ FK เพื่อเลี่ยง cycle campaigns↔scenes; ตรวจใน service และ set null เมื่อ scene ถูกลบ)

Enums ใหม่: `asset_kind`, `token_layer`, `token_shape`, `fog_mode`

ข้อจำกัดที่บังคับใน service: ≤200 scenes/แคมเปญ, ≤500 tokens/scene, ≤2000 fog shapes/scene, scene 100–16384 px

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
| `map_layers` (custom), `map_objects`, `drawings` | 7 | ตอนนี้ layer เป็น enum บน token (map/objects/tokens/dm); custom layer + drawing tools มาภายหลัง |
| `scenes`, `scene_templates` | 7 | snapshot ของ map+tokens+music+notes; template export/import JSON พร้อม schemaVersion |
| `combats`, `combatants` | 4 | round/turn index, initiative, action economy JSONB, concentration |
| `undo_history` | 7 | append-only operation log ต่อ entity type (command pattern: do/undo payload) |
| `spells`, `items`, `homebrew_content` | 5–7 | SRD seed + user content; `source` และ licence field |
| `rulesets` (custom) | 5 | base_ruleset_id + overrides JSONB (ใช้ `buildHomebrewRuleset`) |
| `journals`, `handouts`, `random_tables` | 5 | visibility per entry + links (note ↔ map/character/item) |
| `map_templates` | 7 ✅ | AoE template ต่อ scene: shape enum (circle/cone/line/square), x/y (px), size/width (ft), angle (องศา), color, label, hidden, owner_id; สูงสุด 60 ต่อ scene |
| `scenes.music` (jsonb) | 7 ✅ | `{kind: "playlist" \| "track", id}` — เริ่มเล่นเมื่อแสดงฉาก (migration `0005_phase7_spells_templates.sql`) |
| `audio_tracks`, `playlists`, `campaign_audio` | 6 ✅ | track: asset_id, category (music/ambient/sfx), tags, duration_sec; playlist: track_ids uuid[] + version; campaign_audio: สถานะการเล่นปัจจุบัน (jsonb, 1 แถวต่อแคมเปญ) |
| `session_recaps`, `timeline_events` | 7 | เชื่อม game_sessions; recap มีสถานะ draft/approved |

`permission` overrides ปัจจุบันเก็บใน `campaigns.settings.permissions` (ผ่าน `sanitizePermissionOverrides`)
ถ้าต้องการ permission ระดับ entity (เช่น token ทีละตัว) จะเพิ่มตาราง `entity_permissions` ใน Phase 2
