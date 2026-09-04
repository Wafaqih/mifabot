BEGIN;

SET LOCAL search_path TO mifabot, public;

CREATE TYPE mifabot.activity_schedule_type AS ENUM (
    'DAILY', 'WEEKLY', 'MONTHLY', 'CUSTOM'
);
CREATE TYPE mifabot.activity_schedule_status AS ENUM (
    'ACTIVE', 'PAUSED', 'ARCHIVED'
);
CREATE TYPE mifabot.activity_custom_schedule_mode AS ENUM (
    'INTERVAL', 'DATES'
);
CREATE TYPE mifabot.activity_reminder_source AS ENUM ('AUTOMATIC', 'MANUAL');
CREATE TYPE mifabot.activity_reminder_target AS ENUM ('GROUP', 'USER');

CREATE TABLE mifabot.activity_schedules (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    nama varchar(150) NOT NULL,
    schedule_type mifabot.activity_schedule_type NOT NULL,
    status mifabot.activity_schedule_status NOT NULL DEFAULT 'ACTIVE',
    timezone varchar(100) NOT NULL DEFAULT 'Asia/Jakarta',
    start_date date NOT NULL,
    start_time time NOT NULL,
    interval_value smallint NOT NULL DEFAULT 1,
    weekly_days smallint[] NOT NULL DEFAULT '{}',
    monthly_days smallint[] NOT NULL DEFAULT '{}',
    custom_mode mifabot.activity_custom_schedule_mode,
    custom_unit varchar(10),
    group_jid varchar(100),
    reminder_offsets_minutes smallint[] NOT NULL DEFAULT ARRAY[-30, 0]::smallint[],
    created_by uuid REFERENCES mifabot.users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT activity_schedules_nama_tidak_kosong CHECK (btrim(nama) <> ''),
    CONSTRAINT activity_schedules_interval_valid CHECK (interval_value > 0),
    CONSTRAINT activity_schedules_weekly_days_valid CHECK (
        weekly_days <@ ARRAY[1,2,3,4,5,6,7]::smallint[]
    ),
    CONSTRAINT activity_schedules_monthly_days_valid CHECK (
        monthly_days <@ ARRAY[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31]::smallint[]
    ),
    CONSTRAINT activity_schedules_custom_unit_valid CHECK (
        custom_unit IS NULL OR custom_unit IN ('DAYS', 'WEEKS', 'MONTHS')
    ),
    CONSTRAINT activity_schedules_group_jid_valid CHECK (
        group_jid IS NULL OR group_jid ~ '^[0-9]+(?:-[0-9]+)?@g[.]us$'
    ),
    CONSTRAINT activity_schedules_recurrence_valid CHECK (
        (schedule_type = 'DAILY' AND cardinality(weekly_days) = 0 AND cardinality(monthly_days) = 0 AND custom_mode IS NULL AND custom_unit IS NULL)
        OR (schedule_type = 'WEEKLY' AND cardinality(weekly_days) > 0 AND cardinality(monthly_days) = 0 AND custom_mode IS NULL AND custom_unit IS NULL)
        OR (schedule_type = 'MONTHLY' AND cardinality(weekly_days) = 0 AND cardinality(monthly_days) > 0 AND custom_mode IS NULL AND custom_unit IS NULL)
        OR (schedule_type = 'CUSTOM' AND cardinality(weekly_days) = 0 AND cardinality(monthly_days) = 0 AND custom_mode IS NOT NULL
            AND ((custom_mode = 'INTERVAL' AND custom_unit IS NOT NULL) OR (custom_mode = 'DATES' AND custom_unit IS NULL)))
    )
);

CREATE UNIQUE INDEX activity_schedules_nama_unik
    ON mifabot.activity_schedules (LOWER(btrim(nama)));
CREATE INDEX activity_schedules_aktif_idx
    ON mifabot.activity_schedules (status, start_date);

