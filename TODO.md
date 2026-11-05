# TODO

สถานะจริงของงาน (อัปเดต 2026-11-04) · `[x]` เสร็จและทดสอบแล้ว · `[ ]` ยังไม่ทำ · `[~]` ทำบางส่วน
ภาพรวมและบันทึกความคืบหน้า: [PROJECT_PLAN.md](PROJECT_PLAN.md)

## รอการตัดสินใจ / ข้อมูลจากผู้ใช้

- [x] สร้าง GitHub repo `Kuiklang/dnd-vtt` → push ประวัติทั้งหมดแล้ว (2026-11-04)
- [x] ยืนยันใช้ Drizzle ต่อ (ผู้ใช้เลือก "Keep Drizzle" 2026-11-04)
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

## Phase 3 — Character & Dice ✅

- [x] Character creator wizard (5e 2014, SRD 5.1): 9 race + subrace, 12 class, Acolyte + background ของผู้เล่นเอง,
      standard array / point buy 27 / ทอย 4d6 ตัดต่ำสุด, เลือก skill ตามกฎ, คำนวณ HP/AC/slots/feature uses, ตรวจกฎใน `@vtt/rules`
- [x] Dice animation 2D + เสียงสังเคราะห์ (ปิดได้ใน profile, เคารพ prefers-reduced-motion)
- [x] Character import จาก PDF/รูปผ่าน Claude API (key อยู่ที่ server เท่านั้น, จำกัดครั้งต่อชั่วโมง, ตรวจชนิดไฟล์จริง,
      ไฮไลต์ field ที่ไม่แน่ใจ, ผู้ใช้ตรวจทุก field ก่อนบันทึก, UI แจ้งชัดเมื่อ server ไม่มี key)
- [x] Ability checks / saves / skills / initiative / attacks จาก token บนแผนที่ + เปิด sheet ที่โต๊ะ
- [x] Tests: unit (creator rules, import mapping, dice fx), integration (import route), E2E `e2e/phase3.e2e.cjs`
- [ ] Creator สำหรับ 5e 2024 (SRD 5.2: background ให้ ability bonus) — ตอนนี้ใช้ชีตว่างแทน
- [ ] Creator: เลือก cantrip/spell และอุปกรณ์เริ่มต้น (ตอนนี้เพิ่มเองในชีต)
- [ ] ข้อความ error ของ creator เป็นภาษาไทย (ตอนนี้มาจาก rules engine เป็นอังกฤษ)
- [ ] ทดสอบ import กับ Claude API จริง (environment นี้ไม่มี ANTHROPIC_API_KEY; ทดสอบผ่าน fake extractor + stub UI แล้ว)
- [x] อ่าน sheet ด้วย Claude Code ในเครื่องแทน API key (`SHEET_READER=claude-code`) ทดสอบกับ Claude Code จริงแล้ว ทั้ง PNG และ PDF

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

## Phase 5 — DM Toolkit ✅

- [x] Bestiary SRD 5.1: 30 stat block (ตรวจอัตโนมัติ: HP = ค่าเฉลี่ย hit dice, XP ตรง CR, save/skill ตรง proficiency), ค้นหาชื่อ/ประเภท/CR
- [x] วาง monster ลงแผนที่ (จำนวน, HP เฉลี่ยหรือทอยแยก, ซ่อน), HP แยกต่อ token, ขนาดตาม size
- [x] Stat block บน token (DM เท่านั้น) + ทอย check/attack/damage แบบ DM-only; ลิงก์ stat block ไม่ถูกส่งให้ผู้เล่น
- [x] คัดลอก stat block เข้าแคมเปญเป็นชีต monster ที่แก้ได้ (ค่าที่พิมพ์ตรงกับที่คำนวณ)
- [x] Encounter builder: บันทึก/แก้/ลบ, XP รวม + ต่อผู้เล่น, วางลงแผนที่แบบซ่อน + เริ่ม combat ทันที
- [x] Journal (Markdown ปลอดภัย, โฟลเดอร์, ปักหมุด, ค้นหา) สิทธิ์ 4 แบบ: DM เท่านั้น / ทุกคน / ผู้เล่นที่เลือก / ส่วนตัว
- [x] Realtime journal ต่อผู้รับ (upsert/remove เฉพาะคนที่มีสิทธิ์), optimistic versioning
- [x] Handout: แนบรูป, กด "แสดง" ให้ทุกคนหรือคนที่เลือก → เด้งขึ้นจอผู้เล่น; รูป handout โหลดไม่ได้จนกว่าจะแชร์
- [x] Random tables: ตรวจช่วงไม่ซ้อน/อยู่ในช่วงลูกเต๋า, ทอยที่ server ลง dice log (DM-only หรือเปิดเผย)
- [x] DM Screen: DC ทั่วไป, cover, conditions ตาม ruleset, action ในการต่อสู้, ทอยลับ
- [x] Journal / DM Toolkit เปิดได้ทั้งในล็อบบี้และบนโต๊ะ; Esc ปิด dialog ได้ทุกที่
- [x] Tests: unit (bestiary data, conversions, table text), integration (journal visibility + realtime, handout image access, encounters, tables, stat block link), E2E `e2e/phase5.e2e.cjs`
- [ ] ระดับความยากของ encounter (ตาราง XP threshold อยู่ใน DMG ไม่ใช่ SRD — ต้องให้ DM ใส่งบเอง หรือหาแหล่งเปิด)
- [ ] Bestiary เพิ่มเติม (SRD มี ~300 ตัว; ตอนนี้ 30 ตัวที่ใช้บ่อย) + import stat block จาก JSON
- [ ] Custom rulesets UI (engine รองรับ homebrew overrides แล้ว ยังไม่มีหน้าแก้)
- [ ] Journal: ลากจัดลำดับ, ลิงก์ระหว่าง entry, ประวัติการแก้ไข
- [ ] Random table ซ้อนกัน (entry เรียกตารางอื่น)

