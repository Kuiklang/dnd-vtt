# TODO

สถานะจริงของงาน (อัปเดต 2026-11-04) · `[x]` เสร็จและทดสอบแล้ว · `[ ]` ยังไม่ทำ · `[~]` ทำบางส่วน
ภาพรวมและบันทึกความคืบหน้า: [PROJECT_PLAN.md](PROJECT_PLAN.md)

## รอการตัดสินใจ / ข้อมูลจากผู้ใช้

- [ ] สร้าง GitHub repo ว่าง (`dnd-vtt`) แล้วแจ้งชื่อ → push ประวัติ commit ทั้งหมด
- [ ] ยืนยันใช้ Drizzle ต่อ (แทน Prisma ตามแผนเดิม)
- [ ] Google OAuth client id/secret (ถ้าต้องการ Google Login)
- [ ] เลือก hosting + object storage (ตอนใกล้ MVP)

## Phase 1 — Foundation ✅

- [x] Monorepo + TypeScript strict + Vitest + Playwright
- [x] Rules engine: dice parser/roller, ruleset 5e 2014/2024, homebrew overrides, character schema + derive, permissions
- [x] Auth: register / login / logout / guest / upgrade guest / profile / sessions
- [x] Campaign: create / edit / delete / privacy / password / max players
- [x] Invitations (link + code, role, uses, expiry, revoke)
- [x] Roles & permissions (5 roles + per-campaign overrides) ตรวจที่ server
- [x] Lobby realtime: presence, ready, chat 5 channels, dice 5 visibilities, session control
- [x] Character library + sheet + autosave + optimistic locking + JSON import/export
- [ ] Google login (รอ OAuth credentials)
- [ ] Job ลบ guest ที่หมดอายุ (cron)

## Phase 2 — Core VTT ✅

- [x] Asset upload (magic bytes, size/dimension limits, member-only serving) + Storage interface (local disk)
- [x] Scenes: create (image/blank), rename, grid settings, background replace, duplicate, delete, DM notes, versioning
- [x] Active scene + ย้ายผู้เล่นอัตโนมัติ + เอาผู้เล่นออกจากห้อง scene เก่า
- [x] Canvas: pan, wheel zoom, fit, grid square/hex/none (วาดเฉพาะที่มองเห็น)
- [x] Tokens: add blank / party character, edit props, image upload, hide, lock, owners, delete, layer, snap on drop
- [x] ผู้เล่นวาง token ตัวละครตัวเอง (1 ตัว/scene) และย้ายได้เฉพาะ token ที่ควบคุม
- [x] Realtime sync ต่อผู้รับ + optimistic move + rollback + version
- [x] Manual fog: enable, rect/circle/polygon reveal/hide, hide all, reveal all, undo last; กรอง token ที่ server
- [x] Measurement tool ตามกฎ diagonal ของ ruleset + หน่วยจาก grid
- [x] Save status + reconnect state recovery
- [x] i18n framework (TH/EN) + language switch; หน้าโต๊ะ + top bar แปลครบ
- [x] Integration tests (assets/scenes/tokens/fog) + E2E phase2 + unit tests (geometry/fog/i18n)
- [ ] Stream ตำแหน่ง token ระหว่างลาก (throttle ~20Hz) ให้คนอื่นเห็นแบบลื่น
- [ ] Pinch-zoom / two-finger pan บนมือถือ
- [ ] Multi-select + group move, duplicate token
- [ ] Token library (รูปที่อัปโหลดแล้วเลือกซ้ำได้) — API `GET /api/campaigns/:id/assets` มีแล้ว ยังไม่มี UI
- [ ] Coordinates display บน canvas (มี `cellAt` แล้ว)
- [ ] S3/R2 storage backend + quota ต่อผู้ใช้ + strip EXIF
- [ ] Server-side masked map tiles (ป้องกันดูแผนที่ใต้หมอกผ่าน devtools)

## i18n — แปลหน้าที่เหลือ

- [ ] Auth / Join / Dashboard / Create campaign / Profile
- [ ] Lobby (header, party, invite panel, settings, feed, dice tray)
- [ ] Character sheet (labels ยกเว้นศัพท์เกม)
- [ ] ข้อความ error จาก server (ส่ง `code` แล้ว client แปล)

## Phase 3 — Character & Dice (ถัดไป)

- [ ] Character creator wizard
- [ ] Dice animation 2D + sound (ปิดได้) — settings มีแล้วใน profile
- [ ] Character import จาก PDF/รูป (OCR/AI provider interface, confidence, review ทุก field)
- [ ] Ability checks / attacks จาก token HUD

## Phase 4 — Combat ✅

- [x] ตาราง `combats`, `combatants`, token `stats` + `hp_visibility` + migration 0002
- [x] Start/end combat, เพิ่ม combatant จาก token บนแผนที่ / token ที่เลือก / แบบไม่มี token, นำออก
- [x] Roll initiative ที่ server (bonus จาก character หรือ token), ผู้เล่นทอยของตัวเองครั้งเดียว, DM แก้ค่า, เรียงลำดับ
- [x] Turn / round, next / previous, ข้าม defeated, highlight token ที่ถึงตา (sync ทุก client), กันกดซ้ำด้วย version
- [x] HP บน token: damage / healing / temp HP / set, resistance / vulnerability / immunity (rules engine)
- [x] Token ↔ character HP sync (PC), HP/AC/defenses ของ NPC/monster token ที่ไม่มี sheet
- [x] Conditions บน token + duration ตาม round (หมดอายุตอนจบตา), ตรวจกับ ruleset
- [x] Combat HUD + action economy tracker
- [x] DM override (Set HP, defeated, hidden), visibility ของ HP ต่อ token
- [x] Tests: unit (damage maths, turns), integration (turn sync, permissions, redaction), E2E combat flow
- [ ] ลากสลับลำดับ initiative (ตอนนี้แก้ตัวเลข)
- [ ] Death saves ใน combat HUD
- [ ] คำนวณ movement used จากการลาก token
- [ ] Back คืน condition ที่หมดอายุ (เก็บ history ต่อ turn)
- [ ] Concentration check อัตโนมัติเมื่อรับดาเมจ

## Phase 5–9

ดู [docs/ROADMAP.md](docs/ROADMAP.md)
