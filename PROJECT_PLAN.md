# PROJECT PLAN — Arcane Table (D&D Virtual Tabletop)

> Everything you need to play D&D, in one place.
> เอกสารนี้คือบันทึกความคืบหน้าหลักของโปรเจกต์ อัปเดตทุกครั้งที่จบงานแต่ละช่วง
> รายการงานย่อยและสถานะจริงอยู่ใน [TODO.md](TODO.md) · รายละเอียดเชิงเทคนิคอยู่ใน [docs/](docs/)

ปรับปรุงล่าสุด: **2026-11-04** · สถานะ: **Phase 1 ✅ · Phase 2 ✅ · ถัดไป Phase 4 (Combat) เพื่อปิด MVP**

---

## 1. สรุป Architecture

| ชั้น | เทคโนโลยี | หมายเหตุ |
| --- | --- | --- |
| Monorepo | pnpm workspaces | `packages/rules`, `apps/server`, `apps/web` |
| Rules Engine | TypeScript ล้วน (`@vtt/rules`) | dice parser (ไม่มี eval), ruleset 5e 2014/2024 เป็น data, character derive, permissions, map geometry/fog/token visibility; ใช้ร่วม client+server |
| Backend | Node 22 + Fastify 5 + Socket.IO 4 + Zod | server-authoritative, ตรวจสิทธิ์ทุก request/event, payload realtime สร้างต่อผู้รับ |
| Database | PostgreSQL 16 + Drizzle ORM | migration เป็น SQL (`apps/server/drizzle/`) |
| Storage | `Storage` interface → LocalDiskStorage | สลับเป็น S3/R2 ได้ภายหลัง |
| Frontend | React 19 + Vite + Tailwind 4 + Zustand + react-konva | หน้าโต๊ะ lazy-load; i18n ไทย/อังกฤษ |
| Tests | Vitest (unit + integration กับ Postgres จริง) + Playwright E2E | |

แผนภาพและ module structure: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · ฐานข้อมูล: [docs/DATABASE.md](docs/DATABASE.md)

### การตัดสินใจที่ผู้ใช้อนุมัติ (2026-11-04)

1. โค้ดจะอยู่บน GitHub repo `dnd-vtt` (รอผู้ใช้สร้าง) — ระหว่างนี้ส่งเป็น git bundle ใน Project Files
2. Stack: monorepo, Vite + React, Fastify + Socket.IO, PostgreSQL *(แผนเดิมระบุ Prisma — โค้ด Phase 1 ใช้ Drizzle; รอผู้ใช้ยืนยันว่าจะคง Drizzle)*
3. Auth เขียนเอง (session cookie) + Guest; Google Login ทีหลัง (ต้องมี OAuth credentials)
4. Ruleset แรก 5e 2014 (SRD 5.1) และมี 5e 2024 (SRD 5.2) แล้ว
5. MVP = Phase 1–4
6. Dev แบบ local, storage ผ่าน interface, ตัดสินใจ hosting ตอนใกล้ MVP
7. UI ไทย + อังกฤษ (ศัพท์เกมคงอังกฤษ)
8. Map renderer = Konva

บันทึกการตัดสินใจทั้งหมด: [docs/DECISIONS.md](docs/DECISIONS.md)

---

## 2. MVP (Minimum Playable Table)

กลุ่มหนึ่งเล่นจริงได้ 1 session โดยไม่ต้องเปิดเว็บอื่น

| # | ความสามารถ | สถานะ |
| --- | --- | --- |
| 1 | บัญชี + guest, สร้างแคมเปญ, เชิญด้วย link/code, roles | ✅ Phase 1 |
| 2 | Character sheet 5e คำนวณถูกต้อง + ทอยจาก sheet | ✅ Phase 1 |
| 3 | Lobby realtime: presence, chat, dice 5 แบบการมองเห็น | ✅ Phase 1 |
| 4 | Map: อัปโหลด, grid square/hex, token ลาก/snap sync ทุกคน | ✅ Phase 2 |
| 5 | Manual Fog of War (กรองที่ server) | ✅ Phase 2 |
| 6 | Initiative tracker + HP/damage/conditions บน token | ⏳ Phase 4 (ถัดไป) |

---

## 3. แผนการพัฒนา (Roadmap)

