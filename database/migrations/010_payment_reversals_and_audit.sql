BEGIN;

SET LOCAL search_path TO mifabot, public;

-- A reversal is a separate, immutable business record.  The original
-- payment and its allocations remain traceable through this snapshot even
-- after the live allocations are removed to reopen the affected bills.
CREATE TABLE IF NOT EXISTS mifabot.payment_reversals (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id uuid NOT NULL UNIQUE
        REFERENCES mifabot.payments(id) ON DELETE RESTRICT,
    reversed_by uuid NOT NULL
        REFERENCES mifabot.users(id) ON DELETE RESTRICT,
    reason text NOT NULL,
    reversed_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT payment_reversals_reason_tidak_kosong
        CHECK (btrim(reason) <> '')
);

CREATE TABLE IF NOT EXISTS mifabot.payment_reversal_allocations (
    reversal_id uuid NOT NULL
        REFERENCES mifabot.payment_reversals(id) ON DELETE RESTRICT,
    bill_id uuid NOT NULL
        REFERENCES mifabot.bills(id) ON DELETE RESTRICT,
    nominal_alokasi bigint NOT NULL,
    PRIMARY KEY (reversal_id, bill_id),
    CONSTRAINT payment_reversal_allocations_nominal_positif
        CHECK (nominal_alokasi > 0)
);

CREATE INDEX IF NOT EXISTS payment_reversals_reversed_by_idx
    ON mifabot.payment_reversals (reversed_by, reversed_at DESC);

-- Only the narrowly defined APPROVED -> CANCELLED transition is permitted,
-- and only after a reversal record has been inserted in the same transaction.
CREATE OR REPLACE FUNCTION mifabot.validate_payment_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.status <> 'PENDING' THEN
        IF OLD.status = 'APPROVED'
           AND NEW.status = 'CANCELLED'
           AND EXISTS (
               SELECT 1
               FROM mifabot.payment_reversals pr
               WHERE pr.payment_id = OLD.id
           ) THEN
            RETURN NEW;
        END IF;

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

COMMIT;
