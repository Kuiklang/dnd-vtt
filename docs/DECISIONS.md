# Decision Log

บันทึกการตัดสินใจที่ไม่ได้ระบุไว้ใน spec (ADR แบบย่อ) — แก้ไขได้ถ้าเปลี่ยนใจ

1. **Monorepo pnpm 3 packages** (`rules`, `server`, `web`) — rules ใช้ร่วม client/server โดยไม่ต้อง publish
2. **Drizzle ORM แทน Prisma** — ไม่มี native engine ต้องดาวน์โหลด, query type-safe ใกล้ SQL, migration เป็นไฟล์ SQL ตรวจทานได้,
   partial unique index / `FOR UPDATE` เขียนได้ตรงๆ
3. **Fastify + Socket.IO (ไม่ใช้ Next.js)** — VTT เป็น SPA ที่ต้องการ WebSocket ถาวร; Fastify เร็วและ type-friendly;
   Socket.IO ให้ reconnect/rooms/acks ในตัว; production รันเป็น process เดียวเสิร์ฟทั้งเว็บ+API
4. **Auth เขียนเอง (session cookie + scrypt) แทน Auth.js/Supabase** — Auth.js ผูกกับ Next.js, Supabase เพิ่ม dependency ภายนอก;
   ระบบนี้รองรับ guest/upgrade ได้ตรง requirement; OAuth (Google) เพิ่มได้ด้วยตาราง `user_identities` ภายหลัง
5. **Vite + React SPA** — ไม่ต้องการ SEO, ต้องการ dev loop เร็ว
6. **Character data เป็น JSONB + Zod schema (versioned)** — sheet มีโครงสร้างลึกและเปลี่ยนตาม ruleset;
   ส่วนที่ต้อง query/relational (owner, campaign, kind, ruleset) อยู่ในคอลัมน์ ส่วนที่ต้องการ query ละเอียด (เช่น inventory transfer)
   จะแยกตารางใน Phase 7
7. **ค่าที่คำนวณได้ไม่เก็บใน DB** — derive สดจาก ruleset เสมอ, override เก็บแยกใน `overrides`
8. **Privacy semantics**: `public` = แสดงในหน้า Browse และ join ตรงได้; `invite_only` = ต้องมี code/link;
   `private` = ปิดรับสมาชิกใหม่ทั้งหมด (โต๊ะปิด) — password (ถ้าตั้ง) ใช้กับทุกการ join
9. **Roll visibility**: `public` ทุกคน; `private` ผู้ทอย+DM; `dm_only` เฉพาะ DM (ผู้เล่นทอยไม่ได้); `whisper` ผู้ทอย+ผู้รับ+DM;
   `blind` DM เห็นผล ผู้ทอยเห็นว่าทอยแล้วแต่ไม่เห็นผล
10. **Chat whisper ระหว่างผู้เล่น DM ไม่เห็น** (privacy ของผู้เล่น) — ส่วน whisper *roll* DM เห็น (เพราะเป็นกลไกเกม)
11. **Role hierarchy**: owner > dm > co_dm > player > spectator; จัดการได้เฉพาะคนที่ rank ต่ำกว่า และมอบ role ได้ต่ำกว่าตัวเองเท่านั้น;
    co-DM ทำทุกอย่างของ DM ยกเว้นแก้ settings แคมเปญ; สิทธิ์ DM-only บางอย่าง grant ให้ player ไม่ได้แม้ใช้ override
