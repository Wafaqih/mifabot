-- The first rate of a recurring definition is part of creating that
-- definition, so it must cover the current whole period.  Older versions
-- started a rate on the day a definition was created; a definition made
-- mid-period therefore could not issue its current bill.
WITH current_periods AS (
    SELECT
        id,
        CASE interval
            WHEN 'WEEKLY' THEN date_trunc('week', CURRENT_DATE)::date
            WHEN 'MONTHLY' THEN date_trunc('month', CURRENT_DATE)::date
            WHEN 'YEARLY' THEN date_trunc('year', CURRENT_DATE)::date
        END AS period_start
    FROM mifabot.billing_definitions
    WHERE is_active
      AND interval IN ('WEEKLY', 'MONTHLY', 'YEARLY')
), rates_to_realign AS (
    SELECT rate.id, period.period_start
    FROM current_periods period
    JOIN mifabot.billing_definition_rates rate
      ON rate.billing_definition_id = period.id
     AND rate.berlaku_mulai > period.period_start
     AND rate.berlaku_mulai <= CURRENT_DATE
    WHERE NOT EXISTS (
        SELECT 1
        FROM mifabot.billing_definition_rates existing_rate
        WHERE existing_rate.billing_definition_id = period.id
          AND existing_rate.berlaku_mulai <= period.period_start
          AND (existing_rate.berlaku_sampai IS NULL OR existing_rate.berlaku_sampai >= period.period_start)
    )
      AND NOT EXISTS (
        SELECT 1
        FROM mifabot.billing_definition_rates earlier_rate
        WHERE earlier_rate.billing_definition_id = period.id
          AND earlier_rate.berlaku_mulai > period.period_start
          AND earlier_rate.berlaku_mulai < rate.berlaku_mulai
    )
)
UPDATE mifabot.billing_definition_rates rate
SET berlaku_mulai = realignment.period_start
FROM rates_to_realign realignment
WHERE rate.id = realignment.id;
