BEGIN;

SET LOCAL search_path TO mifabot, public;

ALTER TABLE mifabot.payment_channels
    ADD COLUMN IF NOT EXISTS instruksi text;

ALTER TABLE mifabot.payment_channels
    DROP CONSTRAINT IF EXISTS payment_channels_rekening_sesuai_metode;

ALTER TABLE mifabot.payment_channels
    ADD CONSTRAINT payment_channels_rekening_sesuai_metode CHECK (
        (metode = 'CASH' AND nomor_rekening IS NULL)
        OR (
            metode IN ('DANA', 'E_WALLET', 'BANK_TRANSFER')
            AND btrim(COALESCE(nomor_rekening, '')) <> ''
        )
    );

-- The relation is deliberately kept separately so a channel's history is
-- retained even after it is deactivated.
CREATE TABLE IF NOT EXISTS mifabot.payment_channel_definitions (
    payment_channel_id uuid NOT NULL
        REFERENCES mifabot.payment_channels(id) ON DELETE RESTRICT,
    billing_definition_id uuid NOT NULL
        REFERENCES mifabot.billing_definitions(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (payment_channel_id, billing_definition_id)
);

CREATE INDEX IF NOT EXISTS payment_channel_definitions_definition_idx
    ON mifabot.payment_channel_definitions (billing_definition_id, payment_channel_id);

-- Preserve the previous behaviour for existing data: a legacy channel is
-- available on every definition whose active PJ owns that channel.
INSERT INTO mifabot.payment_channel_definitions (
    payment_channel_id, billing_definition_id
)
SELECT pc.id, br.billing_definition_id
FROM mifabot.payment_channels pc
JOIN mifabot.billing_definition_responsibles br
  ON br.user_id = pc.admin_user_id
 AND br.is_active
ON CONFLICT DO NOTHING;

-- User self-payment must use a channel that belongs to the same definition,
-- in addition to its owner still being an active PJ for that definition.
CREATE OR REPLACE FUNCTION mifabot.validate_payment_channel_definition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.submission_type = 'USER_SELF' THEN
        IF NOT EXISTS (
            SELECT 1
            FROM mifabot.payment_channels pc
            JOIN mifabot.payment_channel_definitions pcd
              ON pcd.payment_channel_id = pc.id
             AND pcd.billing_definition_id = NEW.billing_definition_id
            JOIN mifabot.billing_definition_responsibles br
              ON br.billing_definition_id = NEW.billing_definition_id
             AND br.user_id = pc.admin_user_id
             AND br.is_active
            WHERE pc.id = NEW.payment_channel_id
              AND pc.is_active
        ) THEN
            RAISE EXCEPTION 'Jalur pembayaran tidak tersedia untuk tagihan ini';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payments_validasi_channel_tagihan ON mifabot.payments;
CREATE TRIGGER payments_validasi_channel_tagihan
BEFORE INSERT OR UPDATE OF payment_channel_id, billing_definition_id, submission_type
ON mifabot.payments
FOR EACH ROW EXECUTE FUNCTION mifabot.validate_payment_channel_definition();

-- Legacy display values are normalised to the permanent category ordering.
UPDATE mifabot.payment_channels
SET urutan = CASE
    WHEN metode = 'BANK_TRANSFER' THEN 1
    WHEN metode IN ('DANA', 'E_WALLET') THEN 2
    WHEN metode = 'CASH' THEN 3
    ELSE urutan
END;

COMMIT;
