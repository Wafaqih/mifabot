BEGIN;

-- This function can be reached through a trigger with a restricted
-- search_path, so every schema-owned relation and type is explicit.
CREATE OR REPLACE FUNCTION mifabot.update_bill_status(p_bill_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    nominal_tagihan bigint;
    total_teralokasi bigint;
BEGIN
    SELECT nominal
    INTO nominal_tagihan
    FROM mifabot.bills
    WHERE id = p_bill_id;

    SELECT COALESCE(SUM(nominal_alokasi), 0)
    INTO total_teralokasi
    FROM mifabot.payment_allocations
    WHERE bill_id = p_bill_id;

    UPDATE mifabot.bills
    SET status = CASE
        WHEN total_teralokasi = 0 THEN 'BELUM_BAYAR'::mifabot.status_tagihan
        WHEN total_teralokasi < nominal_tagihan THEN 'CICIL'::mifabot.status_tagihan
        ELSE 'LUNAS'::mifabot.status_tagihan
    END
    WHERE id = p_bill_id;
END;
$$;

COMMIT;
