# Technical Risks

| # | ความเสี่ยง | ผลกระทบ | แนวทางรับมือ |
| --- | --- | --- | --- |
| 1 | **Realtime scale-out** — presence/rooms อยู่ใน memory ของ process เดียว | รันหลาย instance แล้ว presence/broadcast ไม่ครบ | ใช้ `@socket.io/redis-adapter` + presence ใน Redis (TTL) + sticky sessions; interface `Realtime` แยกไว้แล้ว |
| 2 | **Canvas performance** กับแผนที่ใหญ่ + token หลายร้อย | กระตุกบนเครื่องผู้เล่น | PixiJS (WebGL), texture tiling สำหรับรูปใหญ่, viewport culling, throttle การ broadcast การลาก (~20Hz) + interpolation |
| 3 | **Conflict ใน multiplayer** (DM กับผู้เล่นลาก token เดียวกัน, undo ข้ามคน) | state ไม่ตรงกัน | server-authoritative + version ต่อ entity; การกระทำเป็น command ที่ validate แล้ว; undo จำกัดเฉพาะ command ของตัวเอง/ที่มีสิทธิ์ |
| 4 | **Fog of War / Vision รั่ว** ถ้าส่งทั้งแผนที่ให้ client | ผู้เล่นเห็นข้อมูลลับผ่าน devtools | คำนวณสิ่งที่มองเห็นที่ server; ส่งเฉพาะ token/region ที่ visible; dynamic lighting ทำทีหลัง (Phase 8) ด้วย LOS ที่ server |
| 5 | **Character import (OCR/AI)** แม่นยำต่ำกับ layout หลากหลาย / AI เดา | ข้อมูลผิดโดยไม่รู้ตัว | pipeline: extract → field + confidence + "unknown" → ผู้ใช้ review ทุก field → validate ด้วย Zod/ruleset; ห้าม auto-save; AI เป็น provider interface + fallback manual |
| 6 | **ลิขสิทธิ์เนื้อหา** (spell/monster/class text) | ความเสี่ยงทางกฎหมาย | ใช้เฉพาะ SRD 5.1/5.2 (CC-BY-4.0) + attribution; ทุก content มี `source`; homebrew ของผู้ใช้เป็นส่วนตัวโดย default |
| 7 | **ความต่างของกฎ 2014 vs 2024** | คำนวณผิดเวอร์ชัน | Ruleset เป็น data แยกชุด, character ผูก `ruleset_id`, ไม่ให้เลือก character ต่าง ruleset เข้าแคมเปญ, test แยกต่อ ruleset |
| 8 | **Asset upload ไม่ปลอดภัย** (Phase 2) | XSS ผ่าน SVG, ไฟล์ใหญ่, malware | allowlist MIME + magic bytes, ไม่รับ SVG (หรือ sanitize), จำกัดขนาด, เสิร์ฟจาก domain แยก + `Content-Disposition`, quota ต่อ user (guest ต่ำกว่า) |
| 9 | **Audio sync** latency ต่างกันในแต่ละ client | เพลงไม่พร้อมกัน | sync ด้วย server timestamp + position; ยอมรับ drift เล็กน้อย; volume เป็นของผู้เล่นเสมอ |
| 10 | **Bundle size** (ตอนนี้ ~520KB min) | โหลดช้าบนมือถือ | code-split ตาม route (lazy), แยก zod schemas ที่ client ไม่ใช้, PixiJS lazy load เฉพาะหน้าโต๊ะ |
| 11 | **Guest abuse** (สร้าง guest จำนวนมาก) | spam / DB โต | rate limit ต่อ IP (มีแล้ว), guest หมดอายุ 7 วัน, job ลบ guest หมดอายุ (ยังไม่ทำ — ต้องเพิ่ม cron) |
| 12 | **Voice chat** ซับซ้อน (NAT/TURN) | ต้นทุน + เวลา | ทำเป็น optional module ผ่านบริการภายนอก (LiveKit ฯลฯ) ไม่เป็น dependency ของระบบหลัก |
| 13 | **Undo/Redo** ใน multiplayer | ย้อนข้อมูลคนอื่น | operation log ต่อ entity + ตรวจ precondition (version) ก่อน undo; ไม่ทำ global undo |

## Dependency notes

- Prisma ถูกพิจารณาแต่เลือก **Drizzle** (ดู DECISIONS.md #2) — ไม่มี binary engine, migration เป็น SQL ที่อ่านได้
- ทุก dependency เป็น open-source license ที่ใช้เชิงพาณิชย์ได้ (MIT/Apache/ISC/BSD)
- ไม่มี API key ใดๆ ในโค้ด; AI/OAuth/S3 จะอ่านจาก env ฝั่ง server เท่านั้น