12. **Guest limits**: อายุ 7 วัน, join ได้, สร้างแคมเปญไม่ได้, ตัวละครสูงสุด 5 ตัว, upgrade เป็นบัญชีจริงได้โดยข้อมูลไม่หาย
13. **ตัวละครต้องใช้ ruleset เดียวกับแคมเปญ** — กันการคำนวณข้ามเวอร์ชัน
14. **Campaign NPC/monster** เป็น character ที่มี `campaign_id`; ผู้เล่นเห็นได้เฉพาะเมื่อ DM เปิด `player_visible` และเห็นแค่ summary
15. **Party members เห็น summary ของ PC คนอื่น** (ชื่อ, class/level, portrait) ไม่เห็น sheet เต็ม; DM เห็นและแก้ได้
16. **ชื่อชั่วคราว "Arcane Table"**, ธีม dark fantasy (ทอง/หมึก/เลือด), ฟอนต์ Cinzel + Inter
17. **รูปภาพใน Phase 1 เป็น https URL** จนกว่า asset storage จะมา (Phase 2) — กัน mixed content / javascript: URL
18. **Konva (Canvas2D) แทน PixiJS** — ผู้ใช้อนุมัติ (2026-11-04). เขียนกับ React ได้ตรง (react-konva), hit-testing/drag ในตัว,
    พอสำหรับ token หลักร้อย; Dynamic lighting หนักๆ (Phase 8) ค่อยแยกเป็น layer WebGL
19. **Scene = Map** ในตอนนี้ — ตาราง `scenes` เก็บแผนที่ + grid + fog + token; Scene Template (Phase 7) จะเป็น snapshot JSON ของ scene
20. **Active scene ต่อแคมเปญ** (`campaigns.active_scene_id`) — ผู้เล่นเห็นได้ทีละ scene; DM เปิดดู/เตรียม scene อื่นได้โดยผู้เล่นไม่เห็น;
    scene แรกที่สร้างกลายเป็น active อัตโนมัติ
21. **Manual fog = รายการรูปทรงเรียงลำดับ** (เปิดทั้งแผนที่เป็นหมอกเมื่อ enable; reveal/hide ทับกัน, อันหลังชนะ) — คำนวณได้ทั้ง client/server
    ด้วยโค้ดเดียวกัน, undo ได้ทีละรูป; Phase 8 vision จะ OR กับ layer นี้
22. **ผู้เล่นวาง token ได้เฉพาะตัวละครของตัวเอง** (1 ตัวต่อ scene) และแก้ได้แค่ตำแหน่ง/การหมุนของ token ที่ตนควบคุมและไม่ถูกล็อก
23. **ผู้เล่นเห็นหมอก "ใต้" token** — server ส่งเฉพาะ token ที่ผู้เล่นมีสิทธิ์เห็น จึงวาดหมอกใต้ token layer ได้ (token ของตัวเองไม่ถูกหมอกบัง); DM เห็นหมอกโปร่งแสงทับทุกอย่าง
24. **Local disk storage ผ่าน `Storage` interface** — dev/single-server; S3/R2 เพิ่มได้โดยไม่แก้ service (ผู้ใช้อนุมัติ)
25. **i18n เขียนเอง (ไม่มี dependency)** — `en.ts` เป็นต้นแบบ key (type-safe), `th.ts` ต้องครบทุก key (มี unit test), ภาษาเก็บใน localStorage,
    ค่าเริ่มต้นตามภาษาของ browser; ศัพท์เกม (AC, HP, DM, Token) คงเป็นอังกฤษ
26. **ใช้ Drizzle** (ไม่เปลี่ยนเป็น Prisma ตามแผนเดิม) — ผู้ใช้ยืนยันแล้ว 2026-11-04; เหตุผลดูข้อ 2
27. **HP ของ PC อยู่บน character sheet ที่เดียว** — token ที่ผูกกับ character อ่าน HP/AC/conditions/defenses จาก sheet และการ damage/heal
    เขียนลง sheet (SELECT … FOR UPDATE + version) ไม่มีสำเนาให้หลุด sync; token ที่ไม่มี sheet (มอนสเตอร์/NPC) เก็บใน `tokens.stats`
28. **Combat หนึ่งรายการต่อแคมเปญ** (partial unique index บน `combats(campaign_id) WHERE status='active'`) — state turn/round อยู่ที่ server,
    `combat:next` ส่ง `expectedVersion` กันกดซ้ำ; ทุก client ได้ `combat:state` ที่กรองแล้วต่อผู้รับ (combatant ที่ซ่อนและ vitals ที่ไม่มีสิทธิ์เห็นถูกตัดออก)
