-- Dynamic billing definitions.
--
-- This migration is deliberately additive.  The legacy `jenis_tagihan` enum,
-- `tariffs`, and their values are retained so historical records and any
-- in-flight legacy integration remain readable while the application moves to
-- billing definitions.

BEGIN;

SET LOCAL search_path TO mifabot, public;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'mifabot'
          AND t.typname = 'billing_interval'
    ) THEN
        CREATE TYPE mifabot.billing_interval AS ENUM (
            'WEEKLY',
            'MONTHLY',
            'YEARLY',
            'CUSTOM'
        );
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS mifabot.billing_definitions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kode varchar(80) NOT NULL,
    nama varchar(150) NOT NULL,
    interval mifabot.billing_interval NOT NULL,
    is_active boolean NOT NULL DEFAULT true,
    created_by uuid REFERENCES mifabot.users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT billing_definitions_kode_tidak_kosong CHECK (btrim(kode) <> ''),
    CONSTRAINT billing_definitions_nama_tidak_kosong CHECK (btrim(nama) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS billing_definitions_kode_unik
    ON mifabot.billing_definitions (kode);

-- The command surface finds a definition by name.  Keep that lookup
-- deterministic without making display capitalization significant.
CREATE UNIQUE INDEX IF NOT EXISTS billing_definitions_nama_unik
    ON mifabot.billing_definitions (lower(btrim(nama)));

CREATE TABLE IF NOT EXISTS mifabot.billing_definition_rates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    billing_definition_id uuid NOT NULL REFERENCES mifabot.billing_definitions(id) ON DELETE RESTRICT,
    nominal bigint NOT NULL,
    berlaku_mulai date NOT NULL,
    berlaku_sampai date,
    created_by uuid REFERENCES mifabot.users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT billing_definition_rates_nominal_positif CHECK (nominal > 0),
    CONSTRAINT billing_definition_rates_rentang_valid CHECK (
        berlaku_sampai IS NULL OR berlaku_sampai >= berlaku_mulai
    ),
    EXCLUDE USING gist (
        billing_definition_id WITH =,
        daterange(berlaku_mulai, COALESCE(berlaku_sampai, 'infinity'::date), '[]') WITH &&
    )
);

CREATE INDEX IF NOT EXISTS billing_definition_rates_lookup_idx
    ON mifabot.billing_definition_rates (billing_definition_id, berlaku_mulai DESC);

