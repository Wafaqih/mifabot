-- Dynamic billing reminders.
--
-- Reminder rules belong to a billing definition and are evaluated against a
-- bill's due date.  Delivery rows are the source of truth for deduplication
-- and audit, so several H-offset rules can legitimately notify the same bill.

BEGIN;

SET LOCAL search_path TO mifabot, public;

CREATE TABLE IF NOT EXISTS mifabot.billing_reminder_rules (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    billing_definition_id uuid NOT NULL
        REFERENCES mifabot.billing_definitions(id) ON DELETE RESTRICT,
    -- Example: H-7 is -7, H-0 is 0, and H+3 is 3.
    offset_days smallint NOT NULL,
    is_active boolean NOT NULL DEFAULT true,
    configured_by uuid REFERENCES mifabot.users(id) ON DELETE SET NULL,
    deactivated_by uuid REFERENCES mifabot.users(id) ON DELETE SET NULL,
    deactivated_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT billing_reminder_rules_status_konsisten CHECK (
        (is_active AND deactivated_at IS NULL)
        OR (NOT is_active AND deactivated_at IS NOT NULL)
    )
);

-- A replacement rule is inserted after an old rule is deactivated.  Keeping
-- inactive rows allows configuration and delivery history to remain auditable.
CREATE UNIQUE INDEX IF NOT EXISTS billing_reminder_rules_satu_aktif
    ON mifabot.billing_reminder_rules (billing_definition_id, offset_days)
    WHERE is_active;

CREATE INDEX IF NOT EXISTS billing_reminder_rules_aktif_lookup_idx
    ON mifabot.billing_reminder_rules (billing_definition_id, offset_days)
    WHERE is_active;

CREATE TABLE IF NOT EXISTS mifabot.billing_reminder_manual_batches (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    billing_definition_id uuid NOT NULL
        REFERENCES mifabot.billing_definitions(id) ON DELETE RESTRICT,
    -- Root WhatsApp authorization can exist without a corresponding users row,
    -- so the actor is retained when known but is intentionally optional.
    requested_by uuid REFERENCES mifabot.users(id) ON DELETE SET NULL,
    -- The command is evaluated against this date, making a manual dispatch
    -- reproducible even when it is inspected later.
    as_of_date date NOT NULL DEFAULT CURRENT_DATE,
    requested_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS billing_reminder_manual_batches_definition_idx
    ON mifabot.billing_reminder_manual_batches (
        billing_definition_id,
        requested_at DESC
    );

CREATE TABLE IF NOT EXISTS mifabot.billing_reminder_deliveries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    billing_reminder_rule_id uuid
        REFERENCES mifabot.billing_reminder_rules(id) ON DELETE RESTRICT,
    billing_reminder_manual_batch_id uuid
        REFERENCES mifabot.billing_reminder_manual_batches(id) ON DELETE RESTRICT,
    bill_id uuid NOT NULL REFERENCES mifabot.bills(id) ON DELETE RESTRICT,
    user_id uuid NOT NULL REFERENCES mifabot.users(id) ON DELETE RESTRICT,
    -- For an automatic reminder this is jatuh_tempo + offset_days.  For a
    -- manual reminder it is the batch's as_of_date.
    scheduled_for date NOT NULL,
    message_body text NOT NULL,
    status mifabot.status_notifikasi NOT NULL DEFAULT 'PENDING',
    sent_at timestamptz,
    failure_reason text,
    attempt_count integer NOT NULL DEFAULT 0,
    last_attempt_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT billing_reminder_deliveries_sumber_valid CHECK (
        (billing_reminder_rule_id IS NOT NULL
            AND billing_reminder_manual_batch_id IS NULL)
        OR (billing_reminder_rule_id IS NULL
            AND billing_reminder_manual_batch_id IS NOT NULL)
    ),
    CONSTRAINT billing_reminder_deliveries_pesan_tidak_kosong CHECK (
        btrim(message_body) <> ''
    ),
    CONSTRAINT billing_reminder_deliveries_jumlah_percobaan_valid CHECK (
        attempt_count >= 0
    ),
    CONSTRAINT billing_reminder_deliveries_status_konsisten CHECK (
        (status = 'SENT' AND sent_at IS NOT NULL AND failure_reason IS NULL)
        OR (status = 'PENDING' AND sent_at IS NULL AND failure_reason IS NULL)
        OR (status = 'FAILED' AND sent_at IS NULL AND failure_reason IS NOT NULL)
    )
);

