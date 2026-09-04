BEGIN;

SET LOCAL search_path TO mifabot, public;

-- A pending payment is shown to one PJ at a time. NULL means that it is
-- still waiting in the PJ's queue; a value means it is the active review.
ALTER TABLE mifabot.payments
    ADD COLUMN IF NOT EXISTS review_notified_at timestamptz;

CREATE INDEX IF NOT EXISTS payments_review_queue_idx
    ON mifabot.payments (routed_to_admin_id, submitted_at, id)
    WHERE status = 'PENDING' AND review_notified_at IS NULL;

CREATE INDEX IF NOT EXISTS payments_active_review_idx
    ON mifabot.payments (routed_to_admin_id, review_notified_at)
    WHERE status = 'PENDING' AND review_notified_at IS NOT NULL;

COMMIT;
