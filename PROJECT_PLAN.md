# PROJECT PLAN — Arcane Table (D&D Virtual Tabletop)

> Everything you need to play D&D, in one place.
> เอกสารนี้คือบันทึกความคืบหน้าหลักของโปรเจกต์ อัปเดตทุกครั้งที่จบงานแต่ละช่วง
> รายการงานย่อยและสถานะจริงอยู่ใน [TODO.md](TODO.md) · รายละเอียดเชิงเทคนิคอยู่ใน [docs/](docs/)

ปรับปรุงล่าสุด: **2026-11-04** · สถานะ: **Phase 1 ✅ · Phase 2 ✅ · Phase 3 ✅ · Phase 4 ✅ · Phase 5 ✅ · Phase 6 ✅ → MVP ครบ · Phase 7 ✅ (เวท SRD + ร่ายเวท, AoE template, เพลงประจำฉาก, ส่งไอเทม, concentration, undo/redo, recap + timeline) · ถัดไป Phase 8**

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
2. Stack: monorepo, Vite + React, Fastify + Socket.IO, PostgreSQL + Drizzle *(แผนเดิมระบุ Prisma; ผู้ใช้ยืนยันให้คง Drizzle)*
3. Auth เขียนเอง (session cookie) + Guest; Google Login ทีหลัง (ต้องมี OAuth credentials)
4. Ruleset แรก 5e 2014 (SRD 5.1) และมี 5e 2024 (SRD 5.2) แล้ว
5. MVP = Phase 1–4
6. Dev แบบ local, storage ผ่าน interface, ตัดสินใจ hosting ตอนใกล้ MVP
7. UI ไทย + อังกฤษ (ศัพท์เกมคงอังกฤษ)
8. Map renderer = Konva
9. อ่านชีตตัวละครจาก PDF/รูปด้วย Claude API (key อยู่ที่ server, ผู้ใช้ตรวจทุก field ก่อนบันทึก)

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
| 6 | Initiative tracker + HP/damage/conditions บน token | ✅ Phase 4 |

---

## 3. แผนการพัฒนา (Roadmap)

| Phase | เนื้อหา | สถานะ |
| --- | --- | --- |
| 1 Foundation | setup, auth, campaign, lobby, DB, roles, character system | ✅ เสร็จ |
| 2 Core VTT | asset upload, map canvas, grid, token, fog, realtime sync, save status, reconnect | ✅ เสร็จ |
| 4 Combat *(ทำก่อน 3 เพื่อปิด MVP)* | combat mode, initiative, turn/round, HP/damage/healing บน token, conditions, combat HUD | ✅ เสร็จ |
| 3 Character & Dice | character creator wizard, dice animation, character import (PDF/รูป), ability checks จาก token *(token↔character HP sync ทำแล้วใน Phase 4)* | ✅ เสร็จ |
| 5 DM Toolkit | NPC/Monster library, encounter builder, journal, handouts, DM screen, random tables | ✅ เสร็จ |
| 6 Music | audio upload, playlist, ambient, realtime sync | ✅ เสร็จ |
| 7 Advanced | spells/AoE, ส่งไอเทม, เพลงประจำฉาก, concentration, undo/redo, session recap, timeline ✅ · ย้ายไปทำทีหลัง: scene templates, drawing tools, custom layers | ✅ เสร็จ (2 รอบ) |
| 8 Advanced features | dynamic lighting & vision (กำแพง/ประตู/แสง/darkvision), voice chat, AI ผู้ช่วย DM ผ่าน Claude Code ในเครื่อง | ✅ เสร็จ |
| 9 Polish | เล่นที่บ้านด้วยคำสั่งเดียว (ฐานข้อมูลในตัว), ไฟล์ .bat สำหรับ Windows, เล่นออนไลน์ผ่าน tunnel ฟรี, แยกโค้ดโหลดเร็วขึ้น, ตรวจความปลอดภัย, คู่มือ | ✅ เสร็จ |

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

### 2026-11-04 — Phase 4: Combat ✅ (ปิด MVP)

**สิ่งที่ใช้งานได้จริง**

- **Combat mode** (หนึ่งการต่อสู้ต่อแคมเปญ, กันเริ่มซ้อนด้วย unique index): DM เริ่มการต่อสู้ด้วย token สิ่งมีชีวิตทั้งหมดบนแผนที่
  หรือเฉพาะ token ที่เลือก, เพิ่ม token ระหว่างต่อสู้, เพิ่มผู้ร่วมต่อสู้ที่ไม่มี token (เช่น summon), นำออก, จบการต่อสู้
- **Initiative**: ทอยที่ server (d20 + bonus จาก DEX ของ character sheet หรือค่าบน token) และลงใน dice log;
  DM ทอยให้ NPC/ทุกคน, ผู้เล่นทอยของตัวเองได้ครั้งเดียว, DM แก้ค่าได้; เรียงตาม initiative → bonus → ลำดับ DM → ชื่อ;
  initiative ของมอนสเตอร์ที่ซ่อนเป็น DM-only
- **Turn / round**: Next / Back (DM), ผู้เล่นกด "จบตาของฉัน" ได้เฉพาะตาตัวเอง, ข้ามตัวที่ defeated, ขึ้น round ใหม่อัตโนมัติ,
  กันกดซ้ำข้ามสองตาด้วย version, token ที่ถึงตามีวงแสงบนแผนที่ทุก client
- **HP**: Damage (เลือก damage type 13 ชนิดของ SRD) / Heal / Temp HP / Set HP (DM) ผ่าน rules engine —
  immunity → 0, resistance หารครึ่งปัดลง, vulnerability ×2, temp HP รับก่อนและไม่ stack, heal เริ่มจาก 0;
  HP ของ PC เขียนลง character sheet โดยตรง (sheet กับ token ตรงกันเสมอ), มอนสเตอร์/NPC เก็บบน token พร้อม AC, initiative bonus, defenses;
  มอนสเตอร์ที่ HP เหลือ 0 ถูกทำเครื่องหมาย defeated อัตโนมัติ (PC ไม่ เพราะต้องทอย death save)
- **Conditions** ตาม ruleset (ตรวจที่ server) พร้อมจำนวน round; นับถอยหลังตอนจบตาของสิ่งมีชีวิตนั้นและหมดอายุเอง; exhaustion มี level
- **ใครเห็น HP**: ตั้งต่อ token — ทุกคน / เจ้าของ+DM / DM เท่านั้น (ค่าเริ่มต้น: PC = ทุกคน, มอนสเตอร์ = DM); server ตัดข้อมูลออกก่อนส่ง
- **Combat HUD**: initiative list (HP bar, conditions, defeated, ซ่อน), round counter, ป้าย "ตาของคุณ", action economy
  (Action / Bonus action / Reaction / Object interaction / movement) ของตัวที่ถึงตา, HP bar + จำนวน condition บน token
