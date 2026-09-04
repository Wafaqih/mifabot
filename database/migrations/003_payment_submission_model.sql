BEGIN;

SET LOCAL search_path TO mifabot, public;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'mifabot'
          AND t.typname = 'submission_type_pembayaran'
    ) THEN
        CREATE TYPE mifabot.submission_type_pembayaran AS ENUM (
            'USER_SELF',
            'ADMIN_SELF',
            'ADMIN_FOR_USER'
        );
    END IF;
END $$;

ALTER TABLE mifabot.admin_assignments
    ADD COLUMN IF NOT EXISTS unit_kode varchar(40);

UPDATE mifabot.admin_assignments
SET unit_kode = CASE
    WHEN jenis_penugasan = 'BENDAHARA' THEN 'BENDAHARA'::varchar
    WHEN jenis_penugasan = 'PENDIDIKAN' THEN 'PENDIDIKAN'::varchar
    WHEN jenis_penugasan = 'KESEJAHTERAAN' THEN 'KESEJAHTERAAN'::varchar
    ELSE jenis_penugasan::varchar
END
WHERE unit_kode IS NULL;

ALTER TABLE mifabot.admin_assignments
    ALTER COLUMN unit_kode SET NOT NULL,
    ADD CONSTRAINT admin_assignments_unit_kode_valid CHECK (
        unit_kode IN (
            'BENDAHARA', 'BENDAHARA_1', 'BENDAHARA_2',
            'PENDIDIKAN', 'PENDIDIKAN_1', 'PENDIDIKAN_2',
            'KESEJAHTERAAN', 'KESEJAHTERAAN_1', 'KESEJAHTERAAN_2'
        )
    );

ALTER TABLE mifabot.payments
    ADD COLUMN IF NOT EXISTS submission_type mifabot.submission_type_pembayaran;

UPDATE mifabot.payments
SET submission_type = CASE
    WHEN user_id = submitted_by
         AND EXISTS (
             SELECT 1
             FROM mifabot.users u
             JOIN mifabot.roles r ON r.id = u.role_id
             WHERE u.id = submitted_by AND r.kode = 'USER'
         ) THEN 'USER_SELF'::mifabot.submission_type_pembayaran
    WHEN user_id = submitted_by
         AND EXISTS (
             SELECT 1
             FROM mifabot.users u
             JOIN mifabot.roles r ON r.id = u.role_id
             WHERE u.id = submitted_by AND r.kode IN ('ADMIN', 'SUPER_ADMIN')
         ) THEN 'ADMIN_SELF'::mifabot.submission_type_pembayaran
    ELSE 'ADMIN_FOR_USER'::mifabot.submission_type_pembayaran
END
WHERE submission_type IS NULL;

ALTER TABLE mifabot.payments
    ALTER COLUMN submission_type SET DEFAULT 'USER_SELF',
    ALTER COLUMN submission_type SET NOT NULL;

CREATE OR REPLACE FUNCTION mifabot.admin_unit_for_tagihan(jenis_tagihan mifabot.jenis_tagihan)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
    RETURN CASE jenis_tagihan
        WHEN 'BULANAN' THEN 'BENDAHARA'::text
        WHEN 'TAHUNAN' THEN 'BENDAHARA'::text
        WHEN 'PENDIDIKAN' THEN 'PENDIDIKAN'::text
        WHEN 'KESEJAHTERAAN' THEN 'KESEJAHTERAAN'::text
        ELSE NULL::text
    END;
END;
$$;

CREATE OR REPLACE FUNCTION mifabot.validate_payment_submission_model()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    submitted_role varchar(50);
    assigned_unit varchar(40);
