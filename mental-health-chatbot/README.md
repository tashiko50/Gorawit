# ที่ปรึกษาใจ — Mental Health AI Chatbot (prototype)

โปรเจกต์นี้แยกจาก Run Mile โดยสมบูรณ์ — คนละ `package.json`, คนละ server, คนละ deployment ไม่มีการใช้ทรัพยากรร่วมกัน

Chat UI ธรรมดา คุยกับ Groq API ผ่าน Express server ตัวเล็กที่ทำหน้าที่แค่ proxy คำขอไปยัง Groq แล้วส่งคำตอบกลับ

## หลักการเรื่องความเป็นส่วนตัว

- **ไม่มี database ในระบบนี้เลย** ไม่มีการเชื่อมต่อ หรือติดตั้ง database ใดๆ
- บทสนทนาเก็บอยู่ใน JavaScript variable ของหน้าเว็บ (`public/app.js`) เท่านั้น — ไม่ใช้ `localStorage`/`sessionStorage`/cookie ตั้งใจให้รีเฟรชหรือออกจากหน้าเว็บแล้วข้อมูลหายทันที
- ทุกครั้งที่ส่งข้อความ ฝั่ง client จะส่งบทสนทนาทั้งหมดไปให้ server ทุกครั้ง (เพราะ server ไม่มี memory ของใครเลย) แล้ว server forward ต่อไป Groq API ตรงๆ
- `server.js` ไม่ log เนื้อหาข้อความผู้ใช้ ("Warning" ที่ log มีแค่ error/สถานะ ไม่มีเนื้อหาแชท)
- ข้อจำกัดที่ควรรู้: ข้อความยังถูกส่งผ่าน Groq's API เพื่อประมวลผล ควรอ่านนโยบาย data retention ของ Groq เอง ก่อนใช้งานจริงกับคนอื่น

## ความปลอดภัยเนื้อหา (สำคัญ อย่าตัดออก)

- มี disclaimer แสดงตลอดว่า AI นี้ไม่ใช่นักจิตวิทยา/แพทย์จริง
- มี crisis-keyword detection (`CRISIS_PATTERNS` ใน `server.js`) ตรวจข้อความล่าสุดของผู้ใช้ ถ้าเข้าเงื่อนไข จะแสดงข้อความสายด่วน (1323 / 1669) เพิ่มต่อท้ายคำตอบของ AI เสมอ ไม่ว่า model จะตอบว่าอะไร — เพิ่ม/แก้คำในลิสต์นี้ได้ตามต้องการ

## Setup

### 1. ขอ Groq API key

1. เข้า https://console.groq.com ด้วยอีเมล/Google account ที่จะใช้ — ไม่ต้องผูกบัตร ไม่ต้องผ่าน billing
2. ไปเมนู "API Keys" → กด "Create API Key" → ตั้งชื่อ (เช่น `mental-health-chatbot`) → copy key ที่ได้ (ขึ้นต้นด้วย `gsk_...`)
3. ห้าม commit key ลง git — ใช้ environment variable เท่านั้น

### 2. รันในเครื่อง

```bash
cd mental-health-chatbot
npm install
cp .env.example .env   # แล้วใส่ GROQ_API_KEY ใน .env
GROQ_API_KEY=<your-key> npm start
```

เปิด `http://localhost:3001/`

### 3. Deploy ฟรีบน Render.com

1. Push โค้ดนี้ขึ้น GitHub (repo เดียวกับ Run Mile ก็ได้ เพราะอยู่คนละโฟลเดอร์ แต่ตั้งเป็น **Web Service คนละตัว**)
2. สร้าง Web Service ใหม่ใน Render → เชื่อม repo นี้
3. **Root Directory**: `mental-health-chatbot` (สำคัญ — ไม่งั้น Render จะพยายาม build จาก root ของ repo ที่เป็น Run Mile)
4. Build command: `npm install`, Start command: `npm start`
5. Environment Variable: `GROQ_API_KEY=<your-key>` (และ `GROQ_MODEL` ถ้าต้องการเปลี่ยนจาก default)
6. Deploy เสร็จจะได้ URL แยกของตัวเอง คนละ URL จาก Run Mile

## ข้อจำกัดที่ควรรู้ก่อนใช้จริงกับคนอื่น

- Groq free tier มี rate limit ต่อนาที/วัน — ถ้ามีคนใช้พร้อมกันมากอาจเจอ error ชั่วคราว และนโยบายฟรีอาจเปลี่ยนแปลงได้ในอนาคต ควรเช็คหน้า pricing ของ Groq เป็นระยะ
- คุณภาพคำตอบของ open-source model (Llama 3.3) ยังไม่เท่า model ปิดระดับสูงสุด สำหรับเรื่อง sensitive อย่างสุขภาพจิต ควรทดสอบคุยเองหลายรอบก่อนแจกลิงก์ให้คนอื่นใช้
- นี่คือ prototype สำหรับทดลอง ไม่ใช่บริการทางการแพทย์ — ไม่ควรใช้แทนการรักษาจริง
