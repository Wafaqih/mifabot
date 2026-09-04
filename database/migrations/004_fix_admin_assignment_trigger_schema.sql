BEGIN;

CREATE OR REPLACE FUNCTION mifabot.validate_admin_assignment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    kode_role varchar(50);
BEGIN
    SELECT r.kode INTO kode_role
    FROM mifabot.users u
    JOIN mifabot.roles r ON r.id = u.role_id
    WHERE u.id = NEW.user_id;

    IF kode_role NOT IN ('ADMIN', 'SUPER_ADMIN') THEN
        RAISE EXCEPTION 'Penugasan admin hanya untuk role ADMIN atau SUPER_ADMIN';
    END IF;

    RETURN NEW;
END;
$$;

COMMIT;