CREATE TABLE IF NOT EXISTS mifabot.student_billing_overrides (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    billing_definition_id uuid NOT NULL REFERENCES mifabot.billing_definitions(id) ON DELETE RESTRICT,
    user_id uuid NOT NULL REFERENCES mifabot.users(id) ON DELETE RESTRICT,
    nominal bigint NOT NULL,
    berlaku_mulai date NOT NULL,
    berlaku_sampai date,
    created_by uuid REFERENCES mifabot.users(id) ON DELETE SET NULL,
    -- Internal bridge to the old per-student tariff table.  New code must not
    -- rely on this column; it lets a legacy tariff update keep its copied
    -- override in sync during the transition.
    legacy_tariff_id uuid UNIQUE REFERENCES mifabot.tariffs(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT student_billing_overrides_nominal_positif CHECK (nominal > 0),
    CONSTRAINT student_billing_overrides_rentang_valid CHECK (
        berlaku_sampai IS NULL OR berlaku_sampai >= berlaku_mulai
    ),
    EXCLUDE USING gist (
        billing_definition_id WITH =,
        user_id WITH =,
        daterange(berlaku_mulai, COALESCE(berlaku_sampai, 'infinity'::date), '[]') WITH &&
    )
);

CREATE INDEX IF NOT EXISTS student_billing_overrides_lookup_idx
    ON mifabot.student_billing_overrides (billing_definition_id, user_id, berlaku_mulai DESC);

CREATE TABLE IF NOT EXISTS mifabot.billing_definition_responsibles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    billing_definition_id uuid NOT NULL REFERENCES mifabot.billing_definitions(id) ON DELETE RESTRICT,
    user_id uuid NOT NULL REFERENCES mifabot.users(id) ON DELETE RESTRICT,
    is_active boolean NOT NULL DEFAULT true,
    -- Tracks rows synthesized from a legacy admin assignment.  It is nullable
    -- for normal Add PJ rows and preserves a reversible compatibility bridge.
    legacy_admin_assignment_id uuid REFERENCES mifabot.admin_assignments(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS billing_definition_responsibles_satu_aktif
    ON mifabot.billing_definition_responsibles (billing_definition_id, user_id)
    WHERE is_active;

CREATE INDEX IF NOT EXISTS billing_definition_responsibles_user_aktif_idx
    ON mifabot.billing_definition_responsibles (user_id, billing_definition_id)
    WHERE is_active;

-- Legacy enum values are mapped once to seed definitions.  The mapping is an
-- implementation bridge, not the source of truth for definitions created
-- after this migration.
CREATE TABLE IF NOT EXISTS mifabot.legacy_billing_definition_mappings (
    jenis_tagihan mifabot.jenis_tagihan PRIMARY KEY,
    billing_definition_id uuid NOT NULL UNIQUE
        REFERENCES mifabot.billing_definitions(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO mifabot.billing_definitions (kode, nama, interval)
VALUES
    ('BULANAN', 'Bulanan', 'MONTHLY'),
    ('TAHUNAN', 'Tahunan', 'YEARLY'),
    -- These legacy classes did not have a reliable recurring schedule.  They
    -- become manually issued definitions rather than inheriting a false rule.
    ('PENDIDIKAN', 'Pendidikan', 'CUSTOM'),
    ('KESEJAHTERAAN', 'Kesejahteraan', 'CUSTOM')
ON CONFLICT (kode) DO NOTHING;

INSERT INTO mifabot.legacy_billing_definition_mappings (jenis_tagihan, billing_definition_id)
SELECT legacy.jenis_tagihan, definition.id
FROM (
    VALUES
        ('BULANAN'::mifabot.jenis_tagihan, 'BULANAN'),
        ('TAHUNAN'::mifabot.jenis_tagihan, 'TAHUNAN'),
        ('PENDIDIKAN'::mifabot.jenis_tagihan, 'PENDIDIKAN'),
        ('KESEJAHTERAAN'::mifabot.jenis_tagihan, 'KESEJAHTERAAN')
) AS legacy(jenis_tagihan, kode)
JOIN mifabot.billing_definitions definition ON definition.kode = legacy.kode
ON CONFLICT (jenis_tagihan) DO UPDATE
SET billing_definition_id = EXCLUDED.billing_definition_id;

ALTER TABLE mifabot.bills
    ADD COLUMN IF NOT EXISTS billing_definition_id uuid,
    ADD COLUMN IF NOT EXISTS nama_tagihan_snapshot varchar(150);

ALTER TABLE mifabot.payments
    ADD COLUMN IF NOT EXISTS billing_definition_id uuid,
    ADD COLUMN IF NOT EXISTS nama_tagihan_snapshot varchar(150);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'mifabot.bills'::regclass
          AND conname = 'bills_billing_definition_fk'
    ) THEN
        ALTER TABLE mifabot.bills
            ADD CONSTRAINT bills_billing_definition_fk
            FOREIGN KEY (billing_definition_id)
            REFERENCES mifabot.billing_definitions(id)
            ON DELETE RESTRICT
            NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'mifabot.payments'::regclass
          AND conname = 'payments_billing_definition_fk'
    ) THEN
        ALTER TABLE mifabot.payments
            ADD CONSTRAINT payments_billing_definition_fk
            FOREIGN KEY (billing_definition_id)
            REFERENCES mifabot.billing_definitions(id)
            ON DELETE RESTRICT
            NOT VALID;
    END IF;
END $$;

-- New dynamic records do not have an enum value.  Keep the old values nullable
-- rather than deleting the enum or rewriting immutable historical records.
ALTER TABLE mifabot.bills
    ALTER COLUMN jenis_tagihan DROP NOT NULL;

ALTER TABLE mifabot.payments
    ALTER COLUMN jenis_tagihan DROP NOT NULL;

UPDATE mifabot.bills bill
SET billing_definition_id = mapping.billing_definition_id,
    nama_tagihan_snapshot = definition.nama
FROM mifabot.legacy_billing_definition_mappings mapping
JOIN mifabot.billing_definitions definition
  ON definition.id = mapping.billing_definition_id
WHERE bill.jenis_tagihan = mapping.jenis_tagihan
  AND bill.billing_definition_id IS NULL;

UPDATE mifabot.bills bill
SET nama_tagihan_snapshot = definition.nama
FROM mifabot.billing_definitions definition
WHERE bill.billing_definition_id = definition.id
  AND NULLIF(btrim(bill.nama_tagihan_snapshot), '') IS NULL;

-- Prefer the source bill when a payment names one, then use the legacy enum
-- mapping for arrears and old rows that have no requested_bill_id.
UPDATE mifabot.payments payment
SET billing_definition_id = bill.billing_definition_id,
    nama_tagihan_snapshot = bill.nama_tagihan_snapshot
FROM mifabot.bills bill
WHERE payment.requested_bill_id = bill.id
  AND payment.billing_definition_id IS NULL;

UPDATE mifabot.payments payment
SET billing_definition_id = mapping.billing_definition_id,
    nama_tagihan_snapshot = definition.nama
FROM mifabot.legacy_billing_definition_mappings mapping
JOIN mifabot.billing_definitions definition
  ON definition.id = mapping.billing_definition_id
WHERE payment.jenis_tagihan = mapping.jenis_tagihan
  AND payment.billing_definition_id IS NULL;

UPDATE mifabot.payments payment
SET nama_tagihan_snapshot = COALESCE(
    (
        SELECT bill.nama_tagihan_snapshot
        FROM mifabot.bills bill
        WHERE bill.id = payment.requested_bill_id
    ),
    definition.nama
)
FROM mifabot.billing_definitions definition
WHERE payment.billing_definition_id = definition.id
  AND NULLIF(btrim(payment.nama_tagihan_snapshot), '') IS NULL;

-- Preserve every historical individual tariff as an override.  This is safer
-- than inferring that a past per-student amount was globally applicable.
INSERT INTO mifabot.student_billing_overrides (
    billing_definition_id,
    user_id,
    nominal,
    berlaku_mulai,
    berlaku_sampai,
    created_by,
    legacy_tariff_id,
    created_at,
    updated_at
)
SELECT
    mapping.billing_definition_id,
    tariff.user_id,
    tariff.nominal,
    tariff.berlaku_mulai,
    tariff.berlaku_sampai,
    tariff.dibuat_oleh,
    tariff.id,
    tariff.created_at,
    tariff.updated_at
FROM mifabot.tariffs tariff
JOIN mifabot.legacy_billing_definition_mappings mapping
  ON mapping.jenis_tagihan = tariff.jenis_tagihan
ON CONFLICT (legacy_tariff_id) DO UPDATE
SET billing_definition_id = EXCLUDED.billing_definition_id,
    user_id = EXCLUDED.user_id,
    nominal = EXCLUDED.nominal,
    berlaku_mulai = EXCLUDED.berlaku_mulai,
    berlaku_sampai = EXCLUDED.berlaku_sampai,
    created_by = EXCLUDED.created_by,
    updated_at = EXCLUDED.updated_at;

-- Seed one global current rate per legacy definition from the most common
-- tariff that is effective today.  Per-student overrides above still win, so
-- no historical amount is lost when legacy data is heterogeneous.
WITH current_tariffs AS (
    SELECT DISTINCT ON (tariff.jenis_tagihan, tariff.user_id)
        tariff.jenis_tagihan,
        tariff.user_id,
        tariff.nominal
    FROM mifabot.tariffs tariff
    WHERE tariff.berlaku_mulai <= CURRENT_DATE
      AND (tariff.berlaku_sampai IS NULL OR tariff.berlaku_sampai >= CURRENT_DATE)
    ORDER BY tariff.jenis_tagihan, tariff.user_id,
        tariff.berlaku_mulai DESC, tariff.created_at DESC, tariff.id DESC
), nominal_frequency AS (
    SELECT jenis_tagihan, nominal, COUNT(*) AS jumlah_user
    FROM current_tariffs
    GROUP BY jenis_tagihan, nominal
), selected_nominal AS (
    SELECT DISTINCT ON (jenis_tagihan) jenis_tagihan, nominal
    FROM nominal_frequency
    ORDER BY jenis_tagihan, jumlah_user DESC, nominal ASC
)
INSERT INTO mifabot.billing_definition_rates (
    billing_definition_id,
    nominal,
    berlaku_mulai
)
SELECT
    mapping.billing_definition_id,
    selected.nominal,
    CURRENT_DATE
FROM selected_nominal selected
JOIN mifabot.legacy_billing_definition_mappings mapping
  ON mapping.jenis_tagihan = selected.jenis_tagihan
ON CONFLICT DO NOTHING;

-- Carry the old routing assignments forward as PJ rows.  A bendahara was
-- responsible for both old BULANAN and TAHUNAN; the two other assignments map
-- one-to-one.  Gender is intentionally not copied: PJ routing is now defined
-- per billing definition and supports many responsible users.
INSERT INTO mifabot.billing_definition_responsibles (
    billing_definition_id,
    user_id,
    is_active,
    legacy_admin_assignment_id,
    created_at,
    updated_at
)
SELECT DISTINCT
    mapping.billing_definition_id,
    assignment.user_id,
    true,
    assignment.id,
    assignment.created_at,
    assignment.updated_at
FROM mifabot.admin_assignments assignment
JOIN mifabot.legacy_billing_definition_mappings mapping
  ON (
      (assignment.jenis_penugasan = 'BENDAHARA'
          AND mapping.jenis_tagihan IN ('BULANAN', 'TAHUNAN'))
      OR (assignment.jenis_penugasan = 'PENDIDIKAN'
          AND mapping.jenis_tagihan = 'PENDIDIKAN')
      OR (assignment.jenis_penugasan = 'KESEJAHTERAAN'
          AND mapping.jenis_tagihan = 'KESEJAHTERAAN')
  )
WHERE assignment.is_active
ON CONFLICT (billing_definition_id, user_id) WHERE is_active DO NOTHING;

-- A definition without a payment-responsibility path must not begin issuing
-- bills. It can be activated later by the first Add PJ command.
UPDATE mifabot.billing_definitions definition
SET is_active = false
WHERE definition.is_active
  AND NOT EXISTS (
      SELECT 1
      FROM mifabot.billing_definition_responsibles responsible
      WHERE responsible.billing_definition_id = definition.id
        AND responsible.is_active
  );

CREATE OR REPLACE FUNCTION mifabot.validate_billing_definition_responsible()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    kode_role varchar(50);
BEGIN
    IF NOT NEW.is_active THEN
        RETURN NEW;
    END IF;

    SELECT peran.kode INTO kode_role
    FROM mifabot.users pengguna
    JOIN mifabot.roles peran ON peran.id = pengguna.role_id
    WHERE pengguna.id = NEW.user_id;

    IF kode_role NOT IN ('ADMIN', 'SUPER_ADMIN') THEN
        RAISE EXCEPTION 'PJ tagihan harus memiliki role ADMIN atau SUPER_ADMIN';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS billing_definition_responsibles_validasi_role
    ON mifabot.billing_definition_responsibles;
CREATE TRIGGER billing_definition_responsibles_validasi_role
BEFORE INSERT OR UPDATE OF user_id, is_active ON mifabot.billing_definition_responsibles
FOR EACH ROW EXECUTE FUNCTION mifabot.validate_billing_definition_responsible();

CREATE OR REPLACE FUNCTION mifabot.sync_legacy_tariff_override()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    definition_id uuid;
BEGIN
    SELECT mapping.billing_definition_id INTO definition_id
    FROM mifabot.legacy_billing_definition_mappings mapping
    WHERE mapping.jenis_tagihan = NEW.jenis_tagihan;

    IF definition_id IS NULL THEN
        RETURN NEW;
    END IF;

    INSERT INTO mifabot.student_billing_overrides (
        billing_definition_id,
        user_id,
        nominal,
        berlaku_mulai,
        berlaku_sampai,
        created_by,
        legacy_tariff_id
    ) VALUES (
        definition_id,
        NEW.user_id,
        NEW.nominal,
        NEW.berlaku_mulai,
        NEW.berlaku_sampai,
        NEW.dibuat_oleh,
        NEW.id
    )
    ON CONFLICT (legacy_tariff_id) DO UPDATE
    SET billing_definition_id = EXCLUDED.billing_definition_id,
        user_id = EXCLUDED.user_id,
        nominal = EXCLUDED.nominal,
        berlaku_mulai = EXCLUDED.berlaku_mulai,
        berlaku_sampai = EXCLUDED.berlaku_sampai,
        created_by = EXCLUDED.created_by;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tariffs_sinkronkan_override_dinamis ON mifabot.tariffs;
CREATE TRIGGER tariffs_sinkronkan_override_dinamis
AFTER INSERT OR UPDATE OF user_id, jenis_tagihan, nominal, berlaku_mulai, berlaku_sampai, dibuat_oleh
ON mifabot.tariffs
FOR EACH ROW EXECUTE FUNCTION mifabot.sync_legacy_tariff_override();

CREATE OR REPLACE FUNCTION mifabot.sync_legacy_admin_assignment_responsibilities()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    -- Close only the PJ rows that this legacy assignment itself created.  A
    -- separately-added modern PJ for the same person must remain untouched.
    IF TG_OP = 'UPDATE' AND OLD.is_active THEN
        UPDATE mifabot.billing_definition_responsibles
        SET is_active = false
        WHERE legacy_admin_assignment_id = NEW.id
          AND is_active;
    END IF;

    IF NEW.is_active THEN
        INSERT INTO mifabot.billing_definition_responsibles (
            billing_definition_id,
            user_id,
            is_active,
            legacy_admin_assignment_id
        )
        SELECT
            mapping.billing_definition_id,
            NEW.user_id,
            true,
            NEW.id
        FROM mifabot.legacy_billing_definition_mappings mapping
        WHERE (
            NEW.jenis_penugasan = 'BENDAHARA'
            AND mapping.jenis_tagihan IN ('BULANAN', 'TAHUNAN')
        ) OR (
            NEW.jenis_penugasan = 'PENDIDIKAN'
            AND mapping.jenis_tagihan = 'PENDIDIKAN'
        ) OR (
            NEW.jenis_penugasan = 'KESEJAHTERAAN'
            AND mapping.jenis_tagihan = 'KESEJAHTERAAN'
        )
        ON CONFLICT (billing_definition_id, user_id) WHERE is_active DO NOTHING;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS admin_assignments_sinkronkan_pj_dinamis ON mifabot.admin_assignments;
CREATE TRIGGER admin_assignments_sinkronkan_pj_dinamis
AFTER INSERT OR UPDATE OF user_id, jenis_penugasan, is_active ON mifabot.admin_assignments
FOR EACH ROW EXECUTE FUNCTION mifabot.sync_legacy_admin_assignment_responsibilities();

CREATE OR REPLACE FUNCTION mifabot.sync_legacy_bill_definition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    mapped_definition_id uuid;
    definition_name varchar(150);
BEGIN
    IF NEW.jenis_tagihan IS NOT NULL THEN
        SELECT mapping.billing_definition_id
        INTO mapped_definition_id
        FROM mifabot.legacy_billing_definition_mappings mapping
        WHERE mapping.jenis_tagihan = NEW.jenis_tagihan;

        IF NEW.billing_definition_id IS NULL THEN
            NEW.billing_definition_id := mapped_definition_id;
        ELSIF mapped_definition_id IS NOT NULL
              AND NEW.billing_definition_id <> mapped_definition_id THEN
            RAISE EXCEPTION 'Definisi tagihan tidak sesuai dengan jenis_tagihan legacy';
        END IF;
    END IF;

    IF NEW.billing_definition_id IS NULL THEN
        RAISE EXCEPTION 'billing_definition_id wajib diisi untuk tagihan baru';
    END IF;

    IF NULLIF(btrim(NEW.nama_tagihan_snapshot), '') IS NULL THEN
        SELECT definition.nama INTO definition_name
        FROM mifabot.billing_definitions definition
        WHERE definition.id = NEW.billing_definition_id;
        NEW.nama_tagihan_snapshot := definition_name;
    END IF;

    IF NULLIF(btrim(NEW.nama_tagihan_snapshot), '') IS NULL THEN
        RAISE EXCEPTION 'Snapshot nama tagihan tidak dapat ditentukan';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS aa_bills_sinkronkan_definisi_tagihan ON mifabot.bills;
CREATE TRIGGER aa_bills_sinkronkan_definisi_tagihan
BEFORE INSERT OR UPDATE OF jenis_tagihan, billing_definition_id, nama_tagihan_snapshot
ON mifabot.bills
FOR EACH ROW EXECUTE FUNCTION mifabot.sync_legacy_bill_definition();

CREATE OR REPLACE FUNCTION mifabot.sync_legacy_payment_definition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    mapped_definition_id uuid;
    bill_definition_id uuid;
    bill_name varchar(150);
    definition_name varchar(150);
BEGIN
    IF NEW.requested_bill_id IS NOT NULL THEN
        SELECT bill.billing_definition_id, bill.nama_tagihan_snapshot
        INTO bill_definition_id, bill_name
        FROM mifabot.bills bill
        WHERE bill.id = NEW.requested_bill_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Tagihan target pembayaran tidak ditemukan';
        END IF;

        IF NEW.billing_definition_id IS NULL THEN
            NEW.billing_definition_id := bill_definition_id;
        ELSIF NEW.billing_definition_id <> bill_definition_id THEN
            RAISE EXCEPTION 'Definisi pembayaran tidak sesuai dengan tagihan target';
        END IF;
    END IF;

    IF NEW.jenis_tagihan IS NOT NULL THEN
        SELECT mapping.billing_definition_id
        INTO mapped_definition_id
        FROM mifabot.legacy_billing_definition_mappings mapping
        WHERE mapping.jenis_tagihan = NEW.jenis_tagihan;

        IF NEW.billing_definition_id IS NULL THEN
            NEW.billing_definition_id := mapped_definition_id;
        ELSIF mapped_definition_id IS NOT NULL
              AND NEW.billing_definition_id <> mapped_definition_id THEN
            RAISE EXCEPTION 'Definisi pembayaran tidak sesuai dengan jenis_tagihan legacy';
        END IF;
    END IF;

    IF NEW.billing_definition_id IS NULL THEN
        RAISE EXCEPTION 'billing_definition_id wajib diisi untuk pembayaran baru';
    END IF;

    IF NULLIF(btrim(NEW.nama_tagihan_snapshot), '') IS NULL THEN
        SELECT definition.nama INTO definition_name
        FROM mifabot.billing_definitions definition
        WHERE definition.id = NEW.billing_definition_id;
        NEW.nama_tagihan_snapshot := COALESCE(bill_name, definition_name);
    END IF;

    IF NULLIF(btrim(NEW.nama_tagihan_snapshot), '') IS NULL THEN
        RAISE EXCEPTION 'Snapshot nama tagihan pembayaran tidak dapat ditentukan';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS aa_payments_sinkronkan_definisi_tagihan ON mifabot.payments;
CREATE TRIGGER aa_payments_sinkronkan_definisi_tagihan
BEFORE INSERT OR UPDATE OF requested_bill_id, jenis_tagihan, billing_definition_id, nama_tagihan_snapshot
ON mifabot.payments
FOR EACH ROW EXECUTE FUNCTION mifabot.sync_legacy_payment_definition();

-- The older payment trigger routes through hard-coded admin units.  Dynamic
-- payments instead route through an active PJ of the definition; legacy
-- requests are first converted by the bridge trigger above.
CREATE OR REPLACE FUNCTION mifabot.validate_payment_submission_model()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    submitted_role varchar(50);
    channel_admin_id uuid;
    bill_user_id uuid;
    bill_definition_id uuid;
    bill_periode_mulai date;
    bill_periode_selesai date;
BEGIN
    IF NEW.billing_definition_id IS NULL THEN
        RAISE EXCEPTION 'Pembayaran harus memiliki billing_definition_id';
    END IF;

    IF NEW.ruang_lingkup = 'CURRENT_BILL' THEN
        SELECT bill.user_id,
               bill.billing_definition_id,
               bill.periode_mulai,
               bill.periode_selesai
        INTO bill_user_id,
             bill_definition_id,
             bill_periode_mulai,
             bill_periode_selesai
        FROM mifabot.bills bill
        WHERE bill.id = NEW.requested_bill_id;

        IF NOT FOUND
           OR bill_user_id <> NEW.user_id
           OR bill_definition_id <> NEW.billing_definition_id THEN
            RAISE EXCEPTION 'Tagihan target tidak sesuai dengan user atau definisi pembayaran';
        END IF;

        IF NEW.submitted_at::date NOT BETWEEN bill_periode_mulai AND bill_periode_selesai THEN
            RAISE EXCEPTION 'CURRENT_BILL harus menunjuk tagihan yang sedang berjalan saat diajukan';
        END IF;

        IF NEW.nominal > (
            SELECT bill.nominal - COALESCE(SUM(allocation.nominal_alokasi), 0)
            FROM mifabot.bills bill
            LEFT JOIN mifabot.payment_allocations allocation ON allocation.bill_id = bill.id
            WHERE bill.id = NEW.requested_bill_id
            GROUP BY bill.id, bill.nominal
        ) THEN
            RAISE EXCEPTION 'Nominal pembayaran melebihi sisa tagihan berjalan';
        END IF;
    ELSIF NEW.requested_bill_id IS NOT NULL THEN
        RAISE EXCEPTION 'ARREARS harus menggunakan daftar tunggakan yang dipilih';
    END IF;

    SELECT peran.kode INTO submitted_role
    FROM mifabot.users pengguna
    JOIN mifabot.roles peran ON peran.id = pengguna.role_id
    WHERE pengguna.id = NEW.submitted_by;

    IF submitted_role IS NULL THEN
        RAISE EXCEPTION 'Pengaju pembayaran tidak ditemukan';
    END IF;

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

        SELECT channel.admin_user_id INTO channel_admin_id
        FROM mifabot.payment_channels channel
        WHERE channel.id = NEW.payment_channel_id
          AND channel.is_active;

        IF channel_admin_id IS NULL OR channel_admin_id <> NEW.routed_to_admin_id THEN
            RAISE EXCEPTION 'Penerima pembayaran harus sesuai dengan jalur pembayaran yang dipilih';
        END IF;

        IF NOT EXISTS (
            SELECT 1
            FROM mifabot.billing_definition_responsibles responsible
            WHERE responsible.billing_definition_id = NEW.billing_definition_id
              AND responsible.user_id = channel_admin_id
              AND responsible.is_active
        ) THEN
            RAISE EXCEPTION 'Jalur pembayaran bukan milik PJ aktif tagihan';
        END IF;

    ELSIF NEW.submission_type IN ('ADMIN_SELF', 'ADMIN_FOR_USER') THEN
        IF submitted_role NOT IN ('ADMIN', 'SUPER_ADMIN') THEN
            RAISE EXCEPTION 'Pembayaran admin hanya boleh dibuat oleh role ADMIN atau SUPER_ADMIN';
        END IF;
        IF NEW.submission_type = 'ADMIN_SELF' AND NEW.submitted_by <> NEW.user_id THEN
            RAISE EXCEPTION 'ADMIN_SELF harus membayar tagihan milik dirinya sendiri';
        END IF;
        IF NEW.submission_type = 'ADMIN_FOR_USER' AND NEW.submitted_by = NEW.user_id THEN
            RAISE EXCEPTION 'ADMIN_FOR_USER harus membayar tagihan milik user lain';
        END IF;
        IF NEW.payment_channel_id IS NOT NULL THEN
            RAISE EXCEPTION 'Pembayaran oleh admin tidak memakai payment channel';
        END IF;
        IF NEW.routed_to_admin_id IS NULL THEN
            NEW.routed_to_admin_id := NEW.submitted_by;
        END IF;
        IF NEW.routed_to_admin_id <> NEW.submitted_by THEN
            RAISE EXCEPTION 'Pembayaran oleh admin harus diarahkan ke admin yang mengajukan';
        END IF;
        IF NOT EXISTS (
            SELECT 1
            FROM mifabot.billing_definition_responsibles responsible
            WHERE responsible.billing_definition_id = NEW.billing_definition_id
              AND responsible.user_id = NEW.submitted_by
              AND responsible.is_active
        ) THEN
            RAISE EXCEPTION 'Admin bukan PJ aktif tagihan ini';
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
    requested_bill_id, jenis_tagihan, billing_definition_id, ruang_lingkup, submitted_at, submission_type
ON mifabot.payments
FOR EACH ROW EXECUTE FUNCTION mifabot.validate_payment_submission_model();

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

    IF payment_record.ruang_lingkup <> 'ARREARS'
       OR payment_record.billing_definition_id IS NULL THEN
        RAISE EXCEPTION 'Pilihan tunggakan hanya berlaku untuk pembayaran ARREARS';
    END IF;

    SELECT bill.nominal - COALESCE(SUM(allocation.nominal_alokasi), 0)
    INTO outstanding
    FROM mifabot.bills bill
    LEFT JOIN mifabot.payment_allocations allocation ON allocation.bill_id = bill.id
    WHERE bill.id = NEW.bill_id
      AND bill.user_id = payment_record.user_id
      AND bill.billing_definition_id = payment_record.billing_definition_id
      AND bill.periode_selesai < payment_record.submitted_at::date
    GROUP BY bill.id, bill.nominal;

    IF outstanding IS NULL OR NEW.nominal_wajib <> outstanding THEN
        RAISE EXCEPTION 'Pembayaran tunggakan harus sesuai nominal sisa tagihan';
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION mifabot.validate_payment_allocation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    payment_record mifabot.payments%ROWTYPE;
    bill_record mifabot.bills%ROWTYPE;
    total_payment bigint;
    total_bill bigint;
BEGIN
    SELECT * INTO payment_record
    FROM mifabot.payments
    WHERE id = NEW.payment_id
    FOR UPDATE;

    SELECT * INTO bill_record
    FROM mifabot.bills
    WHERE id = NEW.bill_id
    FOR UPDATE;

    IF payment_record.status <> 'APPROVED' THEN
        RAISE EXCEPTION 'Hanya pembayaran APPROVED yang dapat dialokasikan';
    END IF;

    IF payment_record.user_id <> bill_record.user_id
       OR payment_record.billing_definition_id IS DISTINCT FROM bill_record.billing_definition_id THEN
        RAISE EXCEPTION 'Alokasi harus untuk user dan definisi tagihan yang sama';
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
    FROM mifabot.payment_allocations
    WHERE payment_id = NEW.payment_id;
    IF total_payment + NEW.nominal_alokasi > payment_record.nominal THEN
        RAISE EXCEPTION 'Total alokasi melebihi nominal pembayaran';
    END IF;

    SELECT COALESCE(SUM(nominal_alokasi), 0) INTO total_bill
    FROM mifabot.payment_allocations
    WHERE bill_id = NEW.bill_id;
    IF total_bill + NEW.nominal_alokasi > bill_record.nominal THEN
        RAISE EXCEPTION 'Total alokasi melebihi nominal tagihan';
    END IF;

    RETURN NEW;
END;
$$;

-- A dynamic bill is idempotent for one student, definition, and exact period.
-- The old enum-based uniqueness/exclusion constraints remain for legacy rows.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'mifabot.bills'::regclass
          AND conname = 'bills_definition_periode_unik'
    ) THEN
        ALTER TABLE mifabot.bills
            ADD CONSTRAINT bills_definition_periode_unik
            UNIQUE (user_id, billing_definition_id, periode_mulai, periode_selesai);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'mifabot.bills'::regclass
          AND conname = 'bills_definition_periode_tidak_tumpang_tindih'
    ) THEN
        ALTER TABLE mifabot.bills
            ADD CONSTRAINT bills_definition_periode_tidak_tumpang_tindih
            EXCLUDE USING gist (
                user_id WITH =,
                billing_definition_id WITH =,
                daterange(periode_mulai, periode_selesai, '[]') WITH &&
            ) WHERE (billing_definition_id IS NOT NULL);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'mifabot.bills'::regclass
          AND conname = 'bills_sumber_tagihan_wajib'
    ) THEN
        ALTER TABLE mifabot.bills
            ADD CONSTRAINT bills_sumber_tagihan_wajib
            CHECK (billing_definition_id IS NOT NULL OR jenis_tagihan IS NOT NULL)
            NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'mifabot.payments'::regclass
          AND conname = 'payments_sumber_tagihan_wajib'
    ) THEN
        ALTER TABLE mifabot.payments
            ADD CONSTRAINT payments_sumber_tagihan_wajib
            CHECK (billing_definition_id IS NOT NULL OR jenis_tagihan IS NOT NULL)
            NOT VALID;
    END IF;
