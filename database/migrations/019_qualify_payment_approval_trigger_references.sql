BEGIN;

-- All approval-path trigger functions must work with a restricted search_path.
CREATE OR REPLACE FUNCTION mifabot.validate_payment_allocation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    payment_record mifabot.payments%ROWTYPE;
    bill_record mifabot.bills%ROWTYPE;
    total_payment bigint;
    total_bill bigint;
BEGIN
    SELECT *
    INTO payment_record
    FROM mifabot.payments
    WHERE id = NEW.payment_id
    FOR UPDATE;

    SELECT *
    INTO bill_record
    FROM mifabot.bills
    WHERE id = NEW.bill_id
    FOR UPDATE;

    IF payment_record.status <> 'APPROVED' THEN
        RAISE EXCEPTION 'Hanya pembayaran APPROVED yang dapat dialokasikan';
    END IF;

    IF payment_record.user_id <> bill_record.user_id
       OR payment_record.jenis_tagihan <> bill_record.jenis_tagihan THEN
        RAISE EXCEPTION 'Alokasi harus untuk user dan jenis tagihan yang sama';
    END IF;

    IF payment_record.ruang_lingkup = 'CURRENT_BILL'
       AND payment_record.requested_bill_id <> NEW.bill_id THEN
        RAISE EXCEPTION 'CURRENT_BILL hanya boleh dialokasikan ke tagihan yang dipilih';
    END IF;

    IF payment_record.ruang_lingkup = 'ARREARS'
       AND bill_record.periode_selesai >= payment_record.submitted_at::date THEN
        RAISE EXCEPTION 'ARREARS hanya boleh dialokasikan ke periode sebelum tanggal pengajuan';
    END IF;

    SELECT COALESCE(SUM(nominal_alokasi), 0)
    INTO total_payment
    FROM mifabot.payment_allocations
    WHERE payment_id = NEW.payment_id;
    IF total_payment + NEW.nominal_alokasi > payment_record.nominal THEN
        RAISE EXCEPTION 'Total alokasi melebihi nominal pembayaran';
    END IF;

    SELECT COALESCE(SUM(nominal_alokasi), 0)
    INTO total_bill
    FROM mifabot.payment_allocations
    WHERE bill_id = NEW.bill_id;
    IF total_bill + NEW.nominal_alokasi > bill_record.nominal THEN
        RAISE EXCEPTION 'Total alokasi melebihi nominal tagihan';
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION mifabot.approved_payment_must_be_fully_allocated()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    total_teralokasi bigint;
BEGIN
    IF NEW.status = 'APPROVED' THEN
        SELECT COALESCE(SUM(nominal_alokasi), 0)
        INTO total_teralokasi
        FROM mifabot.payment_allocations
        WHERE payment_id = NEW.id;

        IF total_teralokasi <> NEW.nominal THEN
            RAISE EXCEPTION 'Pembayaran APPROVED harus dialokasikan penuh sebelum transaksi di-commit';
        END IF;
    END IF;

    RETURN NULL;
END;
$$;

COMMIT;