BEGIN
    SELECT r.kode INTO submitted_role
    FROM mifabot.users u
    JOIN mifabot.roles r ON r.id = u.role_id
    WHERE u.id = NEW.submitted_by;

    IF NEW.submission_type = 'USER_SELF' THEN
        IF NEW.submitted_by <> NEW.user_id THEN
            RAISE EXCEPTION 'User hanya boleh mengajukan pembayaran untuk dirinya sendiri';
        END IF;
        IF submitted_role <> 'USER' THEN
            RAISE EXCEPTION 'USER_SELF hanya boleh dibuat oleh role USER';
        END IF;
        IF NEW.payment_channel_id IS NULL THEN
            RAISE EXCEPTION 'Pengajuan user harus memilih jalur pembayaran';
        END IF;
        IF NEW.routed_to_admin_id IS NULL THEN
            RAISE EXCEPTION 'Routed admin wajib diisi untuk user self-payment';
        END IF;

        IF NEW.routed_to_admin_id <> (
            SELECT pc.admin_user_id
            FROM mifabot.payment_channels pc
            WHERE pc.id = NEW.payment_channel_id AND pc.is_active
        ) THEN
            RAISE EXCEPTION 'Penerima pembayaran harus sesuai dengan jalur pembayaran yang dipilih';
        END IF;

        IF NOT EXISTS (
            SELECT 1
            FROM mifabot.admin_assignments aa
            WHERE aa.user_id = NEW.routed_to_admin_id
              AND aa.is_active
              AND aa.unit_kode LIKE (mifabot.admin_unit_for_tagihan(NEW.jenis_tagihan) || '%')
        ) THEN
            RAISE EXCEPTION 'Admin penerima tidak sesuai bidang tagihan';
        END IF;

    ELSIF NEW.submission_type = 'ADMIN_SELF' THEN
        IF NEW.submitted_by <> NEW.user_id THEN
            RAISE EXCEPTION 'ADMIN_SELF harus membayar tagihan milik dirinya sendiri';
        END IF;
        IF submitted_role NOT IN ('ADMIN', 'SUPER_ADMIN') THEN
            RAISE EXCEPTION 'ADMIN_SELF hanya boleh dibuat oleh role admin';
        END IF;
        IF NEW.payment_channel_id IS NOT NULL THEN
            RAISE EXCEPTION 'Admin self-payment tidak memakai payment channel';
        END IF;
        IF NEW.routed_to_admin_id IS NULL THEN
            NEW.routed_to_admin_id := NEW.submitted_by;
        END IF;
        IF NEW.routed_to_admin_id <> NEW.submitted_by THEN
            RAISE EXCEPTION 'Admin self-payment harus diarahkan ke admin yang sama';
        END IF;

        SELECT aa.unit_kode INTO assigned_unit
        FROM mifabot.admin_assignments aa
        WHERE aa.user_id = NEW.submitted_by AND aa.is_active
        LIMIT 1;

        IF assigned_unit IS NULL OR assigned_unit NOT LIKE (mifabot.admin_unit_for_tagihan(NEW.jenis_tagihan) || '%') THEN
            RAISE EXCEPTION 'Admin self-payment tidak berwenang untuk jenis tagihan ini';
        END IF;

        NEW.status := 'APPROVED';
        NEW.verified_by := NEW.submitted_by;
        NEW.verified_at := COALESCE(NEW.verified_at, now());
        NEW.rejection_reason := NULL;

    ELSIF NEW.submission_type = 'ADMIN_FOR_USER' THEN
        IF NEW.submitted_by = NEW.user_id THEN
            RAISE EXCEPTION 'ADMIN_FOR_USER harus membayar tagihan milik user lain';
        END IF;
        IF submitted_role NOT IN ('ADMIN', 'SUPER_ADMIN') THEN
            RAISE EXCEPTION 'ADMIN_FOR_USER hanya boleh dibuat oleh role admin';
        END IF;
        IF NEW.payment_channel_id IS NOT NULL THEN
            RAISE EXCEPTION 'Admin untuk user lain tidak memakai payment channel';
        END IF;
        IF NEW.routed_to_admin_id IS NULL THEN
            NEW.routed_to_admin_id := NEW.submitted_by;
        END IF;
        IF NEW.routed_to_admin_id <> NEW.submitted_by THEN
            RAISE EXCEPTION 'Admin untuk user lain harus diarahkan ke admin yang mengajukan';
        END IF;

        SELECT aa.unit_kode INTO assigned_unit
        FROM mifabot.admin_assignments aa
        WHERE aa.user_id = NEW.submitted_by AND aa.is_active
        LIMIT 1;

        IF assigned_unit IS NULL OR assigned_unit NOT LIKE (mifabot.admin_unit_for_tagihan(NEW.jenis_tagihan) || '%') THEN
            RAISE EXCEPTION 'Admin untuk user lain tidak berwenang untuk jenis tagihan ini';
        END IF;

        NEW.status := 'APPROVED';
        NEW.verified_by := NEW.submitted_by;
        NEW.verified_at := COALESCE(NEW.verified_at, now());
        NEW.rejection_reason := NULL;

    ELSE
        RAISE EXCEPTION 'Jenis submission pembayaran tidak valid';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payments_validasi_target_dan_routing ON mifabot.payments;
CREATE TRIGGER payments_validasi_target_dan_routing
BEFORE INSERT OR UPDATE OF user_id, submitted_by, routed_to_admin_id, payment_channel_id,
    requested_bill_id, jenis_tagihan, ruang_lingkup, submitted_at, submission_type
ON mifabot.payments
FOR EACH ROW EXECUTE FUNCTION mifabot.validate_payment_submission_model();

CREATE OR REPLACE FUNCTION mifabot.validate_payment_proof()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.submission_type = 'USER_SELF' THEN
        IF NEW.proof_storage_key IS NULL
           AND NOT EXISTS (
               SELECT 1 FROM mifabot.payment_channels pc
               WHERE pc.id = NEW.payment_channel_id AND pc.metode = 'CASH'
           ) THEN
            RAISE EXCEPTION 'Bukti pembayaran wajib diunggah kecuali metode CASH';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payments_validasi_bukti ON mifabot.payments;
CREATE TRIGGER payments_validasi_bukti
BEFORE INSERT OR UPDATE OF proof_storage_key, payment_channel_id, submission_type
ON mifabot.payments
FOR EACH ROW EXECUTE FUNCTION mifabot.validate_payment_proof();

COMMIT;
