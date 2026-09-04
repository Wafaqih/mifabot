-- MIFABOT PostgreSQL initial schema
-- Jalankan sekali pada database PostgreSQL 14+ yang kosong.
-- Semua nominal Rupiah disimpan sebagai bigint (tanpa pecahan).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE SCHEMA IF NOT EXISTS mifabot;
SET search_path TO mifabot, public;

CREATE TYPE status_user AS ENUM ('AKTIF', 'NONAKTIF');
CREATE TYPE jenis_kelamin AS ENUM ('L', 'P');
CREATE TYPE jenis_tagihan AS ENUM ('BULANAN', 'TAHUNAN', 'PENDIDIKAN', 'KESEJAHTERAAN');
CREATE TYPE status_tagihan AS ENUM ('BELUM_BAYAR', 'CICIL', 'LUNAS');
CREATE TYPE status_pembayaran AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');
CREATE TYPE ruang_lingkup_pembayaran AS ENUM ('CURRENT_BILL', 'ARREARS');
CREATE TYPE jenis_penugasan_admin AS ENUM ('BENDAHARA', 'PENDIDIKAN', 'KESEJAHTERAAN');
CREATE TYPE status_notifikasi AS ENUM ('PENDING', 'SENT', 'FAILED');

CREATE TABLE roles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kode varchar(50) NOT NULL UNIQUE,
    nama varchar(100) NOT NULL,
    deskripsi text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT roles_kode_format CHECK (kode ~ '^[A-Z][A-Z0-9_]*$')
);

CREATE TABLE permissions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kode varchar(100) NOT NULL UNIQUE,
    nama varchar(150) NOT NULL,
    deskripsi text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT permissions_kode_format CHECK (kode ~ '^[A-Z][A-Z0-9_]*$')
);

CREATE TABLE role_permissions (
    role_id uuid NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
    permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    role_id uuid NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
    nama_lengkap varchar(200) NOT NULL,
    username varchar(60) NOT NULL,
    jenis_kelamin jenis_kelamin NOT NULL,
    nomor_whatsapp varchar(15) NOT NULL,
    status status_user NOT NULL DEFAULT 'AKTIF',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT users_nama_lengkap_tidak_kosong CHECK (btrim(nama_lengkap) <> ''),
    CONSTRAINT users_username_format CHECK (username ~ '^[a-zA-Z0-9._-]{3,60}$'),
    CONSTRAINT users_nomor_whatsapp_e164 CHECK (nomor_whatsapp ~ '^[1-9][0-9]{7,14}$'),
    CONSTRAINT users_username_unik UNIQUE (username),
    CONSTRAINT users_nomor_whatsapp_unik UNIQUE (nomor_whatsapp)
);

CREATE TABLE admin_assignments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    jenis_penugasan jenis_penugasan_admin NOT NULL,
    jenis_kelamin jenis_kelamin NOT NULL,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX admin_assignments_satu_posisi_aktif
    ON admin_assignments (jenis_penugasan, jenis_kelamin)
    WHERE is_active;

CREATE UNIQUE INDEX admin_assignments_satu_penugasan_aktif_per_admin
    ON admin_assignments (user_id)
    WHERE is_active;

CREATE TABLE tariffs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    jenis_tagihan jenis_tagihan NOT NULL,
    nominal bigint NOT NULL,
    berlaku_mulai date NOT NULL,
    berlaku_sampai date,
    dibuat_oleh uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT tariffs_nominal_positif CHECK (nominal > 0),
    CONSTRAINT tariffs_rentang_valid CHECK (berlaku_sampai IS NULL OR berlaku_sampai >= berlaku_mulai),
    EXCLUDE USING gist (
        user_id WITH =,
        jenis_tagihan WITH =,
        daterange(berlaku_mulai, COALESCE(berlaku_sampai, 'infinity'::date), '[]') WITH &&
    )
);