-- weekday is NULL for a roster that applies to every occurrence.  A daily
-- schedule may instead declare a different roster for each ISO weekday.
CREATE TABLE mifabot.activity_schedule_members (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    schedule_id uuid NOT NULL REFERENCES mifabot.activity_schedules(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES mifabot.users(id) ON DELETE RESTRICT,
    weekday smallint,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT activity_schedule_members_weekday_valid CHECK (weekday BETWEEN 1 AND 7)
);
CREATE UNIQUE INDEX activity_schedule_members_unik
    ON mifabot.activity_schedule_members (schedule_id, user_id, COALESCE(weekday, 0));
CREATE INDEX activity_schedule_members_lookup_idx
    ON mifabot.activity_schedule_members (schedule_id, weekday);

CREATE TABLE mifabot.activity_schedule_custom_dates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    schedule_id uuid NOT NULL REFERENCES mifabot.activity_schedules(id) ON DELETE CASCADE,
    occurrence_date date NOT NULL,
    occurrence_time time NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT activity_schedule_custom_dates_unik UNIQUE (schedule_id, occurrence_date, occurrence_time)
);
CREATE INDEX activity_schedule_custom_dates_lookup_idx
    ON mifabot.activity_schedule_custom_dates (schedule_id, occurrence_date, occurrence_time);

CREATE TABLE mifabot.activity_reminder_manual_batches (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    schedule_id uuid NOT NULL REFERENCES mifabot.activity_schedules(id) ON DELETE RESTRICT,
    occurrence_date date NOT NULL,
    occurrence_time time NOT NULL,
    requested_by uuid REFERENCES mifabot.users(id) ON DELETE SET NULL,
    requested_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE mifabot.activity_reminder_deliveries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    delivery_key varchar(255) NOT NULL UNIQUE,
    schedule_id uuid NOT NULL REFERENCES mifabot.activity_schedules(id) ON DELETE RESTRICT,
    manual_batch_id uuid REFERENCES mifabot.activity_reminder_manual_batches(id) ON DELETE RESTRICT,
    occurrence_date date NOT NULL,
    occurrence_time time NOT NULL,
    reminder_offset_minutes smallint,
    source mifabot.activity_reminder_source NOT NULL,
    target_type mifabot.activity_reminder_target NOT NULL,
    group_jid varchar(100),
    user_id uuid REFERENCES mifabot.users(id) ON DELETE SET NULL,
    message_body text NOT NULL,
    status mifabot.status_notifikasi NOT NULL DEFAULT 'PENDING',
    attempt_count integer NOT NULL DEFAULT 1,
    last_attempt_at timestamptz NOT NULL DEFAULT now(),
    sent_at timestamptz,
    failure_reason text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT activity_reminder_deliveries_target_valid CHECK (
        (target_type = 'GROUP' AND group_jid IS NOT NULL AND user_id IS NULL)
        OR (target_type = 'USER' AND user_id IS NOT NULL AND group_jid IS NULL)
    ),
    CONSTRAINT activity_reminder_deliveries_source_valid CHECK (
        (source = 'AUTOMATIC' AND manual_batch_id IS NULL AND reminder_offset_minutes IS NOT NULL)
        OR (source = 'MANUAL' AND manual_batch_id IS NOT NULL AND reminder_offset_minutes IS NULL)
    )
);
CREATE INDEX activity_reminder_deliveries_pending_idx
    ON mifabot.activity_reminder_deliveries (status, created_at)
    WHERE status IN ('PENDING', 'FAILED');

CREATE TRIGGER activity_schedules_set_updated_at
BEFORE UPDATE ON mifabot.activity_schedules
FOR EACH ROW EXECUTE FUNCTION mifabot.set_updated_at();

CREATE TRIGGER activity_reminder_deliveries_set_updated_at
BEFORE UPDATE ON mifabot.activity_reminder_deliveries
FOR EACH ROW EXECUTE FUNCTION mifabot.set_updated_at();

COMMIT;