END $$;

ALTER TABLE mifabot.bills
    ALTER COLUMN nama_tagihan_snapshot SET NOT NULL;

ALTER TABLE mifabot.payments
    ALTER COLUMN nama_tagihan_snapshot SET NOT NULL;

ALTER TABLE mifabot.bills
    VALIDATE CONSTRAINT bills_billing_definition_fk,
    VALIDATE CONSTRAINT bills_sumber_tagihan_wajib;

ALTER TABLE mifabot.payments
    VALIDATE CONSTRAINT payments_billing_definition_fk,
    VALIDATE CONSTRAINT payments_sumber_tagihan_wajib;

CREATE INDEX IF NOT EXISTS bills_definition_user_status_idx
    ON mifabot.bills (billing_definition_id, user_id, status, jatuh_tempo);

CREATE INDEX IF NOT EXISTS payments_definition_status_idx
    ON mifabot.payments (billing_definition_id, status, submitted_at DESC);

DROP TRIGGER IF EXISTS billing_definitions_set_updated_at ON mifabot.billing_definitions;
CREATE TRIGGER billing_definitions_set_updated_at
BEFORE UPDATE ON mifabot.billing_definitions
FOR EACH ROW EXECUTE FUNCTION mifabot.set_updated_at();

DROP TRIGGER IF EXISTS billing_definition_rates_set_updated_at ON mifabot.billing_definition_rates;
CREATE TRIGGER billing_definition_rates_set_updated_at
BEFORE UPDATE ON mifabot.billing_definition_rates
FOR EACH ROW EXECUTE FUNCTION mifabot.set_updated_at();

DROP TRIGGER IF EXISTS student_billing_overrides_set_updated_at ON mifabot.student_billing_overrides;
CREATE TRIGGER student_billing_overrides_set_updated_at
BEFORE UPDATE ON mifabot.student_billing_overrides
FOR EACH ROW EXECUTE FUNCTION mifabot.set_updated_at();

DROP TRIGGER IF EXISTS billing_definition_responsibles_set_updated_at ON mifabot.billing_definition_responsibles;
CREATE TRIGGER billing_definition_responsibles_set_updated_at
BEFORE UPDATE ON mifabot.billing_definition_responsibles
FOR EACH ROW EXECUTE FUNCTION mifabot.set_updated_at();

COMMIT;