CREATE TABLE bills (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    tariff_id uuid REFERENCES tariffs(id) ON DELETE SET NULL,
    jenis_tagihan jenis_tagihan NOT NULL,
    periode_mulai date NOT NULL,
    periode_selesai date NOT NULL,
    jatuh_tempo date NOT NULL,
    nominal bigint NOT NULL,
    status status_tagihan NOT NULL DEFAULT 'BELUM_BAYAR',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT bills_nominal_positif CHECK (nominal > 0),
    CONSTRAINT bills_periode_valid CHECK (periode_selesai >= periode_mulai),
    CONSTRAINT bills_jatuh_tempo_valid CHECK (jatuh_tempo >= periode_mulai),
    CONSTRAINT bills_periode_unik UNIQUE (user_id, jenis_tagihan, periode_mulai, periode_selesai),
    EXCLUDE USING gist (
        user_id WITH =,
        jenis_tagihan WITH =,
        daterange(periode_mulai, periode_selesai, '[]') WITH &&
    )
);

CREATE TABLE payments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    submitted_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    routed_to_admin_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    verified_by uuid REFERENCES users(id) ON DELETE RESTRICT,
    requested_bill_id uuid REFERENCES bills(id) ON DELETE RESTRICT,
    jenis_tagihan jenis_tagihan NOT NULL,
    ruang_lingkup ruang_lingkup_pembayaran NOT NULL,
    nominal bigint NOT NULL,
    proof_storage_key text NOT NULL,
    source_message_id varchar(255),
    status status_pembayaran NOT NULL DEFAULT 'PENDING',
    submitted_at timestamptz NOT NULL DEFAULT now(),
    verified_at timestamptz,
    rejection_reason text,
    catatan_admin text,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT payments_nominal_positif CHECK (nominal > 0),
    CONSTRAINT payments_bukti_tidak_kosong CHECK (btrim(proof_storage_key) <> ''),
    CONSTRAINT payments_target_sesuai_scope CHECK (
        (ruang_lingkup = 'CURRENT_BILL' AND requested_bill_id IS NOT NULL)
        OR (ruang_lingkup = 'ARREARS' AND requested_bill_id IS NULL)
    ),
    CONSTRAINT payments_keputusan_konsisten CHECK (
        (status = 'PENDING' AND verified_by IS NULL AND verified_at IS NULL AND rejection_reason IS NULL)
        OR (status = 'APPROVED' AND verified_by IS NOT NULL AND verified_at IS NOT NULL AND rejection_reason IS NULL)
        OR (status = 'REJECTED' AND verified_by IS NOT NULL AND verified_at IS NOT NULL AND rejection_reason IS NOT NULL)
        OR (status = 'CANCELLED' AND verified_by IS NULL AND verified_at IS NULL)
    )
);

CREATE UNIQUE INDEX payments_source_message_id_unik
    ON payments (source_message_id)
    WHERE source_message_id IS NOT NULL;

CREATE INDEX payments_antrian_verifikasi_idx
    ON payments (routed_to_admin_id, status, submitted_at)
    WHERE status = 'PENDING';

CREATE INDEX payments_user_status_idx ON payments (user_id, status, submitted_at DESC);

CREATE TABLE payment_allocations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
    bill_id uuid NOT NULL REFERENCES bills(id) ON DELETE RESTRICT,
    nominal_alokasi bigint NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT payment_allocations_nominal_positif CHECK (nominal_alokasi > 0),
    CONSTRAINT payment_allocations_satu_alokasi_per_bill UNIQUE (payment_id, bill_id)
);

CREATE INDEX payment_allocations_bill_idx ON payment_allocations (bill_id);

CREATE TABLE notifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    notification_type varchar(50) NOT NULL,
    message_body text NOT NULL,
    status status_notifikasi NOT NULL DEFAULT 'PENDING',
    related_bill_id uuid REFERENCES bills(id) ON DELETE SET NULL,
    related_payment_id uuid REFERENCES payments(id) ON DELETE SET NULL,
    sent_at timestamptz,
    failure_reason text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT notifications_tipe_tidak_kosong CHECK (btrim(notification_type) <> ''),
    CONSTRAINT notifications_pesan_tidak_kosong CHECK (btrim(message_body) <> ''),
    CONSTRAINT notifications_status_konsisten CHECK (
        (status = 'SENT' AND sent_at IS NOT NULL)
        OR (status IN ('PENDING', 'FAILED') AND sent_at IS NULL)
    )
);

CREATE INDEX notifications_antrian_idx ON notifications (status, created_at) WHERE status = 'PENDING';