- แก้ character sheet ผ่าน REST แล้ว token และ initiative list อัปเดตให้ทุกคนทันที

**การทดสอบ (รันจริงทั้งหมด)**

| ชุด | ผล |
| --- | --- |
| `packages/rules` unit (เพิ่ม damage/initiative/turn/conditions 10 ตัว) | 125/125 ✅ |
| `apps/server` integration กับ Postgres จริง (เพิ่ม combat 3 ชุด: permissions, การซ่อนข้อมูล, turn flow, damage/resistance/temp HP, sheet sync, conditions หมดอายุ) | 43/43 ✅ |
| `apps/web` unit | 6/6 ✅ |
| E2E Phase 4 (`e2e/phase4.e2e.cjs`): DM + ผู้เล่น (UI ไทย) — ตั้ง HP/AC/resistance มอนสเตอร์, ผู้เล่นไม่เห็น HP มอนสเตอร์, เริ่มต่อสู้, ผู้เล่นทอย initiative, DM ทอย NPC + แก้ลำดับ, highlight ตา, action economy sync, ผู้เล่นจบตาตัวเอง, round 2, fire damage ถูกหารครึ่ง, ผู้เล่นรับดาเมจ/ใส่ condition ให้ตัวเอง, sheet อัปเดต, condition หมดอายุ, มอนสเตอร์ defeated, reload คง state, จบการต่อสู้, ไม่มี console error | ✅ |
| E2E Phase 1 + Phase 2 (regression) | ✅ |
| `pnpm typecheck` ทั้ง 3 package | ✅ |

**Error ที่พบระหว่างทดสอบและแก้แล้ว**

1. แก้ AC/resistance ของ token แล้วค่าที่กำลังพิมพ์ในช่องอื่นหาย (form ถูก remount ทุกครั้งที่ token version เปลี่ยน) → เก็บ draft ไว้ขณะแก้ และรับค่าจาก server เมื่อไม่ได้แก้อยู่
2. Checkbox action economy ไม่ติ๊กทันที (รอ server) → optimistic update + rollback
3. Token ใหม่วางซ้อนกันตรงกลางจอจนคลิกเลือกตัวล่างไม่ได้ → หา cell ว่างใกล้กลางจอก่อนวาง
4. HP bar ใน initiative list ไม่มีสี (ใช้สีที่ไม่มีใน theme) และเครื่องหมาย defeated มองยากบน token สีแดง → แก้สี + ขอบตัวอักษร

**ข้อจำกัดที่ยังมี**

- Back (ย้อนตา) ไม่คืน condition ที่หมดอายุไปแล้ว — DM ใส่กลับเองได้
- Death saves ยังไม่มีปุ่มใน combat HUD (ทอยจาก character sheet ได้) · ลากสลับลำดับ initiative ยังไม่มี (แก้ตัวเลขแทน)
- ระยะเคลื่อนที่ที่ใช้ต้องกรอกเอง ยังไม่คำนวณจากการลาก token

### 2026-11-04 — Phase 3: Character & Dice ✅

**สิ่งที่ใช้งานได้จริง**

- **ทอยจาก token**: เลือก token ตัวละครบนแผนที่ → ทอย ability check / save / skill / initiative / attack / damage
  (Normal / Advantage / Disadvantage) ทอยที่ server และลง dice log; เปิด character sheet เต็มได้จากโต๊ะ
- **Dice animation 2D**: ลูกเต๋ากลิ้งแล้วหยุดที่ค่าจริงจาก server, critical/natural 1 มีสีต่าง, เสียงสังเคราะห์ด้วย Web Audio (ไม่มีไฟล์เสียง);
  ปิดแอนิเมชัน/เสียงได้ใน profile และเคารพ "reduce motion" ของระบบ; ทอยแบบ DM-only ไม่แสดงให้ผู้เล่น
- **นำเข้าชีตจาก PDF/รูป (Claude API)**: อัปโหลด PDF/PNG/JPEG/WEBP ≤10MB → server ส่งให้ Claude อ่านเป็น draft ที่มีโครงสร้าง
  (structured output + Zod) → หน้าตรวจทานไฮไลต์ field ที่ AI ไม่แน่ใจ, แสดงคำเตือน, ค่าที่คำนวณได้ → ผู้ใช้แก้แล้วจึงบันทึก;
  ไม่มีอะไรถูกบันทึกก่อนผู้ใช้กด Save; key อยู่ใน `.env` ของ server เท่านั้น; จำกัด 10 ครั้ง/ชม./ผู้ใช้ (`IMPORT_PER_HOUR`);
  ถ้า server ไม่มี `ANTHROPIC_API_KEY` หน้าเว็บบอกชัดเจนและปุ่มถูกปิด
- **Character creator** (`/characters/new`, 5e 2014 · SRD 5.1): 7 ขั้น — ชื่อ/alignment, race (+subrace, Half-Elf เลือก +1 สองค่า),
  class, background (Acolyte หรือของผู้เล่นเอง), ability scores (standard array แบบสลับค่า / point buy 27 แต้มแสดงงบสด / ทอย 4d6),
  skills (ปิด skill ที่ได้จาก race/background แล้ว), ตรวจทาน (HP, AC, initiative, speed) → สร้างเป็นชีตปกติที่แก้ได้ทั้งหมด;
  กฎทั้งหมดอยู่ใน `@vtt/rules` (`validateCreatorChoices`, `buildSrdCharacter`) ใช้ร่วม client/server ได้

**การทดสอบ (รันจริงทั้งหมด)**

| ชุด | ผล |
| --- | --- |
| `packages/rules` unit (เพิ่ม creator 4 ตัว, import mapping 2 ตัว) | 131/131 ✅ |
| `apps/server` integration (เพิ่ม sheet import 3 ตัว: PDF/PNG ผ่านและไม่บันทึก, ปฏิเสธไฟล์ปลอม/ไม่ล็อกอิน, rate limit, ไม่มี key → 503) | 46/46 ✅ |
| `apps/web` unit (dice fx) | 9/9 ✅ |
| E2E Phase 3: หน้า import บอกว่าไม่มี key, ตรวจทาน draft (ไฮไลต์ field ไม่แน่ใจ, แก้ค่า, บันทึก, ตรวจข้อมูลที่ server), creator สร้าง Hill Dwarf Cleric (point buy, standard array swap, skill ที่ซ้ำถูกปิด, HP 11 / AC 12) แล้วตรวจข้อมูลที่บันทึก | ✅ |
| E2E Phase 1, 2, 4 (regression; Phase 4 เพิ่มขั้น dice animation) | ✅ |
| `pnpm typecheck` ทั้ง 3 package | ✅ |

