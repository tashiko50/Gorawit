# ที่ปรึกษาใจ — Mental Health AI Chatbot (prototype)

โปรเจกต์นี้แยกจาก Run Mile โดยสมบูรณ์ — คนละ `package.json`, คนละ server, คนละ deployment ไม่มีการใช้ทรัพยากรร่วมกัน

Chat UI ธรรมดา คุยกับ Gemini API ผ่าน Express server ตัวเล็กที่ทำหน้าที่แค่ proxy คำขอไปยัง Gemini แล้วส่งคำตอบกลับ

## หลักการเรื่องความเป็นส่วนตัว

- **ไม่มี database ในระบบนี้เลย** ไม่มีการเชื่อมต่อ หรือติดตั้ง database ใดๆ
- บทสนทนาเก็บอยู่ใน JavaScript variable ของหน้าเว็บ (`public/app.js`) เท่านั้น — ไม่ใช้ `localStorage`/`sessionStorage`/cookie ตั้งใจให้รีเฟรชหรือออกจากหน้าเว็บแล้วข้อมูลหายทันที
- ทุกครั้งที่ส่งข้อความ ฝั่ง client จะส่งบทสนทนาทั้งหมดไปให้ server ทุกครั้ง (เพราะ server ไม่มี memory ของใครเลย) แล้ว server forward ต่อไป Gemini API ตรงๆ
- `server.js` ไม่ log เนื้อหาข้อความผู้ใช้ ("Warning" ที่ log มีแค่ error/สถานะ ไม่มีเนื้อหาแชท)
- ข้อจำกัดที่ควรรู้: ข้อความยังถูกส่งผ่าน Google's Gemini API เพื่อประมวลผล ควรอ่านนโยบาย data retention ของ Gemini API เอง (สั้นๆ เพื่อ safety monitoring) ก่อนใช้งานจริงกับคนอื่น

## ความปลอดภัยเนื้อหา (สำคัญ อย่าตัดออก)

- มี disclaimer แสดงตลอดว่า AI นี้ไม่ใช่นักจิตวิทยา/แพทย์จริง
- มี crisis-keyword detection (`CRISIS_PATTERNS` ใน `server.js`) ตรวจข้อความล่าสุดของผู้ใช้ ถ้าเข้าเงื่อนไข จะแสดงข้อความสายด่วน (1323 / 1669) เพิ่มต่อท้ายคำตอบของ AI เสมอ ไม่ว่า model จะตอบว่าอะไร — เพิ่ม/แก้คำในลิสต์นี้ได้ตามต้องการ

## Setup

### 1. ขอ Gemini API key

1. เข้า https://aistudio.google.com ด้วย Google account ที่จะใช้ (แนะนำใช้อีเมลแยกจากอีเมลส่วนตัว เพื่อไม่ปนกับ Google One/Gemini Advanced ส่วนตัว — เป็น product คนละตัวกัน ใช้อีเมลไหนก็ได้)
2. กด "Get API key" → สร้าง key ใหม่
3. ห้าม commit key ลง git — ใช้ environment variable เท่านั้น

### 2. รันในเครื่อง

```bash
cd mental-health-chatbot
npm install
cp .env.example .env   # แล้วใส่ GEMINI_API_KEY ใน .env
GEMINI_API_KEY=<your-key> npm start
```

เปิด `http://localhost:3001/`

### 3. Deploy ฟรีบน Render.com

1. Push โค้ดนี้ขึ้น GitHub (repo เดียวกับ Run Mile ก็ได้ เพราะอยู่คนละโฟลเดอร์ แต่ตั้งเป็น **Web Service คนละตัว**)
2. สร้าง Web Service ใหม่ใน Render → เชื่อม repo นี้
3. **Root Directory**: `mental-health-chatbot` (สำคัญ — ไม่งั้น Render จะพยายาม build จาก root ของ repo ที่เป็น Run Mile)
4. Build command: `npm install`, Start command: `npm start`
5. Environment Variable: `GEMINI_API_KEY=<your-key>` (และ `GEMINI_MODEL` ถ้าต้องการเปลี่ยนจาก default)
6. Deploy เสร็จจะได้ URL แยกของตัวเอง คนละ URL จาก Run Mile

## ข้อจำกัดที่ควรรู้ก่อนใช้จริงกับคนอื่น

- Gemini free tier มี rate limit ต่อนาที/วัน — ถ้ามีคนใช้พร้อมกันมากอาจเจอ error ชั่วคราว
- คุณภาพคำตอบของ free-tier model ยังไม่เท่า model ระดับสูงสุด สำหรับเรื่อง sensitive อย่างสุขภาพจิต ควรทดสอบคุยเองหลายรอบก่อนแจกลิงก์ให้คนอื่นใช้
- นี่คือ prototype สำหรับทดลอง ไม่ใช่บริการทางการแพทย์ — ไม่ควรใช้แทนการรักษาจริง