CREATE TABLE audit_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    action varchar(100) NOT NULL,
    entity_type varchar(50) NOT NULL,
    entity_id uuid,
    old_data jsonb,
    new_data jsonb,
    request_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT audit_logs_action_tidak_kosong CHECK (btrim(action) <> ''),
    CONSTRAINT audit_logs_entity_type_tidak_kosong CHECK (btrim(entity_type) <> '')
);

CREATE INDEX audit_logs_entitas_idx ON audit_logs (entity_type, entity_id, created_at DESC);
CREATE INDEX audit_logs_pelaku_idx ON audit_logs (actor_user_id, created_at DESC);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER roles_set_updated_at BEFORE UPDATE ON roles
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER permissions_set_updated_at BEFORE UPDATE ON permissions
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER admin_assignments_set_updated_at BEFORE UPDATE ON admin_assignments
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER tariffs_set_updated_at BEFORE UPDATE ON tariffs
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER bills_set_updated_at BEFORE UPDATE ON bills
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER payments_set_updated_at BEFORE UPDATE ON payments
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER notifications_set_updated_at BEFORE UPDATE ON notifications
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION validate_admin_assignment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    kode_role varchar(50);
BEGIN
    SELECT r.kode INTO kode_role
    FROM users u
    JOIN roles r ON r.id = u.role_id
    WHERE u.id = NEW.user_id;

    IF kode_role NOT IN ('ADMIN', 'SUPER_ADMIN') THEN
        RAISE EXCEPTION 'Penugasan admin hanya untuk role ADMIN atau SUPER_ADMIN';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER admin_assignments_validasi_role
BEFORE INSERT OR UPDATE OF user_id ON admin_assignments
FOR EACH ROW EXECUTE FUNCTION validate_admin_assignment();

CREATE OR REPLACE FUNCTION validate_payment_target_and_route()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    bill_user_id uuid;
    bill_jenis jenis_tagihan;
    bill_periode_mulai date;
    bill_periode_selesai date;
    payer_gender jenis_kelamin;
    expected_assignment jenis_penugasan_admin;
BEGIN
    IF NEW.ruang_lingkup = 'CURRENT_BILL' THEN
        SELECT user_id, jenis_tagihan, periode_mulai, periode_selesai
        INTO bill_user_id, bill_jenis, bill_periode_mulai, bill_periode_selesai
        FROM bills
        WHERE id = NEW.requested_bill_id;

        IF NOT FOUND OR bill_user_id <> NEW.user_id OR bill_jenis <> NEW.jenis_tagihan THEN
            RAISE EXCEPTION 'Tagihan target tidak sesuai dengan user atau jenis tagihan pembayaran';
        END IF;

        IF NEW.submitted_at::date NOT BETWEEN bill_periode_mulai AND bill_periode_selesai THEN
            RAISE EXCEPTION 'CURRENT_BILL harus menunjuk tagihan yang sedang berjalan saat diajukan';
        END IF;

        IF NEW.nominal > (
            SELECT b.nominal - COALESCE(SUM(pa.nominal_alokasi), 0)
            FROM bills b
            LEFT JOIN payment_allocations pa ON pa.bill_id = b.id
            WHERE b.id = NEW.requested_bill_id
            GROUP BY b.id, b.nominal
        ) THEN
            RAISE EXCEPTION 'Nominal pembayaran melebihi sisa tagihan berjalan';
        END IF;
    ELSE
        IF NEW.nominal > COALESCE((
            SELECT SUM(b.nominal - COALESCE(alokasi.total_alokasi, 0))
            FROM bills b
            LEFT JOIN LATERAL (
                SELECT SUM(pa.nominal_alokasi) AS total_alokasi
                FROM payment_allocations pa
                WHERE pa.bill_id = b.id
            ) alokasi ON true
            WHERE b.user_id = NEW.user_id
              AND b.jenis_tagihan = NEW.jenis_tagihan
              AND b.periode_selesai < NEW.submitted_at::date
              AND b.nominal > COALESCE(alokasi.total_alokasi, 0)
        ), 0) THEN
            RAISE EXCEPTION 'Nominal pembayaran melebihi total tunggakan';
        END IF;
    END IF;

    SELECT jenis_kelamin INTO payer_gender FROM users WHERE id = NEW.user_id;
    expected_assignment := CASE NEW.jenis_tagihan
        WHEN 'BULANAN' THEN 'BENDAHARA'
        WHEN 'TAHUNAN' THEN 'BENDAHARA'
        WHEN 'PENDIDIKAN' THEN 'PENDIDIKAN'
        WHEN 'KESEJAHTERAAN' THEN 'KESEJAHTERAAN'
    END;

    IF NOT EXISTS (
        SELECT 1
        FROM admin_assignments aa
        WHERE aa.user_id = NEW.routed_to_admin_id
          AND aa.jenis_penugasan = expected_assignment
          AND aa.jenis_kelamin = payer_gender
          AND aa.is_active
    ) THEN
        RAISE EXCEPTION 'Admin tujuan tidak sesuai routing jenis tagihan dan gender user';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER payments_validasi_target_dan_routing
