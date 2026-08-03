# TDFB Pulse Survey

แบบสำรวจกิจกรรมรายไตรมาส + dashboard สด สำหรับทีม GM/HR — พนักงานล็อกอินด้วยอีเมล `@tdfb.co` ผ่าน Google, ตอบแบบสำรวจ, ทีม GM/HR เห็นคะแนนเฉลี่ยแต่ละหัวข้อ + คอมเมนต์ อัปเดตสดทันทีที่มีคนตอบ

ต่างจาก **Run Mile** (โปรเจกต์ในโฟลเดอร์หลักของ repo นี้) ตรงที่ตัวนี้มีการล็อกอินจริงและบันทึกข้อมูลลงฐานข้อมูล ไม่ได้อ่านจาก Google Sheet เฉยๆ — จึงแยกเป็นแอปคนละตัว, deploy แยกกันได้, ไม่กระทบ Run Mile ที่ใช้งานอยู่

## หน้าเว็บที่มี

| หน้า | ใครเข้าได้ | ทำอะไร |
|---|---|---|
| `/login.html` | ทุกคน | เข้าสู่ระบบด้วย Google (ต้องเป็น @tdfb.co) |
| `/survey.html` | พนักงานทุกคน | ตอบแบบสำรวจกิจกรรมที่เปิดอยู่ (ให้คะแนนแต่ละหัวข้อ 1–5 + ความเห็นปลายเปิด) |
| `/dashboard.html` | อีเมลใน `ADMIN_EMAILS` เท่านั้น | ดูคะแนนเฉลี่ยเรียงจากสูง→ต่ำ + คอมเมนต์ล่าสุด |
| `/admin.html` | อีเมลใน `ADMIN_EMAILS` เท่านั้น | สร้างกิจกรรม/ไตรมาสใหม่ พร้อมกำหนดหัวข้อที่จะให้คะแนนเอง (ไม่ต้องแก้โค้ด) |

## ต้องตั้งค่าอะไรก่อนใช้งานได้จริง (ทำครั้งเดียว)

### 1. สร้าง Supabase project (ที่เก็บข้อมูล, ฟรี)

1. ไปที่ [supabase.com](https://supabase.com) → สร้างโปรเจกต์ใหม่
2. เปิด **SQL Editor** → คัดลอกเนื้อหาทั้งหมดใน [`db/schema.sql`](db/schema.sql) → รัน (จะสร้างตาราง + กิจกรรมตัวอย่าง 1 อัน ให้ทดสอบได้ทันที)
3. ไปที่ **Settings → API** → คัดลอก `Project URL` และ `service_role` key (ไม่ใช่ `anon` key) มาใส่ใน `.env`

### 2. สร้าง Google OAuth Client (สำหรับปุ่ม "เข้าสู่ระบบด้วย Google")

1. ไปที่ [Google Cloud Console](https://console.cloud.google.com/) → สร้างโปรเจกต์ (หรือใช้โปรเจกต์เดิมของบริษัท)
2. **APIs & Services → OAuth consent screen** → เลือก Internal (ถ้า Workspace รองรับ) หรือ External + จำกัดผ่านการเช็คโดเมนในโค้ด (มีอยู่แล้ว)
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID** → เลือก **Web application**
4. ใส่ **Authorized JavaScript origins** เป็น URL ที่จะ deploy จริง เช่น `https://tdfb-pulse.onrender.com` (และ `http://localhost:3000` ตอน dev)
5. คัดลอก **Client ID** มาใส่ใน `.env` เป็น `GOOGLE_CLIENT_ID` (ไม่ต้องใช้ Client Secret เพราะฝั่งนี้ใช้วิธียืนยันตัวตนแบบ ID token ไม่ต้องแลก token ฝั่ง server)

### 3. ตั้งไฟล์ `.env`

```bash
cp .env.example .env
# แก้ค่าใน .env ให้ครบ: SESSION_SECRET, ADMIN_EMAILS, GOOGLE_CLIENT_ID, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
```

`ADMIN_EMAILS` คือรายชื่ออีเมลของทีม GM/HR ที่จะเห็นหน้า dashboard/admin (คั่นด้วย comma) — พนักงานที่ไม่อยู่ในลิสต์นี้จะเห็นแค่หน้าแบบสำรวจ

## รันในเครื่อง

```bash
npm install
npm start
```

เปิด `http://localhost:3000/`

## Deploy จริง (แนะนำ Render.com เหมือน Run Mile)

1. Push โค้ดขึ้น GitHub (repo เดียวกันได้ ไม่ชนกับ Run Mile เพราะอยู่คนละโฟลเดอร์)
2. สร้าง **Web Service** ใหม่ใน Render → เชื่อม repo นี้ → ตั้ง **Root Directory** เป็น `pulse-survey`
3. Build command: `npm install`, Start command: `npm start`
4. ใส่ Environment Variables ทั้งหมดจาก `.env` (Render มีหน้าให้กรอกทีละตัว)
5. Deploy เสร็จจะได้ URL เช่น `https://tdfb-pulse.onrender.com` — เอา URL นี้ไปเพิ่มใน Google OAuth Client (ขั้นตอนที่ 2.4) ด้วย ไม่งั้นปุ่มล็อกอินจะ error

## เปิดกิจกรรมใหม่ทุกไตรมาส (ไม่ต้องพึ่งโปรแกรมเมอร์)

ทีม GM/HR ล็อกอินแล้วไปที่ `/admin.html` → กรอกชื่อกิจกรรม, ไตรมาส, และหัวข้อที่อยากให้คะแนน → กด "สร้างกิจกรรม" ระบบจะปิดกิจกรรมก่อนหน้าอัตโนมัติและเปิดอันใหม่ให้พนักงานตอบต่อ

## ข้อจำกัดที่ควรรู้ (MVP)

- Session เก็บใน signed cookie ฝั่ง browser (ไม่มี server-side session store) — ปลอดภัยพอสำหรับขนาดนี้ แต่ถ้าเปลี่ยน `SESSION_SECRET` ทุกคนจะต้องล็อกอินใหม่
- Render free tier จะ "sleep" เมื่อไม่มีคนใช้นานๆ ทำให้เปิดครั้งแรกช้าไม่กี่วินาที — ไม่กระทบข้อมูล
- ยังไม่มีปุ่มลบ/แก้ไขกิจกรรมเก่าจากหน้าเว็บ (ทำผ่าน Supabase Table Editor ได้โดยตรงถ้าจำเป็น)
