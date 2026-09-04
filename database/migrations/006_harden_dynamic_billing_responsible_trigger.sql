-- Ensure an inactive historical PJ can be retained, while an active or
-- reactivated PJ is always an ADMIN/SUPER_ADMIN.  This is separate from 005
-- so databases that already ran the initial dynamic migration receive the
-- hardened trigger too.

BEGIN;

SET LOCAL search_path TO mifabot, public;

-- Apply the operational invariant to definitions created before the service
-- started creating them inactive: an active definition must have a routing PJ.
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
BEFORE INSERT OR UPDATE OF user_id, is_active
ON mifabot.billing_definition_responsibles
FOR EACH ROW EXECUTE FUNCTION mifabot.validate_billing_definition_responsible();

COMMIT;
