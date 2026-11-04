# Technical Risks

| # | ความเสี่ยง | ผลกระทบ | แนวทางรับมือ |
| --- | --- | --- | --- |
| 1 | **Realtime scale-out** — presence/rooms อยู่ใน memory ของ process เดียว | รันหลาย instance แล้ว presence/broadcast ไม่ครบ | ใช้ `@socket.io/redis-adapter` + presence ใน Redis (TTL) + sticky sessions; interface `Realtime` แยกไว้แล้ว |
| 2 | **Canvas performance** กับแผนที่ใหญ่ + token หลายร้อย | กระตุกบนเครื่องผู้เล่น | Konva (Canvas2D) แยก layer (พื้นหลัง/token/หมอก/overlay), วาด grid เฉพาะส่วนที่มองเห็น, จำกัด 500 token/scene; ถ้าไม่พอ → ย้าย layer หนักไป WebGL, texture tiling รูปใหญ่, broadcast การลากแบบ throttle (~20Hz) |
| 3 | **Conflict ใน multiplayer** (DM กับผู้เล่นลาก token เดียวกัน, undo ข้ามคน) | state ไม่ตรงกัน | server-authoritative + version ต่อ entity; การกระทำเป็น command ที่ validate แล้ว; undo จำกัดเฉพาะ command ของตัวเอง/ที่มีสิทธิ์ |
| 4 | **Fog of War / Vision รั่ว** ถ้าส่งทั้งแผนที่ให้ client | ผู้เล่นเห็นข้อมูลลับผ่าน devtools | ✅ token ในหมอก/ซ่อน/DM layer ถูกกรองที่ server ต่อผู้รับ. **ข้อจำกัดที่เหลือ:** รูปพื้นหลังแผนที่ส่งทั้งภาพ และรูปทรงหมอกส่งให้ผู้เล่น (เพื่อวาด) → ผู้เล่นที่เปิด devtools เห็นภาพแผนที่ส่วนที่ยังไม่เปิดได้ (เหมือน VTT ส่วนใหญ่). ทางแก้ถ้าต้องการ: server-side masked tiles (Phase 9) |
| 5 | **Character import (OCR/AI)** แม่นยำต่ำกับ layout หลากหลาย / AI เดา | ข้อมูลผิดโดยไม่รู้ตัว | pipeline: extract → field + confidence + "unknown" → ผู้ใช้ review ทุก field → validate ด้วย Zod/ruleset; ห้าม auto-save; AI เป็น provider interface + fallback manual |
| 6 | **ลิขสิทธิ์เนื้อหา** (spell/monster/class text) | ความเสี่ยงทางกฎหมาย | ใช้เฉพาะ SRD 5.1/5.2 (CC-BY-4.0) + attribution; ทุก content มี `source`; homebrew ของผู้ใช้เป็นส่วนตัวโดย default |
| 7 | **ความต่างของกฎ 2014 vs 2024** | คำนวณผิดเวอร์ชัน | Ruleset เป็น data แยกชุด, character ผูก `ruleset_id`, ไม่ให้เลือก character ต่าง ruleset เข้าแคมเปญ, test แยกต่อ ruleset |
| 8 | **Asset upload ไม่ปลอดภัย** | XSS ผ่าน SVG, ไฟล์ใหญ่, malware | ✅ magic bytes allowlist, ไม่รับ SVG, จำกัดขนาด, `nosniff` + `inline`. ยังไม่มี: quota ต่อ user, re-encode/strip EXIF, domain แยกสำหรับไฟล์, S3 backend |
| 9 | **Audio sync** latency ต่างกันในแต่ละ client | เพลงไม่พร้อมกัน | sync ด้วย server timestamp + position; ยอมรับ drift เล็กน้อย; volume เป็นของผู้เล่นเสมอ |
| 10 | **Bundle size** (main ~536KB, table chunk ~366KB min) | โหลดช้าบนมือถือ | ✅ หน้าโต๊ะ (Konva) lazy load แล้ว; ต่อไป: split หน้า character sheet, ตัด zod schemas ที่ client ไม่ใช้ |
| 11 | **Guest abuse** (สร้าง guest จำนวนมาก) | spam / DB โต | rate limit ต่อ IP (มีแล้ว), guest หมดอายุ 7 วัน, job ลบ guest หมดอายุ (ยังไม่ทำ — ต้องเพิ่ม cron) |
| 12 | **Voice chat** ซับซ้อน (NAT/TURN) | ต้นทุน + เวลา | ทำเป็น optional module ผ่านบริการภายนอก (LiveKit ฯลฯ) ไม่เป็น dependency ของระบบหลัก |
| 13 | **Undo/Redo** ใน multiplayer | ย้อนข้อมูลคนอื่น | operation log ต่อ entity + ตรวจ precondition (version) ก่อน undo; ไม่ทำ global undo |

## Dependency notes

- Prisma ถูกพิจารณาแต่เลือก **Drizzle** (ดู DECISIONS.md #2) — ไม่มี binary engine, migration เป็น SQL ที่อ่านได้
- ทุก dependency เป็น open-source license ที่ใช้เชิงพาณิชย์ได้ (MIT/Apache/ISC/BSD)
- ไม่มี API key ใดๆ ในโค้ด; AI/OAuth/S3 จะอ่านจาก env ฝั่ง server เท่านั้น
