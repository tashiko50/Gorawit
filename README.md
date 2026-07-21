# Village Builders Scoreboard

สกอร์บอร์ดหมู่บ้านแบบเรียลไทม์ มี 2 หน้า:

- **`/admin.html`** — แผงควบคุม แก้ไขชื่อทีม คะแนน เหรียญรางวัล ระดับบ้าน และของตกแต่ง (ต้องใส่ PIN)
- **`/view.html`** — หน้าดูอย่างเดียวสำหรับพนักงาน อัปเดตอัตโนมัติทุก ~3 วินาที พร้อมฟีดกิจกรรมล่าสุด

ทั้งสองหน้าคุยกับ Express server ตัวเดียวกัน (`server.js`) ที่เก็บสถานะไว้ที่ไฟล์ `data/state.json` ทำให้ทุกคนที่เปิดลิงก์ ไม่ว่าจะเป็นคนละเครื่องคนละที่ ก็เห็นข้อมูลชุดเดียวกัน

## รันในเครื่อง

```bash
npm install
ADMIN_PIN=ใส่รหัสที่ต้องการ npm start
```

เปิด `http://localhost:3000/admin.html` (ฝั่งควบคุม) และ `http://localhost:3000/view.html` (ฝั่งดูอย่างเดียว)

ถ้าไม่ตั้ง `ADMIN_PIN` ระบบจะใช้ค่า default `0000` — **ห้ามใช้ค่า default ตอน deploy จริง**

## Deploy ให้พนักงานเข้าจากคนละเครื่องได้จริง

โปรเจกต์นี้เป็น Node.js app ธรรมดา (ไม่ใช่หน้าเว็บ static) จึงต้อง deploy ขึ้น hosting ที่รัน Node ได้ต่อเนื่อง เช่น:

### Render.com (แนะนำ ฟรีสำหรับใช้งานเบา ๆ)
1. Push โค้ดนี้ขึ้น GitHub
2. สร้าง **Web Service** ใหม่ใน Render แล้วเชื่อมกับ repo นี้
3. Build command: `npm install`, Start command: `npm start`
4. เพิ่ม Environment Variable: `ADMIN_PIN=<รหัสของคุณ>`
5. เพิ่ม **Persistent Disk** mount ที่ path `/opt/render/project/src/data` (ไม่งั้นข้อมูลจะหายเมื่อ redeploy/restart)
6. Deploy เสร็จจะได้ URL เช่น `https://your-app.onrender.com` — แจกลิงก์ `/admin.html` ให้ทีมงาน และ `/view.html` ให้พนักงาน

### Railway / Fly.io
ขั้นตอนคล้ายกัน:ตั้ง start command เป็น `npm start`, ตั้ง `ADMIN_PIN`, และแนบ volume ให้โฟลเดอร์ `data/` เพื่อไม่ให้คะแนนหายเวลา redeploy

## หมายเหตุด้านความปลอดภัย

- `GET /api/state` เปิดให้ทุกคนอ่านได้ (ใช้สำหรับหน้า View) — อย่าใส่ข้อมูลลับลงในชื่อทีม/บอร์ด
- `POST /api/actions` (แก้ไขข้อมูล) ต้องส่ง PIN ที่ถูกต้องผ่าน header `x-admin-pin` — เปลี่ยน `ADMIN_PIN` เป็นค่าที่คาดเดายากก่อนแจกลิงก์ admin ให้ทีม
- ไม่มีระบบ user/role แยกราย — ใครมี PIN แก้ไขได้ทุกทีม เหมาะกับทีมเล็กที่ไว้ใจกัน ถ้าต้องการแยกสิทธิ์ละเอียดกว่านี้ (เช่น ผู้ดูแลแต่ละทีมแก้ได้แค่ทีมตัวเอง) แจ้งเพิ่มได้