| Phase | เนื้อหา | สถานะ |
| --- | --- | --- |
| 1 Foundation | setup, auth, campaign, lobby, DB, roles, character system | ✅ เสร็จ |
| 2 Core VTT | asset upload, map canvas, grid, token, fog, realtime sync, save status, reconnect | ✅ เสร็จ |
| 4 Combat *(ทำก่อน 3 เพื่อปิด MVP)* | combat mode, initiative, turn/round, HP/damage/healing บน token, conditions, combat HUD | ⏭ ถัดไป |
| 3 Character & Dice | character creator wizard, dice animation, character import (PDF/รูป), token↔character HP sync, ability checks จาก token | |
| 5 DM Toolkit | NPC/Monster library, encounter builder, journal, handouts, DM screen, random tables | |
| 6 Music | audio upload, playlist, ambient, realtime sync | |
| 7 Advanced | spells/AoE, inventory, scene templates, undo/redo, session recap, timeline, drawing tools, custom layers | |
| 8 Advanced features | dynamic lighting & vision, voice chat, AI DM assistant | |
| 9 Polish | UI polish, performance, security review, docs | |

รายละเอียดแต่ละ phase: [docs/ROADMAP.md](docs/ROADMAP.md) · ความเสี่ยง: [docs/RISKS.md](docs/RISKS.md)

---

## 4. บันทึกความคืบหน้า

### 2026-11-04 — Phase 1: Foundation ✅

ส่งมอบโดยอีก thread ของโปรเจกต์ (รายละเอียดใน docs/ROADMAP.md) — ตรวจซ้ำในรอบนี้: typecheck ผ่าน, test 130 ตัวผ่าน, E2E Phase 1 ผ่าน

### 2026-11-04 — Phase 2: Core VTT ✅

**สิ่งที่ใช้งานได้จริง**

- **อัปโหลดรูป** (`POST /api/assets`, multipart): map / token / portrait; ตรวจชนิดไฟล์จาก magic bytes (PNG/JPEG/WEBP/GIF, ไม่รับ SVG),
  จำกัดขนาดต่อชนิด (map 25MB, ภาพ ≤16384px), อ่านขนาดภาพ, เสิร์ฟผ่าน `/api/assets/:id` เฉพาะสมาชิกแคมเปญ
- **แผนที่ (scenes)**: สร้างจากรูป (ขนาด scene = ขนาดรูปอัตโนมัติ) หรือ grid เปล่า, เปลี่ยนชื่อ, ตั้งค่า grid (square/hex/none,
  ขนาดช่อง, offset, สี, ความทึบ, ระยะต่อช่อง + หน่วย), เปลี่ยนรูปพื้นหลัง, ทำสำเนา (รวม token + หมอก), ลบ, DM notes (ผู้เล่นไม่ได้รับ),
  optimistic versioning (409 เมื่อแก้ชนกัน)
- **Active scene**: DM กด "Show to players" → ผู้เล่นทุกคนย้ายไปแผนที่นั้นทันที, DM เตรียมแผนที่อื่นได้โดยผู้เล่นไม่เห็น
- **Canvas (Konva)**: pan (ลาก/Space/เครื่องมือมือ), zoom ด้วยล้อเมาส์รอบเคอร์เซอร์, fit to screen, grid วาดเฉพาะส่วนที่มองเห็น
- **Token**: DM เพิ่ม token เปล่าหรือ token ของตัวละครในปาร์ตี้, แก้ชื่อ/ขนาด/layer/รูปทรง/สี/ขอบ/การหมุน/รูป, ซ่อน, ล็อก, แสดงชื่อ,
  กำหนดผู้ควบคุม, ลบ; ผู้เล่นวาง token ตัวละครของตัวเองได้ 1 ตัวต่อแผนที่; ลากแล้ว snap กับ grid (ขนาดคู่ snap ที่จุดตัด)
- **Realtime sync**: ทุกการเปลี่ยนแปลง token/หมอก/แผนที่ ส่งถึงทุก client ทันที, payload คำนวณต่อผู้รับ;
  token move แบบ optimistic + rollback เมื่อ server ปฏิเสธ + version กัน broadcast เก่า
- **Fog of War (manual)**: เปิด/ปิด, เปิดหมอกด้วยสี่เหลี่ยม/วงกลม/รูปหลายเหลี่ยม, ปิดหมอกด้วยรูปเดียวกัน, ปิดทั้งหมด/เปิดทั้งหมด,
  ย้อนรูปล่าสุด; token ที่อยู่ในหมอกไม่ถูกส่งให้ผู้เล่น (ยกเว้น token ที่ตัวเองควบคุม); DM เห็นหมอกแบบโปร่งแสง