**Error ที่พบและแก้แล้ว**

1. CSP error ใน console: Zod ลอง `new Function` ตอนสร้าง schema ใน chunk ที่โหลดก่อน `main.tsx` → ตั้ง `jitless` ใน `@vtt/rules` เอง (ก่อน schema ใดๆ) เฉพาะใน browser
2. E2E Phase 1 พังเพราะ dice overlay แสดงข้อความเดียวกับ dice log → ระบุ locator ให้ชี้ที่ log

**ข้อจำกัดที่ยังมี**

- Creator รองรับ 5e 2014 เท่านั้น (5e 2024 ใช้ชีตว่าง), ยังไม่เลือก spell/อุปกรณ์ให้
- การเรียก Claude API จริงยังไม่ได้ทดสอบใน environment นี้ (ไม่มี key) — ทดสอบผ่าน extractor interface + stub แล้ว; ต้องใส่ key ใน `apps/server/.env` เพื่อใช้งาน

### 2026-11-04 — Phase 5: DM Toolkit ✅

**สิ่งที่ใช้งานได้จริง** (ปุ่ม 📖 Journal และ 🧰 เครื่องมือ DM บนโต๊ะและในล็อบบี้)

- **Bestiary**: stat block จาก SRD 5.1 จำนวน 30 ตัว (Commoner ถึง Young Red Dragon) ค้นหาด้วยชื่อ/ประเภท/CR;
  กดทอย ability check, attack, damage ได้จาก stat block (DM-only); วางลงแผนที่ทีละหลายตัว (ตั้งชื่อ Goblin 1, 2, 3…,
  HP เฉลี่ยหรือทอย hit dice แยกต่อตัว, ซ่อนจากผู้เล่น, ขนาด token ตาม size) โดยแต่ละ token มี HP/AC/defenses ของตัวเอง;
  "คัดลอกเข้าแคมเปญ" สร้างชีต monster ที่แก้ได้ และเลข save/skill/attack ที่คำนวณตรงกับที่ SRD พิมพ์
- **Stat block บน token**: เลือก token มอนสเตอร์ → เห็น stat block และทอยได้ทันที; ลิงก์ stat block ถูกตัดออกก่อนส่งให้ผู้เล่น
- **Encounter builder**: รวม monster จาก SRD และของแคมเปญ, จำนวน, XP รวมและต่อผู้เล่น, บันทึก/แก้ (versioning)/ลบ;
  "วางและเริ่มต่อสู้" วาง token แบบซ่อน (HP ทอยแยก) แล้วเริ่ม combat หรือเพิ่มเข้า combat ที่กำลังเล่น
- **Journal**: Markdown (ไม่ render HTML ดิบ), โฟลเดอร์, ปักหมุด, ค้นหา, แนบรูป; สิทธิ์ต่อ entry: DM เท่านั้น / ทุกคน /
  DM + ผู้เล่นที่เลือก / บันทึกส่วนตัว (แม้ DM ก็ไม่เห็น); ผู้เล่นเขียนได้แต่แก้ได้เฉพาะของตัวเอง; อัปเดต realtime เฉพาะคนที่มีสิทธิ์
  และคนที่เสียสิทธิ์จะได้คำสั่งลบออก
- **Handout**: DM กด "แสดง handout" ให้ทุกคนหรือผู้เล่นคนเดียว → หน้าต่างเด้งขึ้นจอผู้เล่นทันทีพร้อมรูป;
  รูป handout ถูกกันไม่ให้ดาวน์โหลด/ไม่โผล่ในรายการ asset จนกว่าจะถูกแชร์
- **Random tables**: กรอกแบบ "1-2 Clear skies" ทีละบรรทัด, server ตรวจว่าไม่ซ้อนและอยู่ในช่วงของลูกเต๋า,
  ทอยที่ server และลง dice log (DM-only หรือเปิดเผย) โดย label มีผลลัพธ์
- **DM Screen**: DC ทั่วไป, cover, conditions ตาม ruleset ของแคมเปญ, action ในการต่อสู้, ประเภทดาเมจ, ปุ่มทอยลับ

**การทดสอบ (รันจริงทั้งหมด)**

| ชุด | ผล |
| --- | --- |
| `packages/rules` unit (เพิ่ม bestiary 3 ตัว: ความถูกต้องของข้อมูลทั้ง 30 ตัว, token stats, การแปลงเป็นชีต) | 134/134 ✅ |
| `apps/server` integration (เพิ่ม 5 ตัว: สิทธิ์ journal, realtime ต่อผู้รับ + handout + รูป, encounters, tables + dice log, ลิงก์ stat block) | 51/51 ✅ |
| `apps/web` unit (เพิ่ม parse ตาราง) | 10/10 ✅ |
| E2E Phase 5: วาง goblin 3 ตัว, คัดลอก Bandit Captain, encounter ซ่อน + เริ่ม combat, ทอย stat block แบบ DM-only, journal DM-only ไม่หลุด, บันทึกส่วนตัวผู้เล่น, handout เด้ง + รูปโหลดได้, random table DM-only, DM screen, ไม่มี console error | ✅ |
| E2E Phase 1–4 (regression) | ✅ |
| `pnpm typecheck` ทั้ง 3 package | ✅ |

**Error ที่พบและแก้แล้ว**

1. เลือก token มอนสเตอร์แล้ว stat block ซ้อนกันหลายชุด — React key ชนกับ token editor → แยก key
2. Dialog ปิดด้วย Esc ได้เฉพาะตอนโฟกัสอยู่ใน dialog → ฟัง Esc ทั้งหน้าต่าง
3. แก้ AC/HP ของ token จะส่ง stats ใหม่ทับลิงก์ stat block → server เก็บลิงก์เดิมไว้ถ้าไม่ได้ระบุ

**ข้อจำกัดที่ยังมี**

- ไม่มีระดับความยาก encounter (ตาราง XP threshold อยู่ใน DMG ไม่ใช่ SRD) — แสดง XP รวมและต่อผู้เล่นแทน
- Bestiary มี 30 ตัวที่ใช้บ่อย ไม่ใช่ทั้ง SRD; ยังไม่มีหน้าแก้ custom ruleset