-- One automatic rule may produce at most one delivery per bill.  Failed rows
-- are retried by changing the same row back to PENDING; they are never copied.
CREATE UNIQUE INDEX IF NOT EXISTS billing_reminder_deliveries_auto_unik
    ON mifabot.billing_reminder_deliveries (billing_reminder_rule_id, bill_id)
    WHERE billing_reminder_rule_id IS NOT NULL;

-- A repeated manual command intentionally makes a new batch.  Within one
-- batch, however, a bill can only be selected once.
CREATE UNIQUE INDEX IF NOT EXISTS billing_reminder_deliveries_manual_unik
    ON mifabot.billing_reminder_deliveries (billing_reminder_manual_batch_id, bill_id)
    WHERE billing_reminder_manual_batch_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS billing_reminder_deliveries_pending_idx
    ON mifabot.billing_reminder_deliveries (status, scheduled_for, created_at)
    WHERE status IN ('PENDING', 'FAILED');

CREATE INDEX IF NOT EXISTS billing_reminder_deliveries_bill_idx
    ON mifabot.billing_reminder_deliveries (bill_id, created_at DESC);

CREATE OR REPLACE FUNCTION mifabot.protect_billing_reminder_rule_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF OLD.billing_definition_id <> NEW.billing_definition_id
           OR OLD.offset_days <> NEW.offset_days
           OR OLD.configured_by IS DISTINCT FROM NEW.configured_by THEN
            RAISE EXCEPTION
                'Definisi, offset, dan pembuat aturan reminder tidak dapat diubah';
        END IF;

        IF NOT OLD.is_active AND NEW.is_active THEN
            RAISE EXCEPTION
                'Aturan reminder yang sudah nonaktif tidak dapat diaktifkan kembali; buat aturan baru';
        END IF;

        IF OLD.is_active AND NOT NEW.is_active THEN
            NEW.deactivated_at := COALESCE(NEW.deactivated_at, now());
        ELSIF OLD.is_active AND NEW.is_active THEN
            NEW.deactivated_at := NULL;
            NEW.deactivated_by := NULL;
        ELSE
            -- Historical deactivation metadata is immutable as well.
            NEW.deactivated_at := OLD.deactivated_at;
            NEW.deactivated_by := OLD.deactivated_by;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION mifabot.validate_billing_reminder_delivery()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    bill_user_id uuid;
    bill_definition_id uuid;
    bill_jatuh_tempo date;
    source_definition_id uuid;
    source_as_of_date date;
    source_offset_days smallint;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF OLD.billing_reminder_rule_id IS DISTINCT FROM NEW.billing_reminder_rule_id
           OR OLD.billing_reminder_manual_batch_id IS DISTINCT FROM NEW.billing_reminder_manual_batch_id
           OR OLD.bill_id <> NEW.bill_id
           OR OLD.user_id <> NEW.user_id
           OR OLD.scheduled_for <> NEW.scheduled_for THEN
            RAISE EXCEPTION 'Sumber, target, dan jadwal delivery reminder tidak dapat diubah';
        END IF;
    END IF;

    SELECT bill.user_id, bill.billing_definition_id, bill.jatuh_tempo
    INTO bill_user_id, bill_definition_id, bill_jatuh_tempo
    FROM mifabot.bills bill
    WHERE bill.id = NEW.bill_id;

    IF NOT FOUND OR bill_definition_id IS NULL THEN
        RAISE EXCEPTION 'Tagihan reminder tidak ditemukan atau belum memiliki definisi';
    END IF;

    IF NEW.user_id <> bill_user_id THEN
        RAISE EXCEPTION 'Penerima reminder harus sama dengan pemilik tagihan';
    END IF;

    IF NEW.billing_reminder_rule_id IS NOT NULL THEN
        SELECT rule.billing_definition_id, rule.offset_days
        INTO source_definition_id, source_offset_days
        FROM mifabot.billing_reminder_rules rule
        WHERE rule.id = NEW.billing_reminder_rule_id;

        IF NOT FOUND OR source_definition_id <> bill_definition_id THEN
            RAISE EXCEPTION 'Aturan reminder tidak sesuai dengan definisi tagihan';
        END IF;

        IF NEW.scheduled_for <> bill_jatuh_tempo + source_offset_days THEN
            RAISE EXCEPTION 'Jadwal reminder otomatis harus sesuai jatuh tempo dan offset aturan';
        END IF;
    ELSE
        SELECT batch.billing_definition_id, batch.as_of_date
        INTO source_definition_id, source_as_of_date
        FROM mifabot.billing_reminder_manual_batches batch
        WHERE batch.id = NEW.billing_reminder_manual_batch_id;

        IF NOT FOUND OR source_definition_id <> bill_definition_id THEN
            RAISE EXCEPTION 'Batch reminder manual tidak sesuai dengan definisi tagihan';
        END IF;

        IF NEW.scheduled_for <> source_as_of_date THEN
            RAISE EXCEPTION 'Jadwal reminder manual harus sama dengan tanggal batch';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS billing_reminder_rules_lindungi_riwayat
    ON mifabot.billing_reminder_rules;