- **วัดระยะ**: หลายจุด, snap กลางช่อง, คำนวณตาม ruleset (5e: แนวทแยงช่องละ 5 ft; รองรับ 5-10-5 และ euclidean; hex นับช่อง)
- **Save status + reconnect**: แสดง "กำลังบันทึก / บันทึกแล้ว / บันทึกไม่สำเร็จ / ออฟไลน์"; ทุกการกระทำบันทึกลง DB ทันที;
  reconnect/reload โหลด state ล่าสุด ไม่มี token ซ้ำหรือหาย
- **i18n ไทย/อังกฤษ**: ตัวสลับภาษาใน top bar, ค่าเริ่มต้นตามภาษาของ browser; ครอบคลุม top bar + หน้าโต๊ะทั้งหมด
- **Keyboard**: V เลือก, R วัดระยะ, F เครื่องมือหมอก (DM), Space ค้างเพื่อ pan, Delete ลบ token (DM), Esc ยกเลิก — ไม่ทำงานขณะพิมพ์

**การทดสอบ (รันจริงทั้งหมด)**

| ชุด | ผล |
| --- | --- |
| `packages/rules` unit (เพิ่ม map geometry/fog/token 19 ตัว) | 115/115 ✅ |
| `apps/server` integration กับ Postgres จริง (เพิ่ม assets/scenes/tokens/fog 9 ตัว) | 40/40 ✅ |
| `apps/web` unit (เพิ่ม i18n 3 ตัว) | 6/6 ✅ |
| E2E Phase 2 (`e2e/phase2.e2e.cjs`): DM + ผู้เล่น (UI ไทย) — upload map, เพิ่ม/แก้ token, ผู้เล่นวางและลาก token + snap, ผู้เล่นลาก token คนอื่นไม่ได้, token ซ่อนหายจากผู้เล่น, fog ซ่อน/เปิดพื้นที่, วัดระยะ 20 ft, เปลี่ยน grid, reload ไม่ซ้ำ, ย้ายผู้เล่นไปแผนที่ใหม่, mobile ไม่ล้นจอ, ไม่มี console error | ✅ |
| E2E Phase 1 (regression) | ✅ |
| `pnpm typecheck` ทั้ง 3 package | ✅ |

**Error ที่พบระหว่างทดสอบและแก้แล้ว**

1. ผู้เล่นมองไม่เห็น token ของตัวเองเมื่อเปิดหมอก (หมอกวาดทับ) → วาดหมอกใต้ token layer สำหรับผู้เล่น (server กรอง token ให้แล้ว)
2. ช่อง "เปิดใช้หมอก" ไม่เปลี่ยนทันทีหลังคลิก (รอ server) → optimistic toggle + rollback
3. CSP error ใน console ทุกหน้า (Zod probe `new Function`) — มีมาตั้งแต่ Phase 1 → ตั้ง Zod `jitless` ก่อนสร้าง schema
4. Bundle หลักใหญ่เกิน → lazy-load หน้าโต๊ะ (Konva แยก chunk)
5. หน้าโต๊ะบนมือถือ panel ทับกันจนมองไม่เห็นแผนที่ → panel เริ่มแบบปิดบนจอแคบ และเปิดได้ทีละข้าง

**ข้อจำกัดที่ยังมี (ระบุชัดใน UI/เอกสาร)**

- Dynamic lighting / vision ยังไม่มี (Phase 8) — UI แจ้งว่าหมอกเป็นแบบควบคุมเอง
- รูปแผนที่ส่งทั้งภาพให้ผู้เล่น (ผู้เล่นที่เปิด devtools อาจเห็นส่วนที่ยังอยู่ในหมอก) — ดู RISKS #4
- ระหว่างลาก token คนอื่นจะเห็นตำแหน่งใหม่เมื่อปล่อยเมาส์ (ยังไม่ stream ตำแหน่งระหว่างลาก)
- ยังไม่มี pinch-zoom บนมือถือ, undo/redo ของ token (Phase 7), drawing tools และ custom layers (Phase 7)
- หน้าเดิมของ Phase 1 (dashboard, lobby, character sheet) ยังเป็นภาษาอังกฤษ — แปลต่อใน TODO

---

## 5. วิธีรันและทดสอบ

ดู [README.md](README.md) — สรุป:

```bash
pnpm install
createdb vtt && createdb vtt_test
cp apps/server/.env.example apps/server/.env
pnpm db:migrate && pnpm dev                    # http://localhost:5173
TEST_DATABASE_URL=postgres://… pnpm test       # unit + integration
pnpm --filter @vtt/web build && (cd apps/server && WEB_DIST=../web/dist WEB_ORIGIN=http://localhost:3001 pnpm start)
BASE_URL=http://localhost:3001 node e2e/phase1.e2e.cjs && BASE_URL=http://localhost:3001 node e2e/phase2.e2e.cjs
```
