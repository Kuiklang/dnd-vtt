# Roadmap & MVP

## MVP (Minimum Playable Table)

MVP = สิ่งที่กลุ่มหนึ่งใช้เล่นจริงได้ 1 session โดยไม่ต้องเปิดเว็บอื่น:

1. ✅ บัญชี + guest, สร้างแคมเปญ, เชิญผู้เล่นด้วย link/code, roles
2. ✅ Character sheet 5e ที่คำนวณถูกต้อง + ทอยจาก sheet
3. ✅ Lobby realtime: presence, chat, dice (public/private/whisper/blind/DM-only)
4. ✅ Map canvas + upload map + grid + token (ลาก/วาง sync ทุกคน) — **Phase 2**
5. ✅ Manual Fog of War — **Phase 2**
6. ✅ Initiative tracker + HP/damage/conditions บน token — **Phase 4**

เมื่อครบ 1–6 ถือว่า MVP พร้อมทดลองเล่นจริง (alpha)

## Phases

| Phase | เนื้อหา | สถานะ |
| --- | --- | --- |
| 1 Foundation | project setup, auth, campaign, lobby, DB, basic UI, roles, character system | ✅ เสร็จ (ดูรายละเอียดด้านล่าง) |
| 2 Core VTT | map canvas (Konva), upload map (asset storage), token + placement, grid (square/hex), manual fog, multiplayer state sync, save system | ✅ เสร็จ (ดู PROJECT_PLAN.md) |
| 3 Character & Dice | character creator wizard, 3D/2D dice animation + sound, character import (PDF/image → OCR/AI → review), token linking, ability checks จาก token | ✅ เสร็จ (2D dice; import ผ่าน Claude API) |
| 4 Combat (ดึงมาก่อน Phase 3 เพื่อปิด MVP) | combat mode, initiative tracker, turn/round, HP/damage (resistance/vulnerability/immunity), healing, conditions + duration, combat HUD, action economy | ✅ |
| 5 DM Toolkit | NPC/Monster library (SRD), encounter builder, journal (Markdown), handouts, DM Screen (panels), random tables, custom rulesets UI | ✅ เสร็จ (ยกเว้น custom rulesets UI และระดับความยาก encounter) |
| 6 Music | audio upload, playlists, ambient layers, realtime sync (DM controls, player local volume) | ✅ เสร็จ (ยังไม่มี crossfade และเพลงประจำ scene) |
| 7 Advanced 🟡 | ✅ spell library + casting + AoE templates, inventory transfer, scene music · เหลือ: scene templates, undo/redo, session recap, timeline, drawing tools | รอบแรกเสร็จ 2026-11-04 |
| 8 Advanced features | dynamic lighting & vision, voice chat (WebRTC, optional), AI DM assistant | |
| 9 Polish | UI polish, performance, security review, docs, accessibility | |

## Phase 1 — สิ่งที่ส่งมอบ

- Monorepo + TypeScript strict + Vitest + Playwright E2E
- `@vtt/rules`: dice parser/roller, ruleset 5e 2014/2024, homebrew overrides, character schema v1 + derive, permissions, visibility
- Server: Fastify + Socket.IO + Postgres/Drizzle + migrations, auth (password/guest/upgrade/sessions), campaigns, invitations,
  members/roles/ownership transfer, game sessions, characters (access levels, optimistic locking, import/export JSON),
  chat (5 channels, edit/delete), dice (5 visibilities, persisted history)
- Web: login/register/guest, dashboard (created/joined/playing/played/public + character library + import), create campaign,
  join by link/code, lobby (party/presence/ready/character select/chat/dice/invites/settings/session control),
  full character sheet (abilities, saves, skills, combat, HP, conditions, attacks, spells, inventory, features, notes, overrides)
  พร้อม autosave + save status
- Tests: 96 rules unit, 31 server integration (Postgres จริง), 3 web unit, 1 E2E flow (DM + ผู้เล่น)

### สิ่งที่ตั้งใจยังไม่ทำใน Phase 1 (แสดงสถานะใน UI ชัดเจน)

- Google login (ต้องมี OAuth client) — ระบบ session รองรับการเพิ่ม provider แล้ว
- Upload รูป avatar/portrait/cover — ใช้ https URL ไปก่อน; asset storage มาพร้อม Phase 2
- Default map / default music ของแคมเปญ — รอ Phase 2 / 6
- NPC/Monster UI — ทำแล้วใน Phase 5 (bestiary + คัดลอกเข้าแคมเปญ)

## Phase 2 — แผนงานถัดไป (ลำดับที่แนะนำ)

1. Asset storage: S3-compatible (MinIO ใน dev) + signed upload URL, ตรวจ MIME/ขนาด/magic bytes, thumbnail
2. ตาราง maps / map_layers / tokens / fog_regions + migration
3. Canvas ด้วย PixiJS (WebGL): pan/zoom/fit, grid square/hex/none, culling สำหรับ token จำนวนมาก
4. Token: วาง/ลาก/snap/ล็อก/ซ่อน, ownership, optimistic move + server validation + broadcast
5. Manual fog (rect/circle/polygon reveal/hide) — ผู้เล่นได้รับเฉพาะส่วนที่เปิดแล้ว
6. Autosave + save status สำหรับ map, reconnect state recovery
7. Integration/E2E: วางแผนที่, วาง token, sync 2 client, reconnect ไม่ทำให้ token หาย

## Phase 2 — สิ่งที่ส่งมอบ (2026-11-04)

ดูรายละเอียดและสถานะจริงใน [PROJECT_PLAN.md](../PROJECT_PLAN.md) และ [TODO.md](../TODO.md)