BEFORE INSERT OR UPDATE OF user_id, routed_to_admin_id, requested_bill_id, jenis_tagihan, ruang_lingkup, submitted_at
ON payments
FOR EACH ROW EXECUTE FUNCTION validate_payment_target_and_route();

CREATE OR REPLACE FUNCTION validate_payment_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.status <> 'PENDING' THEN
        RAISE EXCEPTION 'Pembayaran yang telah diputuskan tidak boleh diubah; gunakan proses reversal';
    END IF;

    IF NEW.status NOT IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED') THEN
        RAISE EXCEPTION 'Perubahan status pembayaran tidak valid';
    END IF;

    IF NEW.status IN ('APPROVED', 'REJECTED') AND NEW.verified_by IS NULL THEN
        RAISE EXCEPTION 'Pembayaran yang diputuskan harus memiliki admin verifier';
    END IF;

    IF NEW.status = 'REJECTED' AND COALESCE(btrim(NEW.rejection_reason), '') = '' THEN
        RAISE EXCEPTION 'Pembayaran ditolak harus memiliki alasan penolakan';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER payments_validasi_transisi
BEFORE UPDATE ON payments
FOR EACH ROW EXECUTE FUNCTION validate_payment_transition();

CREATE OR REPLACE FUNCTION validate_payment_allocation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    payment_record payments%ROWTYPE;
    bill_record bills%ROWTYPE;
    total_payment bigint;
    total_bill bigint;
BEGIN
    SELECT * INTO payment_record FROM payments WHERE id = NEW.payment_id FOR UPDATE;
    SELECT * INTO bill_record FROM bills WHERE id = NEW.bill_id FOR UPDATE;

    IF payment_record.status <> 'APPROVED' THEN
        RAISE EXCEPTION 'Hanya pembayaran APPROVED yang dapat dialokasikan';
    END IF;

    IF payment_record.user_id <> bill_record.user_id
       OR payment_record.jenis_tagihan <> bill_record.jenis_tagihan THEN
        RAISE EXCEPTION 'Alokasi harus untuk user dan jenis tagihan yang sama';
    END IF;

    IF payment_record.ruang_lingkup = 'CURRENT_BILL'
       AND payment_record.requested_bill_id <> NEW.bill_id THEN
        RAISE EXCEPTION 'CURRENT_BILL hanya boleh dialokasikan ke tagihan yang dipilih';
    END IF;

    IF payment_record.ruang_lingkup = 'ARREARS'
       AND bill_record.periode_selesai >= payment_record.submitted_at::date THEN
        RAISE EXCEPTION 'ARREARS hanya boleh dialokasikan ke periode sebelum tanggal pengajuan';
    END IF;

    SELECT COALESCE(SUM(nominal_alokasi), 0) INTO total_payment
    FROM payment_allocations WHERE payment_id = NEW.payment_id;
    IF total_payment + NEW.nominal_alokasi > payment_record.nominal THEN
        RAISE EXCEPTION 'Total alokasi melebihi nominal pembayaran';
    END IF;

    SELECT COALESCE(SUM(nominal_alokasi), 0) INTO total_bill
    FROM payment_allocations WHERE bill_id = NEW.bill_id;
    IF total_bill + NEW.nominal_alokasi > bill_record.nominal THEN
        RAISE EXCEPTION 'Total alokasi melebihi nominal tagihan';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER payment_allocations_validasi
