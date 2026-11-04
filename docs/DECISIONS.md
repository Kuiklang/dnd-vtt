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