### 2026-11-04 — Phase 6: Music ✅

**สิ่งที่ใช้งานได้จริง** (ปุ่ม 🎵 เพลงและเสียง สำหรับ DM บนโต๊ะและในล็อบบี้; ปุ่ม 🔊 ระดับเสียงของฉัน สำหรับทุกคน)

- **อัปโหลดเสียง**: MP3, OGG, WAV, FLAC, M4A, WEBM (ไฟล์ละไม่เกิน 30 MB) ตรวจชนิดไฟล์จาก magic bytes ที่ server
  (ไม่เชื่อนามสกุลหรือ MIME ที่ client ส่ง); เฉพาะคนที่มีสิทธิ์ `music.control` (DM/co-DM) อัปโหลดได้; ความยาวเพลงวัดในเบราว์เซอร์ตอนอัปโหลด
- **คลังเสียง**: แยกหมวด เพลง / เสียงบรรยากาศ / เอฟเฟกต์, แท็ก, ค้นหา, เปลี่ยนชื่อ/หมวด, ลบ (ลบออกจาก playlist และหยุดเล่นให้ทุกคนด้วย);
  ผู้เล่นไม่เห็นรายการเสียงทั้งหมด (กันสปอยล์) — ได้ยินเฉพาะสิ่งที่ DM เปิด
- **Playlist**: สร้าง/เรียงลำดับ/แก้ (versioning)/ลบ, เล่นตามลำดับหรือสุ่ม, เล่นซ้ำ: ไม่ซ้ำ / ซ้ำเพลง / ซ้ำทั้งรายการ
- **เล่นพร้อมกันทุกเครื่อง**: server เก็บสถานะ (เพลง, ตำแหน่ง, เวลา server ที่เริ่ม) ใน DB แล้ว broadcast; ทุก client คำนวณตำแหน่งจากนาฬิกา server
  ชดเชยเวลาเครื่องที่ต่างกัน และแก้ drift เกิน 1.5 วินาที; เมื่อเพลงจบ **server เป็นคนเลื่อนไปเพลงถัดไป** (timer) ไม่ต้องพึ่งเครื่อง DM;
  รีโหลดหน้า/เข้ามาทีหลังจะได้ยินเพลงเดียวกันที่ตำแหน่งเดียวกัน
- **DM controls**: เล่น/หยุดชั่วคราว/หยุด/ก่อนหน้า/ถัดไป/เลื่อนตำแหน่ง/ระดับเสียง, เสียงบรรยากาศซ้อนได้ 6 ชั้น (เปิด-ปิด/ระดับเสียงแยก),
  เอฟเฟกต์เล่นครั้งเดียวให้ทุกคน, ปุ่ม "หยุดเสียงทั้งหมด"
- **ระดับเสียงของผู้เล่นเอง**: รวม/เพลง/บรรยากาศ/เอฟเฟกต์/ปิดเสียง เก็บในเบราว์เซอร์ DM ปรับแทนไม่ได้;
  ถ้าเบราว์เซอร์บล็อกเสียงอัตโนมัติจะมีปุ่ม "คลิกเพื่อเปิดเสียง"
- ผู้เล่นได้เฉพาะเพลงที่กำลังเล่น ไม่ได้คิว/playlist ที่จะเล่นต่อ; ไฟล์เสียงส่งแบบ HTTP Range (เลื่อนตำแหน่งได้)

**การทดสอบ (รันจริงทั้งหมด)**

| ชุด | ผล |
| --- | --- |
| `packages/rules` unit (เพิ่ม audio model 13 ตัว: ตำแหน่งตามเวลา, เลื่อนเพลงเมื่อจบ, loop, shuffle, ambient, ลบเพลง, drift) | 147/147 ✅ |
| `apps/server` integration (เพิ่ม 6 ตัว: ตรวจไฟล์เสียง, Range, สิทธิ์อัปโหลด/คลัง, playlist, realtime ต่อผู้รับ + ซ่อนคิว, SFX, server เลื่อนเพลงเอง) | 57/57 ✅ |
| `apps/web` unit (เพิ่มค่าระดับเสียง + นาฬิกา server) | 12/12 ✅ |
| E2E Phase 6: DM อัปโหลด 4 ไฟล์, สร้าง playlist, เล่น → `<audio>` ในเบราว์เซอร์ผู้เล่นเล่นจริง, ผู้เล่นปรับเสียงเอง (DM ไม่กระทบ), เสียงฝน + ฟ้าร้อง, server เลื่อนไปเพลง 2 เอง, หยุดชั่วคราว, รีโหลดแล้วสถานะเดิม, หยุดทั้งหมด, ไม่มี console error | ✅ |
| E2E Phase 1–5 (regression) | ✅ |
| `pnpm typecheck` ทั้ง 3 package | ✅ |

**Error ที่พบและแก้แล้ว**

1. วัดความยาวเพลงตอนอัปโหลดไม่ได้ — CSP บล็อก `blob:` สำหรับ media → เพิ่ม `media-src 'self' blob:`
2. Dropdown หมวดเพลงกินความกว้างทั้งแถว → จำกัดความกว้าง

**ข้อจำกัดที่ยังมี**

- เพลงที่วัดความยาวไม่ได้จะไม่เลื่อนไปเพลงถัดไปเอง (DM กด ถัดไป) — เบราว์เซอร์ส่วนใหญ่วัดได้
- ความต่างของเวลาระหว่างเครื่องยอมให้ ~1.5 วินาที (ไม่ได้ sync ระดับ millisecond)
- ยังไม่มี crossfade และเพลงประจำ scene (ต่อใน Phase 7 พร้อม scene switching)

### 2026-11-04 — Phase 7 (รอบแรก): Spells, AoE templates, Scene music, Item transfer ✅

รอบนี้เลือกทำ 4 อย่างที่ใช้บ่อยที่สุดตอนเล่นจริงก่อน ส่วน undo/redo, session recap, timeline, drawing tools อยู่รอบถัดไป

**สิ่งที่ใช้งานได้จริง**

- **คลังเวท SRD**: เวท 51 บทจาก SRD 5.1 (cantrip ถึงเลเวล 9 ที่ใช้บ่อย) ค้นหาด้วยชื่อ/ระดับ แล้วกด "Add" ใส่ชีต
  (ระดับ, school, concentration, ritual กรอกให้เอง); เวทที่พิมพ์เองยังใช้ได้เหมือนเดิม