BEFORE INSERT ON payment_allocations
FOR EACH ROW EXECUTE FUNCTION validate_payment_allocation();

CREATE OR REPLACE FUNCTION update_bill_status(p_bill_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    nominal_tagihan bigint;
    total_teralokasi bigint;
BEGIN
    SELECT nominal INTO nominal_tagihan FROM bills WHERE id = p_bill_id;
    SELECT COALESCE(SUM(nominal_alokasi), 0) INTO total_teralokasi
    FROM payment_allocations WHERE bill_id = p_bill_id;

    UPDATE bills
    SET status = CASE
        WHEN total_teralokasi = 0 THEN 'BELUM_BAYAR'::status_tagihan
        WHEN total_teralokasi < nominal_tagihan THEN 'CICIL'::status_tagihan
        ELSE 'LUNAS'::status_tagihan
    END
    WHERE id = p_bill_id;
END;
$$;

CREATE OR REPLACE FUNCTION refresh_bill_status_after_allocation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM update_bill_status(NEW.bill_id);
    RETURN NEW;
END;
$$;

CREATE TRIGGER payment_allocations_perbarui_status_tagihan
AFTER INSERT ON payment_allocations
FOR EACH ROW EXECUTE FUNCTION refresh_bill_status_after_allocation();

CREATE OR REPLACE FUNCTION approved_payment_must_be_fully_allocated()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    total_teralokasi bigint;
BEGIN
    IF NEW.status = 'APPROVED' THEN
        SELECT COALESCE(SUM(nominal_alokasi), 0) INTO total_teralokasi
        FROM payment_allocations WHERE payment_id = NEW.id;
        IF total_teralokasi <> NEW.nominal THEN
            RAISE EXCEPTION 'Pembayaran APPROVED harus dialokasikan penuh sebelum transaksi di-commit';
        END IF;
    END IF;
    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER payments_approved_harus_teralokasi_penuh
AFTER INSERT OR UPDATE OF status, nominal ON payments
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION approved_payment_must_be_fully_allocated();

INSERT INTO roles (kode, nama, deskripsi) VALUES
    ('SUPER_ADMIN', 'Super Admin', 'Akses penuh sistem'),
    ('ADMIN', 'Admin', 'Verifikasi pembayaran dan laporan sesuai izin'),
    ('USER', 'User', 'Santri atau murid')
ON CONFLICT (kode) DO NOTHING;

INSERT INTO permissions (kode, nama, deskripsi) VALUES
    ('USER_PROFILE_VIEW', 'Lihat profil sendiri', 'Melihat profil milik sendiri'),
    ('USER_BILL_VIEW', 'Lihat tagihan sendiri', 'Melihat tagihan milik sendiri'),
    ('PAYMENT_CREATE', 'Buat pengajuan pembayaran', 'Mengirim pengajuan dan bukti pembayaran'),
    ('PAYMENT_VERIFY', 'Verifikasi pembayaran', 'Menyetujui pengajuan pembayaran'),
    ('PAYMENT_REJECT', 'Tolak pembayaran', 'Menolak pengajuan pembayaran'),
    ('REPORT_VIEW', 'Lihat laporan', 'Melihat laporan pembayaran'),
    ('REPORT_EXPORT', 'Ekspor laporan', 'Mengekspor laporan Excel'),
    ('USER_CREATE', 'Buat user', 'Menambahkan user atau santri'),
    ('USER_UPDATE', 'Ubah user', 'Mengubah profil dan tarif user'),
    ('USER_DEACTIVATE', 'Nonaktifkan user', 'Menonaktifkan user'),
    ('ADMIN_ASSIGN', 'Atur penugasan admin', 'Menetapkan admin pada posisi routing')
ON CONFLICT (kode) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.kode = 'SUPER_ADMIN'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.kode IN (
    'PAYMENT_VERIFY', 'PAYMENT_REJECT', 'REPORT_VIEW', 'REPORT_EXPORT',
    'USER_PROFILE_VIEW', 'USER_BILL_VIEW', 'PAYMENT_CREATE'
)
WHERE r.kode = 'ADMIN'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.kode IN ('USER_PROFILE_VIEW', 'USER_BILL_VIEW', 'PAYMENT_CREATE')
WHERE r.kode = 'USER'
ON CONFLICT DO NOTHING;

COMMIT;
