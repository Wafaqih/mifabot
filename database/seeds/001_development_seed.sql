-- Development seed for local testing. Safe to run repeatedly.

BEGIN;
SET LOCAL search_path TO mifabot, public;

INSERT INTO roles (kode, nama, deskripsi) VALUES
    ('SUPER_ADMIN', 'Super Admin', 'Akses penuh sistem'),
    ('ADMIN', 'Admin', 'Admin operasional'),
    ('USER', 'User', 'Santri atau murid')
ON CONFLICT (kode) DO NOTHING;

INSERT INTO permissions (kode, nama, deskripsi) VALUES
    ('USER_PROFILE_VIEW', 'Lihat profil sendiri', 'Melihat profil milik sendiri'),
    ('USER_BILL_VIEW', 'Lihat tagihan sendiri', 'Melihat tagihan milik sendiri'),
    ('PAYMENT_CREATE', 'Buat pembayaran', 'Mencatat atau mengajukan pembayaran'),
    ('PAYMENT_VERIFY', 'Verifikasi pembayaran', 'Menyetujui pembayaran user'),
    ('PAYMENT_REJECT', 'Tolak pembayaran', 'Menolak pembayaran user'),
    ('REPORT_VIEW', 'Lihat laporan', 'Melihat laporan pembayaran'),
    ('REPORT_EXPORT', 'Ekspor laporan', 'Mengekspor laporan pembayaran'),
    ('USER_CREATE', 'Buat user', 'Menambahkan user'),
    ('USER_UPDATE', 'Ubah user', 'Mengubah data user'),
    ('USER_DEACTIVATE', 'Nonaktifkan user', 'Menonaktifkan user'),
    ('ADMIN_ASSIGN', 'Atur admin', 'Mengatur penugasan admin')
ON CONFLICT (kode) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r CROSS JOIN permissions p
WHERE r.kode = 'SUPER_ADMIN'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r JOIN permissions p ON p.kode IN (
    'USER_PROFILE_VIEW', 'USER_BILL_VIEW', 'PAYMENT_CREATE',
    'PAYMENT_VERIFY', 'PAYMENT_REJECT', 'REPORT_VIEW', 'REPORT_EXPORT'
)
WHERE r.kode = 'ADMIN'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r JOIN permissions p ON p.kode IN (
    'USER_PROFILE_VIEW', 'USER_BILL_VIEW', 'PAYMENT_CREATE'
)
WHERE r.kode = 'USER'
ON CONFLICT DO NOTHING;

INSERT INTO users (role_id, nama_lengkap, username, jenis_kelamin, nomor_whatsapp)
SELECT r.id, seed.nama_lengkap, seed.username, seed.jenis_kelamin::jenis_kelamin, seed.nomor_whatsapp
FROM roles r
CROSS JOIN (VALUES
    ('Mang Faqih', 'faqih', 'L', '628111000001'),
    ('Teh Ayu', 'ayu', 'P', '628111000002'),
    ('Mang Hasan', 'hasan', 'L', '628111000003'),
    ('Teh Aisyah', 'aisyah', 'P', '628111000004'),
    ('Mang Deni', 'deni', 'L', '628111000005'),
    ('Teh Rina', 'rina', 'P', '628111000006')
) AS seed(nama_lengkap, username, jenis_kelamin, nomor_whatsapp)
WHERE r.kode = 'ADMIN'
ON CONFLICT (username) DO UPDATE SET
    nama_lengkap = EXCLUDED.nama_lengkap,
    jenis_kelamin = EXCLUDED.jenis_kelamin,
    nomor_whatsapp = EXCLUDED.nomor_whatsapp,
    status = 'AKTIF';

INSERT INTO users (role_id, nama_lengkap, username, jenis_kelamin, nomor_whatsapp)
SELECT r.id, seed.nama_lengkap, seed.username, seed.jenis_kelamin::jenis_kelamin, seed.nomor_whatsapp
FROM roles r
CROSS JOIN (VALUES
    ('Budi Santoso', 'budi', 'L', '628121000001'),
    ('Siti Aminah', 'siti', 'P', '628121000002'),
    ('Andi Pratama', 'andi', 'L', '628121000003')
) AS seed(nama_lengkap, username, jenis_kelamin, nomor_whatsapp)
WHERE r.kode = 'USER'
ON CONFLICT (username) DO UPDATE SET
    nama_lengkap = EXCLUDED.nama_lengkap,
    jenis_kelamin = EXCLUDED.jenis_kelamin,
    nomor_whatsapp = EXCLUDED.nomor_whatsapp,
    status = 'AKTIF';