- **ร่ายเวทจากชีต** (ปุ่ม Cast เมื่อเปิดชีตจากโต๊ะ/ล็อบบี้): เลือกระดับ slot (upcast ได้), ritual, ทอยซ่อนสำหรับ DM;
  **server** ล็อกแถวชีต ใช้ slot (ไม่มี slot เหลือ → ปฏิเสธ), คำนวณ DC/โบนัสโจมตี, ทอย attack/damage/healing ตามกฎ
  (cantrip scaling, upcast, Magic Missile/Scorching Ray หลายลูก) แล้วโพสต์ลง log เช่น
  "Elara casts Fireball at 3rd level — DC 15 Dex save (half on success) — 20-ft sphere"
- **AoE template บนแผนที่** (ปุ่ม 📐 หรือกด T): วงกลม/กรวย/เส้น/สี่เหลี่ยม ขนาดเป็นฟุตตาม grid ของฉาก, กดค้างแล้วลากเพื่อเล็งทิศ,
  โทเคนที่อยู่ในพื้นที่มีวงไฮไลต์ (คำนวณจากกฎเดียวกันทั้ง client/server), sync realtime ทุกเครื่อง,
  หลังร่ายเวทที่มีพื้นที่กด "Place 20-ft sphere on the map" ได้เลย; หมุน 45°/ลบ ได้เฉพาะเจ้าของหรือ DM;
  DM วาง template แบบซ่อน (เช่น กับดัก) ได้ — ผู้เล่นไม่ได้รับข้อมูลเลยจนกว่าจะเปิด; DM ล้างทั้งฉากได้
- **เพลงประจำฉาก**: DM เลือก playlist หรือเพลงให้ฉาก (ในการตั้งค่าฉาก); เมื่อกด "แสดงให้ผู้เล่น" เพลงเริ่มให้ทุกคนอัตโนมัติ
  (ถ้าเพลงเดียวกันเล่นอยู่แล้วจะไม่เริ่มใหม่); ผู้เล่นไม่เห็นการตั้งค่านี้
- **ส่งไอเทมให้ตัวละครอื่น** (ปุ่ม Give ในแท็บ Inventory): เลือกผู้รับ (ตัวละครของผู้เล่นในแคมเปญ, DM ส่งให้ NPC ได้) และจำนวน;
  server ล็อกทั้งสองชีตตามลำดับ (กัน deadlock), รวม stack ถ้าชื่อ+ประเภทตรงกัน, ไอเทมที่สวมอยู่จะถอดออก, โพสต์ลง log
- แก้ระหว่างทาง: Esc ในหน้าต่างซ้อน (เช่น คลังเวทในชีต) ปิดเฉพาะหน้าต่างบนสุด; ปุ่มลัดของโต๊ะไม่ทำงานขณะเปิดหน้าต่าง;
  ชีตจำแท็บที่เปิดไว้เมื่อข้อมูลอัปเดตจาก server

**การทดสอบ (รันจริงทั้งหมด)**

| ชุด | ผล |
| --- | --- |
| `packages/rules` unit (เพิ่ม 8: ค้นหาเวท, cantrip scaling, upcast, หลายลูก, template geometry วงกลม/กรวย/เส้น/สี่เหลี่ยม) | 155/155 ✅ |
| `apps/server` integration (เพิ่ม 4: ร่ายเวท + slot + สิทธิ์ + log, ส่งไอเทม + merge stack + สิทธิ์, template realtime + ซ่อน/เปิด, เพลงประจำฉาก) | 61/61 ✅ |
| `apps/web` unit | 12/12 ✅ |
| E2E Phase 7: ผู้เล่นเพิ่ม Fireball จากคลัง SRD → ร่ายที่ slot 3 (slot ลดใน DB, log ขึ้นทั้งสองเครื่อง) → วางพื้นที่ 20 ft บน goblin (DM และผู้เล่นเห็น, goblin ทั้งสองไฮไลต์) → DM เล็ง cone แล้วลบ → ผู้เล่นส่ง potion ให้ Torvin → DM ตั้งเพลงให้ฉาก Inn แล้วแสดงฉาก → `<audio>` ผู้เล่นเล่นเพลงนั้นจริง, ไม่มี console error | ✅ |
| E2E Phase 1–6 (regression) | ✅ |
| `pnpm typecheck` ทั้ง 3 package | ✅ |

**Error ที่พบและแก้แล้ว**

1. กด Esc ในคลังเวทแล้วชีตปิดไปด้วย และโต๊ะยกเลิกการเลือก token → Modal ปิดเฉพาะบนสุด + ปุ่มลัดโต๊ะหยุดทำงานขณะมีหน้าต่าง
2. แก้ template บางช่องแล้ว schema ใส่ค่า default ทับช่องที่ไม่ได้ส่ง → แยก schema สำหรับ patch (ไม่มี default)
3. ป้ายชื่อ template ถูก token บัง → ย้ายป้ายไปเหนือขอบบนของพื้นที่

**ข้อจำกัดที่ยังมี**

- คลังเวทมี 51 บท (ที่ใช้บ่อย) ไม่ใช่ SRD ครบทุกบท; เวทที่ไม่มีในคลังพิมพ์เองได้ แต่ร่ายแล้วจะไม่ทอยอัตโนมัติ
- ยังไม่ทำ concentration tracking อัตโนมัติ (แสดงป้าย "concentration" ใน log), ยังไม่หัก HP จากเวทอัตโนมัติ (DM ใช้ปุ่ม damage บน token)
- Template ลากย้ายไม่ได้ (ลบแล้ววางใหม่ / หมุน 45°) — *แก้แล้วในรอบสอง*

### 2026-11-04 — Phase 7 (รอบสอง): Concentration, Undo/redo, Session recap, Timeline ✅

**สิ่งที่ใช้งานได้จริง**

- **ลากย้าย template**: เจ้าของหรือ DM ลากพื้นที่ไปวางใหม่ได้ (เครื่องมือเลือก) วงไฮไลต์โทเคนเปลี่ยนตามขณะลาก แล้ว sync ทุกเครื่อง
- **Concentration**: ร่ายเวท concentration แล้ว server บันทึกในชีตเอง (ร่ายบทใหม่ = เลิกบทเก่า และแจ้งใน log);
  ชีตและแผงโทเคนมีป้าย "🔮 Concentrating on Bless" พร้อมปุ่มทอย Con save และปุ่ม End;
  เมื่อโทเคนโดนดาเมจ server โพสต์ "Elara must make a DC 12 Constitution save…" (DC = 10 หรือครึ่งดาเมจ ตาม SRD);
  HP เหลือ 0 = หลุด concentration อัตโนมัติ; จบ concentration ได้เฉพาะเจ้าของหรือ DM
