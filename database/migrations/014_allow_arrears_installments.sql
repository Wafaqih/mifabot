BEGIN;

SET search_path TO mifabot, public;

-- `payment_arrears_selections.nominal_wajib` remains a snapshot of the full
-- outstanding balance of every selected bill.  A payment may now cover only
-- part of that selected total; the application allocates it oldest-first when
-- the PJ approves it.
CREATE OR REPLACE FUNCTION mifabot.validate_arrears_payment_total()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    selected_total bigint;
BEGIN
    IF NEW.ruang_lingkup = 'ARREARS' THEN
        SELECT COALESCE(SUM(nominal_wajib), 0) INTO selected_total
        FROM mifabot.payment_arrears_selections
        WHERE payment_id = NEW.id;

        IF selected_total = 0 OR NEW.nominal > selected_total THEN
            RAISE EXCEPTION
                'Nominal pembayaran tunggakan tidak boleh melebihi total tunggakan yang dipilih';
        END IF;
    END IF;
    RETURN NULL;
END;
$$;

COMMIT;