-- Kept only as legacy-bridge data.  Current payment routing uses PJ tagihan
-- below, not admin_assignments.
INSERT INTO admin_assignments (user_id, jenis_penugasan, jenis_kelamin, unit_kode)
SELECT u.id, seed.jenis_penugasan::jenis_penugasan_admin, seed.jenis_kelamin::jenis_kelamin,
       seed.unit_kode
FROM (VALUES
    ('faqih', 'BENDAHARA', 'L', 'BENDAHARA_1'),
    ('ayu', 'BENDAHARA', 'P', 'BENDAHARA_2'),
    ('hasan', 'PENDIDIKAN', 'L', 'PENDIDIKAN_1'),
    ('aisyah', 'PENDIDIKAN', 'P', 'PENDIDIKAN_2'),
    ('deni', 'KESEJAHTERAAN', 'L', 'KESEJAHTERAAN_1'),
    ('rina', 'KESEJAHTERAAN', 'P', 'KESEJAHTERAAN_2')
) AS seed(username, jenis_penugasan, jenis_kelamin, unit_kode)
JOIN users u ON u.username = seed.username
WHERE NOT EXISTS (
    SELECT 1 FROM admin_assignments aa
    WHERE aa.user_id = u.id AND aa.is_active
);

INSERT INTO payment_channels (admin_user_id, nama, metode, nomor_rekening, nama_pemilik, urutan)
SELECT u.id, seed.nama, seed.metode::jenis_metode_pembayaran, seed.nomor_rekening, seed.nama_pemilik, seed.urutan
FROM (VALUES
    ('faqih', 'Dana Faqih', 'DANA', '081234567890', 'Faqih', 1),
    ('faqih', 'Rekening BRI Faqih', 'BANK_TRANSFER', '1234567890', 'Faqih', 2),
    ('faqih', 'Cash Bendahara 1', 'CASH', NULL, 'Faqih', 3),
    ('ayu', 'Dana Ayu', 'DANA', '081298765432', 'Ayu', 4),
    ('ayu', 'Rekening BCA Ayu', 'BANK_TRANSFER', '9876543210', 'Ayu', 5),
    ('ayu', 'Cash Bendahara 2', 'CASH', NULL, 'Ayu', 6)
) AS seed(username, nama, metode, nomor_rekening, nama_pemilik, urutan)
JOIN users u ON u.username = seed.username
WHERE NOT EXISTS (
    SELECT 1 FROM payment_channels pc
    WHERE pc.admin_user_id = u.id AND pc.nama = seed.nama
);

-- Dynamic definitions created by migration 005 receive a global nominal.
-- A special nominal for Andi demonstrates the student-level override model.
INSERT INTO billing_definition_rates (billing_definition_id, nominal, berlaku_mulai)
SELECT d.id, seed.nominal, seed.berlaku_mulai
FROM (VALUES
    ('Bulanan', 65000::bigint, DATE '2026-01-01'),
    ('Tahunan', 250000::bigint, DATE '2026-01-01'),
    ('Pendidikan', 50000::bigint, DATE '2026-01-01'),
    ('Kesejahteraan', 25000::bigint, DATE '2026-01-01')
) AS seed(nama, nominal, berlaku_mulai)
JOIN billing_definitions d ON d.nama = seed.nama
ON CONFLICT DO NOTHING;

INSERT INTO student_billing_overrides (
    billing_definition_id, user_id, nominal, berlaku_mulai
)
SELECT d.id, u.id, 120000::bigint, DATE '2026-01-01'
FROM billing_definitions d
JOIN users u ON u.username = 'andi'
WHERE d.nama = 'Bulanan'
ON CONFLICT DO NOTHING;