- **Undo/redo** (ปุ่ม ↶ ↷ หรือ Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y): ย้อนการวาง/ย้าย/แก้/ลบโทเคน, หมอก, template ที่ตัวเองทำ
  (สูงสุด 50 ขั้นต่อแผนที่) — ย้อนโดยส่งคำสั่งตรงข้ามผ่าน server ตามปกติ สิทธิ์จึงถูกตรวจซ้ำและทุกคนเห็นทันที;
  โทเคนที่ลบแล้วกู้คืนได้พร้อม HP/AC ของโทเคน
- **Session recap**: ในหน้า 🕰 ไทม์ไลน์ DM กด "ร่างจาก log ของเซสชัน" ได้ร่างอัตโนมัติ (เหตุการณ์ใน log สาธารณะ, จำนวนทอย,
  ดาเมจสูงสุด, nat 20/nat 1) แล้วแก้และ "เผยแพร่ให้ผู้เล่น"; ผู้เล่นไม่ได้รับเนื้อหา recap จนกว่าจะเผยแพร่ และร่างไม่ดึงข้อความช่อง DM หรือการทอยที่ซ่อน
- **Campaign timeline**: แสดงทุกเซสชันตามลำดับพร้อม recap และ "เหตุการณ์ในเรื่อง" ที่ DM เพิ่ม (วันที่ในโลกเกมพิมพ์อิสระ, ผูกกับเซสชันได้,
  ตั้งเป็น "เฉพาะ DM" ได้ — ผู้เล่นไม่ได้รับข้อมูลเลย) เปิดได้ทั้งจากล็อบบี้และโต๊ะ, อัปเดต realtime
- **แก้ช่องโหว่จากรอบแรก**: DM ร่ายเวทแบบทอยซ่อน (เช่น NPC) ข้อความ "X casts Y" เคยขึ้นให้ทุกคน → ตอนนี้ไปช่อง DM เท่านั้น
- Esc ปิดหน้าต่างโดยไม่ไปยกเลิกการเลือกโทเคนบนแผนที่

**การทดสอบ (รันจริงทั้งหมด)**

| ชุด | ผล |
| --- | --- |
| `packages/rules` unit (+ DC ของ concentration) | 156/156 ✅ |
| `apps/server` integration (เพิ่ม `test/phase7b.test.ts` 5 ตัว: concentration เริ่ม/เปลี่ยน/DC/จบ/HP 0, ร่ายซ่อนแจ้งเฉพาะ DM, ร่าง recap + สิทธิ์ + การเผยแพร่, event เฉพาะ DM + validation, ข้อความร่าง) | 66/66 ✅ |
| `apps/web` unit | 12/12 ✅ |
| E2E Phase 7b: ร่าย Bless → ป้าย concentration, DM ทำดาเมจ 24 → log ขอ DC 12, ผู้เล่นทอย Con save แล้วกด End, ลาก template แล้ว DM เห็นตำแหน่งใหม่, DM undo ชื่อ → undo การวาง → redo ×2 (ผู้เล่นเห็นทุกขั้น), จบเซสชัน → ร่าง recap จาก log → เผยแพร่ → ผู้เล่นอ่านได้, event ลับไม่ขึ้นให้ผู้เล่น | ✅ (ผ่าน 8 จาก 9 รอบ — 1 รอบ timeout หลัง restart server ทำซ้ำไม่ได้) |
| E2E Phase 1–7 (regression) | ✅ |
| `pnpm typecheck` ทั้ง 3 package | ✅ |

**Error ที่พบและแก้แล้ว**

1. Esc ในชีตทำให้โต๊ะยกเลิกการเลือกโทเคนด้วย (listener ลงทะเบียนใหม่ทุก render จึงทำงานหลัง Modal) → Modal จับ Esc ใน capture phase แล้วหยุด event
2. ข้อความ "session has ended" หลุดจากร่าง recap (โพสต์หลังเวลา endedAt) → ขยายช่วงเวลาอ่าน log
3. ร่าง recap ตัดชื่อเวทออกจาก label การทอย ("spell attack") → ตัดเฉพาะชื่อผู้ทอยที่นำหน้า

**ข้อจำกัดที่ยังมี**

- Undo เป็นของแต่ละคนและอยู่ในเบราว์เซอร์ (รีโหลดแล้วประวัติหาย); ไม่ครอบคลุม HP/conditions, "ซ่อน/เปิดหมอกทั้งหมด", การตั้งค่าฉาก
- Concentration ติดตามเฉพาะตัวละครที่มีชีต (มอนสเตอร์จาก bestiary ยังไม่ติดตาม); ไม่ตัดสินผล save ให้อัตโนมัติ (ผู้เล่น/DM กด End เอง)
- ร่าง recap เป็นการรวบรวมจาก log (ไม่ได้ใช้ AI เรียบเรียง)

### 2026-11-04 — อ่าน sheet ด้วย Claude Code ในเครื่อง (ไม่ต้องใช้ API key) ✅

ผู้ใช้ต้องการให้ใช้ฟรี (เล่นกับเพื่อน มีแค่ตัวเองเป็น DM) จึงเพิ่มตัวเลือกให้การอ่าน character sheet จาก PDF/รูป
เรียกใช้ Claude Code ที่ติดตั้งและล็อกอินไว้ในคอมเครื่องที่รัน server แทน Claude API (ใช้โควตาแพ็กเกจ Claude ของผู้ใช้)

- ตั้งใน `apps/server/.env`: `SHEET_READER=claude-code` (ตัวเลือก: `auto` ค่าเริ่มต้น = ใช้ API ถ้ามี key ไม่งั้นปิด, `api`, `off`)
  และถ้า `claude` ไม่อยู่ใน PATH ให้ใส่ `CLAUDE_CODE_PATH`; เลือกโมเดลได้ด้วย `CLAUDE_CODE_MODEL` (เว้นว่าง = ค่าเริ่มต้นของแพ็กเกจ)
- โค้ด: `apps/server/src/import/claudeCode.ts` (เรียก `claude -p` แบบ array ไม่ผ่าน shell, ใช้ได้แค่ tool `Read`, ไฟล์อยู่ในโฟลเดอร์ชั่วคราวที่ลบทิ้งหลังอ่าน,
  ตรวจคำตอบด้วย schema เดียวกับ API) และ `import/provider.ts` (เลือกตัวอ่านจาก `.env`)