29. **การมองเห็น HP ต่อ token** (`hp_visibility`: everyone / owners / gm) — ค่าเริ่มต้น PC = everyone, อื่นๆ = gm; ใช้ `canSeeTokenVitals` ตัวเดียวกันทั้ง token และ initiative list
30. **Conditions ลดลงตอนจบตาของสิ่งมีชีวิตนั้น** — ง่ายและคาดเดาได้ (ครอบคลุม "until the end of its next turn" ส่วนใหญ่); เงื่อนไขแบบอื่น DM ลบเองได้
31. **มอนสเตอร์ที่ HP = 0 → defeated อัตโนมัติ, PC ไม่** — PC ต้องทอย death save ตามกฎ 5e; DM ยกเลิก defeated ได้
32. **อ่านชีตจาก PDF/รูปด้วย Claude API** (ผู้ใช้เลือก) — เรียกจาก server เท่านั้นผ่าน `SheetExtractor` interface (เปลี่ยน provider ได้),
    structured output ตาม Zod schema ที่หลวม (ให้ AI รายงานสิ่งที่เห็น) แล้ว `sheetToCharacterData` บังคับขอบเขตจริง; ผลเป็น draft เสมอ ไม่บันทึกเอง
33. **Character creator ใช้เฉพาะ SRD 5.1** (race/subrace ที่มีใน SRD, 12 class, Acolyte) + background ของผู้เล่นเอง; ไม่ใส่อุปกรณ์อัตโนมัติ
    เพื่อไม่สร้างเนื้อหาที่ไม่อยู่ใน SRD; ผลลัพธ์เป็น CharacterData ปกติ
34. **Zod jitless ตั้งใน `@vtt/rules`** — เพราะ schema ถูกสร้างตอนโหลด module ซึ่งอาจเกิดก่อนโค้ดของแอป; ทำเฉพาะใน browser (CSP ห้าม eval)
35. **Bestiary เป็นข้อมูลใน `@vtt/rules`** (ไม่ใช่ตารางใน DB) — อ่านได้ทันทีทั้ง client/server, มี test ตรวจความถูกต้องของตัวเลข;
    monster ของแคมเปญเป็น character `kind: monster` ที่มีอยู่แล้ว (ไม่สร้างระบบใหม่)
36. **Token มอนสเตอร์เก็บ HP ของตัวเอง** (ไม่ผูกกับชีต) แม้วางจากชีตแคมเปญ — goblin 3 ตัวต้องเจ็บแยกกัน; ลิงก์ stat block (`stats.statBlock`)
    ใช้เปิด stat block เท่านั้น และถูกตัดออกก่อนส่งให้ผู้เล่น
37. **Journal visibility 4 แบบตรวจที่ server ทั้ง REST, realtime และไฟล์รูป** — "author" เป็นบันทึกส่วนตัวที่ DM ก็ไม่เห็น;
    การ "แสดง handout" = ขยายสิทธิ์อ่าน + push ให้คนที่เลือก (ไม่มีสำเนาแยก)
38. **ไม่มีระดับความยาก encounter** — ตาราง XP threshold/multiplier อยู่ใน DMG ซึ่งไม่ใช่ SRD จึงไม่นำมาใส่; แสดง XP รวมและต่อผู้เล่น
39. **สิทธิ์ใหม่ `journal.manage`, `tables.manage`** (DM/co-DM ได้อัตโนมัติ; `journal.manage` ให้ผู้เล่นผ่าน override ไม่ได้)
40. **เพลงเล่นตามนาฬิกา server** — เก็บ `offsetSec` + เวลา server `at`; client คำนวณตำแหน่งเองและแก้ drift เกิน 1.5 วินาที
    (ไม่ส่งตำแหน่งทุกวินาที); server ตั้ง timer เลื่อนเพลงเมื่อจบ และ normalize ทุกครั้งที่อ่าน จึงถูกต้องแม้ restart