-- More than one PJ may be responsible for a definition.  Payment channels
-- are explicitly linked to a tagihan after the PJ assignment is created.
INSERT INTO billing_definition_responsibles (billing_definition_id, user_id)
SELECT d.id, u.id
FROM (VALUES
    ('Bulanan', 'faqih'),
    ('Bulanan', 'ayu'),
    ('Tahunan', 'faqih'),
    ('Tahunan', 'ayu'),
    ('Pendidikan', 'hasan'),
    ('Pendidikan', 'aisyah'),
    ('Kesejahteraan', 'deni'),
    ('Kesejahteraan', 'rina')
) AS seed(nama_tagihan, username)
JOIN billing_definitions d ON d.nama = seed.nama_tagihan
JOIN users u ON u.username = seed.username
ON CONFLICT (billing_definition_id, user_id) WHERE is_active DO NOTHING;

-- Development data keeps the legacy channels visible only for the tagihan
-- whose PJ owns them.  New channels are linked at creation time by the bot.
INSERT INTO payment_channel_definitions (
    payment_channel_id, billing_definition_id
)
SELECT pc.id, br.billing_definition_id
FROM payment_channels pc
JOIN billing_definition_responsibles br
  ON br.user_id = pc.admin_user_id
 AND br.is_active
ON CONFLICT DO NOTHING;

UPDATE billing_definitions definition
SET is_active = true
WHERE NOT definition.is_active
  AND LOWER(btrim(definition.nama)) NOT IN (
      'bulanan',
      'tahunan',
      'pendidikan',
      'kesejahteraan'
  )
  AND EXISTS (
      SELECT 1
      FROM billing_definition_responsibles responsible
      WHERE responsible.billing_definition_id = definition.id
        AND responsible.is_active
  );

-- Existing monthly reminder behaviour is represented as offsets from the
-- due date: H-4, H-2, and H-0.  Other definitions remain opt-in.
INSERT INTO billing_reminder_rules (billing_definition_id, offset_days)
SELECT d.id, seed.offset_days
FROM billing_definitions d
CROSS JOIN (VALUES (-4::smallint), (-2::smallint), (0::smallint))
    AS seed(offset_days)
WHERE d.kode = 'BULANAN'
ON CONFLICT (billing_definition_id, offset_days) WHERE is_active DO NOTHING;

INSERT INTO bills (
    user_id, billing_definition_id, nama_tagihan_snapshot,
    periode_mulai, periode_selesai, jatuh_tempo, nominal
)
SELECT u.id, d.id, d.nama, seed.periode_mulai, seed.periode_selesai,
       seed.jatuh_tempo, COALESCE(o.nominal, r.nominal)
FROM (VALUES
    ('budi', 'Bulanan', DATE '2026-07-01', DATE '2026-07-31', DATE '2026-07-05'),
    ('budi', 'Bulanan', DATE '2026-08-01', DATE '2026-08-31', DATE '2026-08-05'),
    ('budi', 'Pendidikan', DATE '2026-08-10', DATE '2026-08-16', DATE '2026-08-14'),
    ('budi', 'Pendidikan', DATE '2026-08-17', DATE '2026-08-23', DATE '2026-08-21'),
    ('siti', 'Bulanan', DATE '2026-08-01', DATE '2026-08-31', DATE '2026-08-05'),
    ('andi', 'Bulanan', DATE '2026-08-01', DATE '2026-08-31', DATE '2026-08-05')
) AS seed(username, nama_tagihan, periode_mulai, periode_selesai, jatuh_tempo)
JOIN users u ON u.username = seed.username
JOIN billing_definitions d ON d.nama = seed.nama_tagihan
JOIN LATERAL (
    SELECT nominal
    FROM billing_definition_rates rate
    WHERE rate.billing_definition_id = d.id
      AND rate.berlaku_mulai <= seed.periode_mulai
      AND (rate.berlaku_sampai IS NULL OR rate.berlaku_sampai >= seed.periode_mulai)
    ORDER BY rate.berlaku_mulai DESC
    LIMIT 1
) r ON true
LEFT JOIN LATERAL (
    SELECT nominal
    FROM student_billing_overrides override
    WHERE override.billing_definition_id = d.id
      AND override.user_id = u.id
      AND override.berlaku_mulai <= seed.periode_mulai
      AND (override.berlaku_sampai IS NULL OR override.berlaku_sampai >= seed.periode_mulai)
    ORDER BY override.berlaku_mulai DESC
    LIMIT 1
) o ON true
ON CONFLICT (user_id, billing_definition_id, periode_mulai, periode_selesai) DO NOTHING;

COMMIT;
