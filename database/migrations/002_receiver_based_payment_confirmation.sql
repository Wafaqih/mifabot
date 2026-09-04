-- Receiver-based confirmation for users; trusted admin submissions are auto-approved.

BEGIN;

SET LOCAL search_path TO mifabot, public;

CREATE TYPE mifabot.jenis_metode_pembayaran AS ENUM ('DANA', 'BANK_TRANSFER', 'CASH');

CREATE TABLE mifabot.payment_channels (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_user_id uuid NOT NULL REFERENCES mifabot.users(id) ON DELETE RESTRICT,
    nama varchar(100) NOT NULL,
    metode mifabot.jenis_metode_pembayaran NOT NULL,
    nomor_rekening varchar(100),
    nama_pemilik varchar(200),
    urutan integer NOT NULL,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT payment_channels_nama_tidak_kosong CHECK (btrim(nama) <> ''),
    CONSTRAINT payment_channels_urutan_positif CHECK (urutan > 0),
    CONSTRAINT payment_channels_rekening_sesuai_metode CHECK (
        (metode = 'CASH' AND nomor_rekening IS NULL)
        OR (metode IN ('DANA', 'BANK_TRANSFER') AND btrim(COALESCE(nomor_rekening, '')) <> '')
    )
);

CREATE INDEX payment_channels_active_idx
    ON mifabot.payment_channels (urutan)
    WHERE is_active;

ALTER TABLE mifabot.payments
    ADD COLUMN payment_channel_id uuid REFERENCES mifabot.payment_channels(id) ON DELETE RESTRICT;

ALTER TABLE mifabot.payments
    ALTER COLUMN proof_storage_key DROP NOT NULL;

ALTER TABLE mifabot.payments
    DROP CONSTRAINT payments_bukti_tidak_kosong;

CREATE TABLE mifabot.payment_arrears_selections (
    payment_id uuid NOT NULL REFERENCES mifabot.payments(id) ON DELETE RESTRICT,
    bill_id uuid NOT NULL REFERENCES mifabot.bills(id) ON DELETE RESTRICT,
    nominal_wajib bigint NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (payment_id, bill_id),
    CONSTRAINT payment_arrears_selections_nominal_positif CHECK (nominal_wajib > 0)
);

CREATE INDEX payment_arrears_selections_bill_idx
    ON mifabot.payment_arrears_selections (bill_id);

CREATE OR REPLACE FUNCTION mifabot.validate_payment_target_and_route()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    bill_user_id uuid;
    bill_jenis mifabot.jenis_tagihan;
    bill_periode_mulai date;
    bill_periode_selesai date;
    submitted_role varchar(50);
    channel_admin_id uuid;
BEGIN
    IF NEW.ruang_lingkup = 'CURRENT_BILL' THEN
        SELECT user_id, jenis_tagihan, periode_mulai, periode_selesai
        INTO bill_user_id, bill_jenis, bill_periode_mulai, bill_periode_selesai
        FROM mifabot.bills WHERE id = NEW.requested_bill_id;

        IF NOT FOUND OR bill_user_id <> NEW.user_id OR bill_jenis <> NEW.jenis_tagihan THEN
            RAISE EXCEPTION 'Tagihan target tidak sesuai dengan user atau jenis tagihan pembayaran';
        END IF;

        IF NEW.submitted_at::date NOT BETWEEN bill_periode_mulai AND bill_periode_selesai THEN
            RAISE EXCEPTION 'CURRENT_BILL harus menunjuk tagihan yang sedang berjalan saat diajukan';
        END IF;

        IF NEW.nominal > (
            SELECT b.nominal - COALESCE(SUM(pa.nominal_alokasi), 0)
            FROM mifabot.bills b
            LEFT JOIN mifabot.payment_allocations pa ON pa.bill_id = b.id
            WHERE b.id = NEW.requested_bill_id
            GROUP BY b.id, b.nominal
        ) THEN
            RAISE EXCEPTION 'Nominal pembayaran melebihi sisa tagihan berjalan';
        END IF;
    ELSIF NEW.requested_bill_id IS NOT NULL THEN
        RAISE EXCEPTION 'ARREARS harus menggunakan daftar tunggakan yang dipilih';
    END IF;

    SELECT r.kode INTO submitted_role
    FROM mifabot.users u
    JOIN mifabot.roles r ON r.id = u.role_id
    WHERE u.id = NEW.submitted_by;

    IF submitted_role = 'USER' THEN
        IF NEW.submitted_by <> NEW.user_id THEN
            RAISE EXCEPTION 'User hanya boleh mengajukan pembayaran untuk dirinya sendiri';
        END IF;
        IF NEW.payment_channel_id IS NULL THEN
            RAISE EXCEPTION 'Pengajuan user harus memilih jalur pembayaran';
        END IF;

        SELECT admin_user_id INTO channel_admin_id
        FROM mifabot.payment_channels
        WHERE id = NEW.payment_channel_id AND is_active;

        IF NOT FOUND OR channel_admin_id <> NEW.routed_to_admin_id THEN
            RAISE EXCEPTION 'Penerima pembayaran harus sesuai dengan jalur pembayaran yang dipilih';
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM mifabot.admin_assignments aa
            WHERE aa.user_id = channel_admin_id
              AND aa.jenis_penugasan = CASE NEW.jenis_tagihan
                  WHEN 'BULANAN' THEN 'BENDAHARA'
                  WHEN 'TAHUNAN' THEN 'BENDAHARA'
                  WHEN 'PENDIDIKAN' THEN 'PENDIDIKAN'
                  WHEN 'KESEJAHTERAAN' THEN 'KESEJAHTERAAN'
              END::mifabot.jenis_penugasan_admin
              AND aa.is_active
        ) THEN
            RAISE EXCEPTION 'Jalur pembayaran tidak sesuai bidang tagihan';
        END IF;
    ELSIF submitted_role IN ('ADMIN', 'SUPER_ADMIN') THEN
        NEW.payment_channel_id := NULL;
        NEW.routed_to_admin_id := NEW.submitted_by;
        NEW.status := 'APPROVED';
        NEW.verified_by := NEW.submitted_by;
        NEW.verified_at := COALESCE(NEW.verified_at, now());
        NEW.rejection_reason := NULL;
    ELSE
        RAISE EXCEPTION 'Submission pembayaran hanya boleh dibuat oleh USER atau ADMIN';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER payments_validasi_target_dan_routing ON mifabot.payments;