## Phase 6 — Music ✅

- [x] อัปโหลดเสียง (MP3/OGG/WAV/FLAC/M4A/WEBM ≤ 30 MB) ตรวจ magic bytes ที่ server, เฉพาะ `music.control`
- [x] ส่งไฟล์แบบ HTTP Range (206) เพื่อเลื่อนตำแหน่งได้
- [x] คลังเสียง: หมวด music/ambient/sfx, แท็ก, ค้นหา, เปลี่ยนชื่อ/หมวด, ลบ (ออกจาก playlist + หยุดเล่น); ผู้เล่นไม่เห็นรายการ
- [x] Playlist: สร้าง/เรียง/แก้ (versioning)/ลบ, เล่นตามลำดับหรือสุ่ม, loop off/track/queue
- [x] สถานะการเล่นเก็บใน DB, sync ด้วยนาฬิกา server + แก้ drift, server เลื่อนเพลงเองเมื่อจบ, รีโหลดแล้วได้สถานะเดิม
- [x] Ambient layers สูงสุด 6 ชั้น (เปิด-ปิด/ระดับเสียงแยก), SFX ครั้งเดียว, หยุดทั้งหมด
- [x] ระดับเสียงของผู้เล่นเอง (รวม/เพลง/บรรยากาศ/เอฟเฟกต์/ปิด) + ปุ่มเปิดเสียงเมื่อเบราว์เซอร์บล็อก autoplay
- [x] ผู้เล่นได้เฉพาะเพลงปัจจุบัน ไม่ได้คิว/playlist
- [x] Tests: unit (audio model, volume), integration (upload, Range, สิทธิ์, playlist, realtime, auto-advance), E2E `e2e/phase6.e2e.cjs`
- [ ] Crossfade ระหว่างเพลง
- [x] เพลงประจำ scene (Phase 7)
- [ ] เพลงเริ่มต้นของแคมเปญ
- [ ] วัดความยาวเพลงที่ server (ตอนนี้ใช้ค่าจากเบราว์เซอร์ที่อัปโหลด)
- [ ] ให้ผู้เล่นขอเพลง / soundboard สำหรับผู้เล่น (ผ่าน permission override)

## Phase 7 — Advanced ✅

- [x] คลังเวท SRD 5.1 (51 บท) + ค้นหา + เพิ่มลงชีต (`srdId` ลิงก์กับข้อมูลเวท)
- [x] ร่ายเวทจากชีต: เลือก slot/upcast/ritual, server ใช้ slot ใต้ row lock, ทอย attack/damage/healing, โพสต์ DC/พื้นที่ลง log
- [x] AoE template: วงกลม/กรวย/เส้น/สี่เหลี่ยม, เล็งทิศ, ไฮไลต์โทเคนที่โดน, realtime, ซ่อนสำหรับ DM, หมุน/ลบ/ล้าง, วางต่อจากการร่ายเวท
- [x] เพลงประจำฉาก (playlist/เพลง) เริ่มเมื่อแสดงฉาก
- [x] ส่งไอเทมระหว่างตัวละคร (แบ่ง/รวม stack, ล็อกทั้งสองชีต)
- [x] Tests: unit (spells, templates), integration `test/phase7.test.ts`, E2E `e2e/phase7.e2e.cjs`
- [x] ลากย้าย template (รอบสอง)
- [x] Concentration tracking: เริ่มเมื่อร่าย, DC Con save เมื่อโดนดาเมจ, หลุดที่ HP 0, ปุ่ม Con save / End
- [ ] หัก HP จากเวทบน token ที่โดนอัตโนมัติ (ตอนนี้ DM ใช้ปุ่ม damage)
- [ ] Concentration ของมอนสเตอร์ bestiary (ไม่มีชีต)
- [ ] เวท SRD ครบทุกบท + เวท homebrew ในคลังของแคมเปญ
- [x] Undo/redo ของตัวเอง: token (วาง/ย้าย/แก้/ลบ), หมอก, template — ปุ่ม + Ctrl+Z/Ctrl+Shift+Z/Ctrl+Y
- [ ] Undo ที่อยู่รอดหลังรีโหลด (เก็บประวัติที่ server)
- [x] Session recap: ร่างจาก log สาธารณะ, แก้, เผยแพร่ให้ผู้เล่น
- [x] Campaign timeline: เซสชัน + เหตุการณ์ในเรื่อง (วันที่ในโลกเกม, ผูกเซสชัน, เฉพาะ DM)
- [x] ~~ร่าง recap ด้วย AI~~ ไม่ทำ (ผู้ใช้อยากให้ใช้ฟรี; ปุ่ม "ร่างจาก log" แบบฟรียังอยู่)
- [x] แก้: ร่ายเวทแบบซ่อนแจ้งเฉพาะ DM
- [ ] Scene templates (export/import JSON)
- [ ] Drawing tools + custom layers
- [ ] Crossfade ระหว่างเพลง