CREATE TRIGGER billing_reminder_rules_lindungi_riwayat
BEFORE UPDATE ON mifabot.billing_reminder_rules
FOR EACH ROW EXECUTE FUNCTION mifabot.protect_billing_reminder_rule_history();

DROP TRIGGER IF EXISTS billing_reminder_rules_set_updated_at
    ON mifabot.billing_reminder_rules;
CREATE TRIGGER billing_reminder_rules_set_updated_at
BEFORE UPDATE ON mifabot.billing_reminder_rules
FOR EACH ROW EXECUTE FUNCTION mifabot.set_updated_at();

DROP TRIGGER IF EXISTS billing_reminder_deliveries_validasi
    ON mifabot.billing_reminder_deliveries;
CREATE TRIGGER billing_reminder_deliveries_validasi
BEFORE INSERT OR UPDATE ON mifabot.billing_reminder_deliveries
FOR EACH ROW EXECUTE FUNCTION mifabot.validate_billing_reminder_delivery();

DROP TRIGGER IF EXISTS billing_reminder_deliveries_set_updated_at
    ON mifabot.billing_reminder_deliveries;
CREATE TRIGGER billing_reminder_deliveries_set_updated_at
BEFORE UPDATE ON mifabot.billing_reminder_deliveries
FOR EACH ROW EXECUTE FUNCTION mifabot.set_updated_at();

-- Preserve the established reminder cadence for the migrated monthly
-- definition.  No default is imposed on newer or CUSTOM definitions.
INSERT INTO mifabot.billing_reminder_rules (
    billing_definition_id,
    offset_days
)
SELECT definition.id, default_rule.offset_days
FROM mifabot.billing_definitions definition
CROSS JOIN (VALUES (-4::smallint), (-2::smallint), (0::smallint))
    AS default_rule(offset_days)
WHERE definition.kode = 'BULANAN'
  AND NOT EXISTS (
      SELECT 1
      FROM mifabot.billing_reminder_rules rule
      WHERE rule.billing_definition_id = definition.id
        AND rule.offset_days = default_rule.offset_days
        AND rule.is_active
  );

COMMIT;