CREATE TRIGGER payments_validasi_target_dan_routing
BEFORE INSERT OR UPDATE OF user_id, submitted_by, routed_to_admin_id, payment_channel_id,
    requested_bill_id, jenis_tagihan, ruang_lingkup, submitted_at
ON mifabot.payments
FOR EACH ROW EXECUTE FUNCTION mifabot.validate_payment_target_and_route();

CREATE OR REPLACE FUNCTION mifabot.validate_payment_proof()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.proof_storage_key IS NULL
       AND EXISTS (
           SELECT 1 FROM mifabot.users u
           JOIN mifabot.roles r ON r.id = u.role_id
           WHERE u.id = NEW.submitted_by AND r.kode = 'USER'
       )
       AND NOT EXISTS (
           SELECT 1 FROM mifabot.payment_channels pc
           WHERE pc.id = NEW.payment_channel_id AND pc.metode = 'CASH'
       ) THEN
        RAISE EXCEPTION 'Bukti pembayaran wajib diunggah kecuali metode CASH';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER payments_validasi_bukti
BEFORE INSERT OR UPDATE OF proof_storage_key, payment_channel_id ON mifabot.payments
FOR EACH ROW EXECUTE FUNCTION mifabot.validate_payment_proof();

CREATE OR REPLACE FUNCTION mifabot.validate_arrears_selection()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    payment_record mifabot.payments%ROWTYPE;
    outstanding bigint;
BEGIN
    SELECT * INTO payment_record
    FROM mifabot.payments
    WHERE id = NEW.payment_id;
    IF payment_record.ruang_lingkup <> 'ARREARS' OR payment_record.user_id IS NULL THEN
        RAISE EXCEPTION 'Pilihan tunggakan hanya berlaku untuk pembayaran ARREARS';
    END IF;

    SELECT b.nominal - COALESCE(SUM(pa.nominal_alokasi), 0) INTO outstanding
    FROM mifabot.bills b
    LEFT JOIN mifabot.payment_allocations pa ON pa.bill_id = b.id
    WHERE b.id = NEW.bill_id
      AND b.user_id = payment_record.user_id
      AND b.jenis_tagihan = payment_record.jenis_tagihan
      AND b.periode_selesai < payment_record.submitted_at::date
    GROUP BY b.id, b.nominal;

    IF outstanding IS NULL OR NEW.nominal_wajib <> outstanding THEN
        RAISE EXCEPTION 'Pembayaran tunggakan harus sesuai nominal sisa tagihan';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER payment_arrears_selections_validasi
BEFORE INSERT OR UPDATE ON mifabot.payment_arrears_selections
FOR EACH ROW EXECUTE FUNCTION mifabot.validate_arrears_selection();

CREATE OR REPLACE FUNCTION mifabot.validate_arrears_payment_total()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    selected_total bigint;
BEGIN
    IF NEW.ruang_lingkup = 'ARREARS' THEN
        SELECT COALESCE(SUM(nominal_wajib), 0) INTO selected_total
        FROM mifabot.payment_arrears_selections
        WHERE payment_id = NEW.id;
        IF selected_total = 0 OR selected_total <> NEW.nominal THEN
            RAISE EXCEPTION 'Nominal ARREARS harus sama dengan total tunggakan yang dipilih';
        END IF;
    END IF;
    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER payments_arrears_harus_sesuai_pilihan
AFTER INSERT OR UPDATE OF nominal, ruang_lingkup ON mifabot.payments
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION mifabot.validate_arrears_payment_total();

CREATE TRIGGER payment_channels_set_updated_at
BEFORE UPDATE ON mifabot.payment_channels
FOR EACH ROW EXECUTE FUNCTION mifabot.set_updated_at();

COMMIT;