- ข้อจำกัด: ใช้ได้เฉพาะตอน server รันบนคอมเครื่องที่ล็อกอิน Claude Code ไว้ ถ้าย้ายไปโฮสต์อื่นต้องใช้ API key แทน; ร่าง recap ด้วย AI ไม่ทำ (ผู้ใช้เลือกแบบฟรี)

| ชุดทดสอบ | ผล |
| --- | --- |
| `apps/server` integration (เพิ่ม `test/claudeCodeReader.test.ts` 4 ตัว: เรียกแบบปลอดภัย + ได้ draft, ไม่ได้ติดตั้ง/ไม่ได้ล็อกอิน/คำตอบเสีย/ไม่ตรง schema, เลือกตัวอ่านจาก `.env`, ผ่าน endpoint import) | 70/70 ✅ |
| ทดลองกับ Claude Code จริงในเครื่องทดสอบ: sheet แบบ PNG (~7 วินาที) และ PDF (~9 วินาที) อ่านชื่อ/คลาส/ค่า ability/AC/HP/การโจมตีถูกต้อง | ✅ |

Error ที่พบและแก้: Claude Code ไม่รับ JSON Schema ที่มี `"$schema": draft 2020-12` (จาก `z.toJSONSchema`) → ตัด key นี้ออกก่อนส่ง

### 2026-11-04 — Phase 8: Dynamic lighting & vision, Voice chat, AI ผู้ช่วย DM ✅

**Vision / lighting**
- DM วาดกำแพงบนแผนที่ (เครื่องมือ W): กำแพง / ประตู / ประตูลับ / ยางลบ, คลิกต่อเนื่องเป็นเส้น, snap มุมช่อง (Alt = วางอิสระ), ดับเบิลคลิกหรือ Esc จบเส้น
- ประตู: ผู้เล่นคลิกเปิด/ปิดได้ถ้ามองเห็นประตูและไม่ได้ล็อก; DM Shift+คลิกเพื่อล็อก; ประตูลับผู้เล่นเห็นเป็นกำแพงธรรมดา
- เปิด vision ต่อฉาก + แสงรอบข้าง (สว่าง/สลัว/มืด); token มี darkvision และแหล่งแสง (เทียน/คบเพลิง/ตะเกียง/โคม/เวท Light/แสงแดด)
- **Server กรอง token ที่ผู้เล่นมองไม่เห็น** (ต้องผ่านทั้งหมอกและ line of sight) — token ที่อยู่หลังกำแพงไม่ถูกส่งไปเลย ไม่ใช่แค่ซ่อนบนจอ
- ผู้เล่นเห็นความมืดนอกระยะมอง; DM ดูมุมมองของ token ที่เลือกได้ (preview)
- Logic อยู่ใน `@vtt/rules` (`map/vision.ts`: line of sight, visibility polygon, แสง) ใช้ร่วมกันทั้ง server และ client

**Voice chat**
- WebRTC แบบเชื่อมตรงทุกคน (mesh, สูงสุด 12 คน) server แค่ส่งข้อความเชื่อมต่อ (เฉพาะคนในห้องเสียงแคมเปญเดียวกัน, จำกัดอัตรา)
- ปุ่มเข้า/ออก, ปิดไมค์, ไฟแสดงคนที่กำลังพูด, ปรับเสียงแต่ละคน (จำในเบราว์เซอร์)
- STUN ฟรีของ Google เป็นค่าเริ่มต้น; ตั้ง TURN เองได้ที่ `VOICE_ICE_SERVERS` ถ้าเพื่อนบางคนต่อไม่ติด

**AI ผู้ช่วย DM** (DM Toolkit → แท็บ AI)
- โหมด: บรรยายฉาก, สร้าง NPC, ไอเดีย encounter, ตั้งชื่อ, ของรางวัล, ถามกฎ (SRD), ถามอะไรก็ได้ — ตอบเป็นภาษาที่เลือกในเว็บ
- ใช้บริบทแคมเปญ (setting, ปาร์ตี้, แผนที่ปัจจุบัน + DM notes, log สาธารณะล่าสุด) → บันทึกคำตอบลง journal (DM เท่านั้น)
- ใช้ Claude Code ในเครื่องที่รัน server (`AI_PROVIDER=claude-code` ฟรีตามแพ็กเกจ Claude) — ไม่ให้ใช้ tool ใดๆ, รันในโฟลเดอร์ว่างชั่วคราว; จำกัด `AI_PER_HOUR` ครั้ง/ชม.
- `AI_PROVIDER` ตัวเดียวคุมทั้ง AI ผู้ช่วยและการอ่าน sheet (`SHEET_READER` ยังใช้ทับได้)

| ชุดทดสอบ | ผล |
| --- | --- |
| `packages/rules` unit (+`vision.test.ts` 6 ตัว: line of sight, ประตู, แสง, darkvision, ประตูลับ) | 162/162 ✅ |
| `apps/server` integration (+`phase8.test.ts` 4 ตัว: กรอง token ตาม vision, ประตู/ล็อก/สิทธิ์, ความมืด/darkvision/คบเพลิง, voice signalling; +`aiAssistant.test.ts` 3 ตัว) | 77/77 ✅ |
| `apps/web` unit | 12/12 ✅ |
| E2E `e2e/phase8.e2e.cjs` (2 เบราว์เซอร์: กำแพง+ประตู → goblin หาย → ผู้เล่นเปิดประตู → มืด → คบเพลิง → DM preview → voice เชื่อมต่อจริง/ปิดไมค์/ออก → AI สร้าง NPC ด้วย Claude Code จริง + บันทึก journal) | ✅ |
| E2E phase 1–7b ซ้ำ (regression) | ✅ ทั้งหมด |

Error ที่พบและแก้:
- คลิกวาดกำแพงเร็วๆ แล้วเส้นหาย: Konva นับ dblclick จากเวลาอย่างเดียว (คลิกคนละจุดก็นับ) → ตรวจดับเบิลคลิกเองว่าเป็นมุมเดิมภายใน 450ms
- กด Esc แล้วหลุดจากเครื่องมือกำแพง → Esc จบเส้นแต่ยังอยู่ในเครื่องมือ
- Checkbox เปิด vision ไม่เปลี่ยนจนกว่า server ตอบ → อัปเดตฉากทันที (optimistic) และย้อนถ้า server ปฏิเสธ
- Test E2E phase 3 พังเมื่อ server เปิด AI → stub สถานะ "ไม่มีตัวอ่าน" ใน test แทนการพึ่งค่าใน `.env`

