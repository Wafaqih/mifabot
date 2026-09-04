BEGIN;

SET LOCAL search_path TO mifabot, public;

-- The trigger function may execute with a search_path that does not include
-- mifabot. Qualifying this function call keeps payment approval atomic.
CREATE OR REPLACE FUNCTION mifabot.refresh_bill_status_after_allocation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM mifabot.update_bill_status(NEW.bill_id);
    RETURN NEW;
END;
$$;

COMMIT;
