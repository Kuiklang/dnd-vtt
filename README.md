# Arcane Table — D&D Virtual Tabletop

> Everything you need to play D&D, in one place.

แพลตฟอร์ม Virtual Tabletop สำหรับ Dungeons & Dragons ที่รวมเครื่องมือของ DM และผู้เล่นไว้ในเว็บเดียว
(ชื่อ "Arcane Table" เป็นชื่อชั่วคราว เปลี่ยนได้ภายหลัง)

## สถานะปัจจุบัน: Phase 1 ✅ · Phase 2 (Core VTT) ✅

ความคืบหน้าละเอียด: [PROJECT_PLAN.md](PROJECT_PLAN.md) · งานที่เหลือ: [TODO.md](TODO.md)

| ระบบ | สถานะ |
| --- | --- |
| Rules Engine (5e 2014 / 5e 2024 / Homebrew overrides) | ✅ ใช้งานได้ + unit tests |
| Dice parser/roller (safe, ไม่มี `eval`) | ✅ ใช้งานได้ + unit tests |
| Auth: Register / Login / Logout / Guest / Upgrade guest / Profile / Sessions | ✅ |
| Campaign: สร้าง / แก้ไข / ลบ / Public · Invite only · Private / Password / Max players | ✅ |
| Invitation link + code (role, จำนวนครั้ง, วันหมดอายุ, revoke) | ✅ |
| Roles & Permissions (Owner, DM, Co-DM, Player, Spectator + per-campaign overrides) | ✅ ตรวจที่ server |
| Lobby realtime: presence (online/reconnecting/offline), ready, chat ทุก channel, dice | ✅ Socket.IO |
| Game session: start / pause / resume / end + history | ✅ |
| Character: library, sheet ครบ, คำนวณอัตโนมัติ, overrides, autosave, optimistic locking, duplicate, JSON import/export | ✅ |
| Google login | ⏳ ยังไม่ทำ (ต้องมี OAuth credentials) — UI แจ้งชัดเจน |
| Character import จาก PDF/รูป (Claude API, ตรวจทุก field ก่อนบันทึก) | ✅ ต้องตั้ง `ANTHROPIC_API_KEY` ที่ server |
| Character creator แบบมีขั้นตอน (5e 2014, SRD 5.1) + ทอยจาก token + dice animation | ✅ Phase 3 |
| อัปโหลดรูป (map/token) — ตรวจชนิดไฟล์จริง, จำกัดขนาด, เสิร์ฟเฉพาะสมาชิก | ✅ |
| แผนที่: grid square/hex/none, pan/zoom, หลายแผนที่ + active scene, ทำสำเนา, DM notes | ✅ Konva |
| Token: วาง/ลาก/snap, ซ่อน/ล็อก/layer/ผู้ควบคุม, sync realtime ต่อผู้รับ | ✅ |
| Fog of War แบบ manual (rect/circle/polygon, กรอง token ที่ server) + วัดระยะตาม ruleset | ✅ |
| UI ไทย / อังกฤษ | ✅ framework + หน้าโต๊ะ, หน้าอื่นกำลังแปล |
| Combat: initiative, turns/rounds, HP/damage/resistances, conditions, action economy | ✅ Phase 4 |
| Music / DM Toolkit / Dynamic lighting | ⏳ Phase 5–8 (ดู [docs/ROADMAP.md](docs/ROADMAP.md)) |

## Tech stack

- **Monorepo** (pnpm workspaces): `packages/rules`, `apps/server`, `apps/web`
- **Frontend:** React 19 + TypeScript + Vite + Tailwind CSS v4 + Zustand + React Router + react-konva
- **Backend:** Node 22 + Fastify 5 + Socket.IO 4 + Zod
- **Database:** PostgreSQL 16 + Drizzle ORM (SQL migrations ใน `apps/server/drizzle`)
- **Tests:** Vitest (unit + integration กับ Postgres จริง) + Playwright E2E

## เริ่มต้นใช้งาน (development)

ต้องมี Node ≥ 22, pnpm ≥ 10 และ PostgreSQL ≥ 14

```bash
pnpm install
createdb vtt && createdb vtt_test          # หรือสร้างผ่าน psql
cp apps/server/.env.example apps/server/.env   # แก้ DATABASE_URL ให้ตรงเครื่อง
pnpm db:migrate
pnpm dev            # server :3001 + web :5173 (Vite proxy /api และ /socket.io)
```

เปิด http://localhost:5173

### Production (process เดียว)

```bash
pnpm --filter @vtt/web build
cd apps/server
WEB_DIST=../web/dist WEB_ORIGIN=https://your.domain COOKIE_SECURE=true NODE_ENV=production pnpm start
```

ไฟล์ที่อัปโหลดเก็บที่ `UPLOAD_DIR` (ค่าเริ่มต้น `apps/server/data/uploads`)

server จะรัน migration อัตโนมัติตอนเริ่ม และเสิร์ฟหน้าเว็บ + API + WebSocket จาก origin เดียวกัน

## การทดสอบ

```bash
pnpm test           # rules (115) + server integration (40, ต้องมี DB vtt_test) + web (6)
pnpm typecheck

# E2E (DM + ผู้เล่น 2 browser context): build web, รัน server ตามด้านบนที่พอร์ต 3001 แล้ว
BASE_URL=http://localhost:3001 SHOTS=/tmp/shots node e2e/phase1.e2e.cjs
BASE_URL=http://localhost:3001 SHOTS=/tmp/shots node e2e/phase2.e2e.cjs   # map/token/fog, DM + ผู้เล่น
BASE_URL=http://localhost:3001 SHOTS=/tmp/shots node e2e/phase3.e2e.cjs   # import ชีต + character creator
BASE_URL=http://localhost:3001 SHOTS=/tmp/shots node e2e/phase4.e2e.cjs   # combat + dice animation
```

`TEST_DATABASE_URL` ใช้กำหนด DB สำหรับ integration test (ค่าเริ่มต้น `postgres://postgres@localhost:5432/vtt_test` — **ถูกล้างทุกครั้งที่รัน**)

## เอกสาร

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — สถาปัตยกรรม, module structure, realtime, security
- [docs/DATABASE.md](docs/DATABASE.md) — schema ปัจจุบันและ entity ที่วางแผนไว้
- [docs/ROADMAP.md](docs/ROADMAP.md) — roadmap ทุก phase, MVP, สถานะ
- [docs/RISKS.md](docs/RISKS.md) — technical risks และแนวทางรับมือ
- [docs/DECISIONS.md](docs/DECISIONS.md) — บันทึกการตัดสินใจ (ADR แบบย่อ)

## ลิขสิทธิ์เนื้อหา

ข้อมูลกฎที่อยู่ในระบบจำกัดเฉพาะ SRD 5.1 / SRD 5.2 (CC-BY-4.0) และคำอธิบายสั้นที่เขียนเองโดยโปรเจกต์นี้
ไม่มีเนื้อหาจากหนังสือที่มีลิขสิทธิ์ ผู้ใช้เพิ่มเนื้อหาของตัวเองได้ผ่าน Homebrew
