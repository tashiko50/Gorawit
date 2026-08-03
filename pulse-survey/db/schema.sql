-- รันในหน้า Supabase > SQL Editor ครั้งเดียวตอนตั้งโปรเจกต์ใหม่

create extension if not exists "pgcrypto";

create table if not exists activities (
  id uuid primary key default gen_random_uuid(),
  name text not null,                 -- เช่น "Sport Day Q2 2026"
  quarter text not null,               -- เช่น "2026-Q2" (ใช้จัดกลุ่ม/เรียงเทรนด์)
  topics jsonb not null,               -- [{ "key": "overall", "label": "ความพึงพอใจโดยรวม" }, ...]
  is_open boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists responses (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references activities(id) on delete cascade,
  user_email text not null,
  answers jsonb not null,              -- { "overall": 5, "duration": 4, ... }
  praise text,
  ask text,
  submitted_at timestamptz not null default now(),
  unique (activity_id, user_email)      -- 1 คน ตอบได้ 1 ครั้งต่อกิจกรรม (ส่งซ้ำ = แก้คำตอบเดิม)
);

create index if not exists responses_activity_idx on responses (activity_id);

-- พนักงานสายผลิต/คลัง ที่ใช้อีเมลส่วนตัว (เช่น @gmail.com) แทน @tdfb.co — เพิ่มชื่อได้ทีละคนผ่าน /admin.html
-- ไม่ต้องเพิ่มคนที่ใช้ @tdfb.co เพราะทั้งโดเมนได้รับอนุญาตอยู่แล้ว
create table if not exists allowed_emails (
  email text primary key,
  name text,
  created_at timestamptz not null default now()
);

-- เปิดกิจกรรมแรกให้ทดสอบได้ทันที (ลบ/แก้เนื้อหาได้อิสระ หรือสร้างใหม่ผ่านหน้า /admin.html)
insert into activities (name, quarter, topics, is_open)
values (
  'Sport Day Q2 2026',
  '2026-Q2',
  '[
    {"key":"overall",   "label":"ความพึงพอใจโดยรวมต่อกิจกรรม"},
    {"key":"duration",  "label":"ระยะเวลาของกิจกรรม"},
    {"key":"variety",   "label":"ความหลากหลายของกิจกรรม / ชนิดกีฬา"},
    {"key":"fun",       "label":"ความสนุกสนานและบรรยากาศ"},
    {"key":"quantity",  "label":"จำนวนกิจกรรมเพียงพอต่อผู้เข้าร่วม"},
    {"key":"fairness",  "label":"ความยุติธรรมของการแข่งขัน / กติกา"},
    {"key":"venue",     "label":"ความเหมาะสมและความสะอาดของสถานที่"},
    {"key":"snacks",    "label":"ขนม / เครื่องดื่มระหว่างแข่ง"},
    {"key":"dinner",    "label":"อาหารเย็น"},
    {"key":"prizes",    "label":"รางวัล / ของที่ระลึก"},
    {"key":"transport", "label":"การเดินทาง / การจัดรถรับส่ง"},
    {"key":"comms",     "label":"การสื่อสาร ประชาสัมพันธ์ล่วงหน้า"},
    {"key":"nextyear",  "label":"อยากเข้าร่วมกิจกรรมปีหน้า"}
  ]'::jsonb,
  true
);