ข้อจำกัด: ไม่มีแสงสี/เงานุ่ม (แสงเป็นวงกลมตัดด้วยกำแพง), ไม่มีกำแพงแบบมองทะลุได้ทางเดียว/หน้าต่าง, voice แบบ mesh เหมาะกับโต๊ะไม่เกิน ~8 คน,
AI ใช้ได้เฉพาะเมื่อ server รันบนคอมที่ล็อกอิน Claude Code ไว้

### 2026-11-04 — Phase 9: พร้อมเล่นที่บ้าน + เล่นออนไลน์กับเพื่อน ✅

**ติดตั้งและรันง่าย**
- `pnpm play` / `start-windows.bat`: คำสั่งเดียวรันทุกอย่าง — เปิด PostgreSQL ในตัว (แพ็กเกจ `embedded-postgres`, เก็บที่ `data/db`, ฟังเฉพาะ localhost, รหัสผ่านสุ่มครั้งแรก),
  รัน migration, เสิร์ฟเว็บที่ :3001, เปิดเบราว์เซอร์, แสดงลิงก์สำหรับเพื่อนใน Wi-Fi เดียวกัน, เช็กว่า Claude Code พร้อมไหม, ปิดฐานข้อมูลเรียบร้อยเมื่อกด Ctrl+C
- `setup-windows.bat` (ติดตั้ง Node ผ่าน winget ถ้ายังไม่มี, pnpm, ส่วนประกอบ, build เว็บ, สร้าง `.env` จาก `.env.play.example` ที่เปิด AI แบบ Claude Code)
- `play-online-windows.bat`: Cloudflare quick tunnel (ติดตั้ง cloudflared ให้) → ลิงก์ https ให้เพื่อน, voice ใช้ได้
- Claude Code บน Windows: รองรับทั้ง `claude.exe` และ `claude.cmd` จาก npm (รันไฟล์ของแพ็กเกจตรงๆ ไม่ผ่าน shell)
- คู่มือภาษาไทย [docs/PLAY_ONLINE.md](docs/PLAY_ONLINE.md)

**ความปลอดภัย** (ตรวจทาน)
- เล่นผ่าน tunnel: ตรวจ Origin เทียบ host โดยไม่สน http/https, เชื่อ `X-Forwarded-*` เฉพาะ proxy บนเครื่องเดียวกัน (rate limit แยกต่อเพื่อนแต่ละคน), cookie `Secure` อัตโนมัติเมื่อเข้าผ่าน https
- `pnpm audit --prod`: ไม่พบช่องโหว่; ทั้งหมดพบ 1 ระดับกลางใน esbuild เก่าที่ติดมากับ `drizzle-kit` (เครื่องมือ dev สำหรับสร้าง migration ไม่ได้ใช้ตอนเล่น)
- ทบทวนสิทธิ์ endpoint ใหม่ของ Phase 8: กำแพง/ประตู (map.manage, ประตูลับ/ล็อก), vision ของ token, voice (สมาชิกเท่านั้น, relay เฉพาะห้องเดียวกัน), AI (dmNotes.view) — มี test ครอบทุกข้อ
- ฐานข้อมูลในตัวฟังเฉพาะ localhost; ข้อมูล DM-only ทั้งหมดยังกรองที่ server

**ประสิทธิภาพ**: ทุกหน้า lazy load — ไฟล์แรกจาก 564KB เหลือ 332KB (gzip 103KB), ไม่มีคำเตือน chunk ใหญ่แล้ว

| ชุดทดสอบ | ผล |
| --- | --- |
| `packages/rules` unit | 162/162 ✅ |
| `apps/server` integration (+ tunnel: origin/secure cookie/XFF เฉพาะ localhost, + หา Claude Code บน Windows) | 79/79 ✅ |
| `apps/web` unit | 12/12 ✅ |
| `pnpm play` ด้วยฐานข้อมูลในตัว: เปิดครั้งแรก (สร้าง DB), ปิดด้วย Ctrl+C (Postgres หยุด), เปิดใหม่ข้อมูลยังอยู่ | ✅ |
| E2E phase 1–8 ทั้งหมด รันกับ `pnpm play` (ฐานข้อมูลในตัว) | ✅ |

Error ที่พบและแก้:
- `pnpm home` ชนกับคำสั่งในตัวของ pnpm (เปิดหน้าเอกสาร) → เปลี่ยนชื่อเป็น `pnpm play`
- Prettier จัดรูปแบบทั้งไฟล์ผิดสไตล์ของ repo → ย้อนแล้วแก้เฉพาะส่วน
- embedded-postgres เวอร์ชันล่าสุดเพิ่งออก 5 วัน → เลือก 17.10.0-beta.17 (ออก มิ.ย. 2026) เพื่อความปลอดภัยของ supply chain

ข้อจำกัด: ทดสอบสคริปต์ .bat บน Windows จริงไม่ได้ในสภาพแวดล้อมนี้ (ทดสอบตัว launcher บน Linux แล้ว; ไฟล์ .bat เป็นแค่ตัวเรียก);
ลิงก์ trycloudflare เปลี่ยนทุกครั้งที่เปิด; voice ผ่านลิงก์ http (Wi-Fi/Tailscale แบบไม่ Funnel) ใช้ไมค์ไม่ได้เพราะเบราว์เซอร์บังคับ https

---

## 5. วิธีรันและทดสอบ

**เล่นจริง (Windows):** `setup-windows.bat` ครั้งแรก → `start-windows.bat` ทุกครั้ง → `play-online-windows.bat` เพื่อชวนเพื่อน ([คู่มือ](docs/PLAY_ONLINE.md))
**Mac/Linux:** `pnpm setup:play` แล้ว `pnpm play`

สำหรับพัฒนา ดู [README.md](README.md) — สรุป:

```bash
pnpm install
createdb vtt && createdb vtt_test
cp apps/server/.env.example apps/server/.env
pnpm db:migrate && pnpm dev                    # http://localhost:5173
TEST_DATABASE_URL=postgres://… pnpm test       # unit + integration
pnpm --filter @vtt/web build && (cd apps/server && WEB_DIST=../web/dist WEB_ORIGIN=http://localhost:3001 pnpm start)
for f in phase1 phase2 phase3 phase4 phase5 phase6 phase7 phase7b phase8; do BASE_URL=http://localhost:3001 node e2e/$f.e2e.cjs; done
```
