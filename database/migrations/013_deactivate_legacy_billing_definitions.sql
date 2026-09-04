BEGIN;

SET LOCAL search_path TO mifabot, public;

-- Preserve historic bills and payments, but remove the retired definitions
-- from every active billing surface (profile, payment, and reminders).
UPDATE mifabot.billing_definitions
SET is_active = false,
    updated_at = now()
WHERE LOWER(btrim(nama)) IN (
    'bulanan',
    'tahunan',
    'pendidikan',
    'kesejahteraan'
)
  AND is_active;

COMMIT;