## Phase 8 — Lighting, Voice, AI ✅

- [x] กำแพง / ประตู / ประตูลับ (วาด, ลบ, ล้าง, snap มุมช่อง), ผู้เล่นเปิดประตูที่มองเห็นได้, DM ล็อกประตู
- [x] Vision ต่อฉาก + แสงรอบข้าง (สว่าง/สลัว/มืด) + darkvision + แหล่งแสงบน token (preset)
- [x] Server กรอง token ตาม line of sight + หมอก (ส่งเฉพาะที่มองเห็น), ความมืดบนจอผู้เล่น, DM preview มุมมอง token
- [x] Voice chat WebRTC (mesh ≤12), ปิดไมค์, ไฟคนพูด, ปรับเสียงรายคน, STUN/TURN ตั้งได้
- [x] AI ผู้ช่วย DM 7 โหมด ผ่าน Claude Code ในเครื่อง (ฟรี) หรือ API key, บันทึกลง journal, DM เท่านั้น, จำกัดครั้ง/ชม.
- [x] Tests: unit `vision.test.ts`, integration `phase8.test.ts` + `aiAssistant.test.ts`, E2E `e2e/phase8.e2e.cjs`
- [ ] แสงมีสี / เงานุ่ม / แสงกระพริบ
- [ ] หน้าต่าง (มองทะลุแต่เดินผ่านไม่ได้) และกำแพงทางเดียว
- [ ] Token เดินชนกำแพงไม่ได้ (ตอนนี้กำแพงกันแค่การมองเห็น)
- [ ] จำพื้นที่ที่เคยเห็นแล้ว (explored fog)
- [ ] Push-to-talk, voice แบบ SFU สำหรับโต๊ะใหญ่

## Phase 9 — Polish + พร้อมเล่น ✅

- [x] `pnpm play` / `start-windows.bat`: ฐานข้อมูลในตัว (ไม่ต้องติดตั้ง Postgres), migration, เสิร์ฟเว็บ, เปิดเบราว์เซอร์
- [x] `setup-windows.bat`, `play-online-windows.bat` (Cloudflare quick tunnel), `.env.play.example`
- [x] รองรับ tunnel: origin/secure cookie/X-Forwarded-* จาก localhost
- [x] Claude Code บน Windows (`claude.exe` และ npm `claude.cmd`)
- [x] Lazy load ทุกหน้า (ไฟล์แรก 564KB → 332KB)
- [x] Security review: audit dependencies, ทบทวนสิทธิ์ endpoint ใหม่
- [x] คู่มือภาษาไทย `docs/PLAY_ONLINE.md`
- [ ] ทดสอบไฟล์ .bat บน Windows จริง (ผู้ใช้ทดลองเอง — ทดสอบ launcher บน Linux แล้ว)
- [ ] ลิงก์ออนไลน์แบบถาวร (Cloudflare named tunnel + โดเมน) — ต้องมีบัญชี/โดเมนของผู้ใช้
- [ ] แปลภาษาไทยหน้าที่เหลือ (Lobby, Dashboard, Character sheet) — ดูหัวข้อ i18n ด้านบน
- [ ] Accessibility pass (keyboard บน canvas, screen reader)
- [ ] สำรองข้อมูลอัตโนมัติ (ตอนนี้ copy โฟลเดอร์ `data` เอง)

## Campaign packs ✅
- [x] นำเข้าแคมเปญจากไฟล์ .zip (campaign.json + รูป) — ดู docs/CAMPAIGN_PACKS.md
- [x] ปุ่ม "Import campaign (.zip)" ในหน้า Dashboard
- [ ] ส่งออกแคมเปญเป็น .zip (export) — ยังไม่ทำ