41. **ระดับเสียงเป็นของผู้ฟัง** — DM ตั้งระดับเสียงของช่อง แต่ผู้เล่นคูณด้วยค่าของตัวเองเสมอ (เก็บใน localStorage)
42. **ผู้เล่นไม่เห็นคลังเสียง/คิว** — ชื่อเพลงอาจสปอยล์ (เช่น "Boss reveal"); ได้เฉพาะเพลงที่กำลังเล่น
43. **ใช้สิทธิ์เดิม `music.control`** สำหรับอัปโหลด/คลัง/ควบคุม (DM/co-DM; ให้ผู้เล่นได้ผ่าน override)
44. **เวท SRD เป็นข้อมูลใน `@vtt/rules`** (ไม่ใช่ตารางใน DB) — เป็นเนื้อหาคงที่ ใช้ร่วม client/server; ชีตเก็บแค่ `srdId` ลิงก์
45. **การร่ายเวททำที่ server ทั้งหมด** — ใช้ slot ใต้ row lock แล้วทอยผ่านระบบลูกเต๋าเดิม (visibility เดิม); client ส่งแค่ spellId + ระดับ slot
46. **Template เก็บขนาดเป็นฟุต** และแปลงเป็น px ด้วย grid ของฉาก — เปลี่ยนขนาด grid แล้ว Fireball ยังเป็น 20 ft;
    กรวยใช้กฎ SRD (กว้างเท่าระยะที่ห่างจากจุดเริ่ม), template ซ่อนไม่ถูกส่งให้ผู้เล่นเลย
47. **ส่งไอเทมได้เฉพาะตัวละครที่โต๊ะ** — ตัวละครที่ active ของสมาชิก (+ NPC สำหรับ DM); ล็อกสองชีตตาม id เพื่อกัน deadlock
48. **เพลงประจำฉากเริ่มเฉพาะตอน DM ที่มีสิทธิ์ `music.control` แสดงฉาก** และไม่เริ่มใหม่ถ้าเพลงเดียวกันเล่นอยู่
49. **Undo/redo อยู่ฝั่ง client ต่อคน และย้อนด้วยคำสั่งตรงข้ามผ่าน server** — ไม่มี "rollback" พิเศษที่ข้ามการตรวจสิทธิ์;
    ทุกขั้นถูกตรวจ/บันทึก/broadcast เหมือนการแก้ปกติ; ย้อนได้เฉพาะสิ่งที่ตัวเองทำ; ประวัติล้างเมื่อเปลี่ยนแผนที่
50. **Concentration เก็บในชีต (`data.concentration`)** — server ตั้งค่าเมื่อร่าย, แจ้ง DC เมื่อโดนดาเมจ, ล้างเมื่อ HP 0;
    ไม่ทอย save แทนผู้เล่น (ผู้เล่นกดทอยเองและตัดสินผล) เพื่อให้ตรงกับการเล่นจริง (ผู้เล่นอาจมีความสามารถที่ให้ advantage)
51. **ร่าง recap รวบรวมจาก log สาธารณะเท่านั้น** (system notices + การทอยที่ public) — DM เผยแพร่ได้ทันทีโดยไม่เสี่ยงหลุดความลับ;
    ยังไม่ใช้ AI เพราะมีค่าใช้จ่ายต่อครั้ง (รอผู้ใช้ตัดสินใจ)
52. **ข้อความระบบของการกระทำที่ซ่อน ไปช่อง DM** (`chat.system(..., { dmOnly })`) — ใช้กับการร่ายเวทแบบ dm_only
53. **อ่าน sheet ด้วย Claude Code ในเครื่องได้ (`SHEET_READER=claude-code`)** — ผู้ใช้ไม่ต้องการจ่ายค่า API (ใช้ส่วนตัวกับเพื่อน, DM คนเดียว)
    จึงให้ server เรียก `claude -p` ที่ล็อกอินด้วยแพ็กเกจ Claude ของผู้ใช้ ใช้ได้เฉพาะเมื่อ server รันบนคอมเครื่องนั้น; ให้ Claude Code ใช้ได้แค่ `Read`
    ในโฟลเดอร์ชั่วคราว, ไม่ผ่าน shell, ตรวจผลด้วย schema เดิม; ค่าเริ่มต้นยังเป็น `auto` (ไม่เรียก Claude Code เองโดยไม่ได้ตั้งค่า).
    ไม่ทำร่าง recap ด้วย AI ตามที่ผู้ใช้เลือก
