BEGIN;

SET LOCAL search_path TO mifabot, public;

-- MIFABOT currently broadcasts every manual group reminder to one configured
-- WhatsApp group. The fixed primary key intentionally enforces that limit.
CREATE TABLE IF NOT EXISTS mifabot.manual_reminder_group_configuration (
    id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    group_jid varchar(100) NOT NULL,
    configured_by uuid REFERENCES mifabot.users(id) ON DELETE SET NULL,
    configured_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT manual_reminder_group_configuration_jid_tidak_kosong
        CHECK (btrim(group_jid) <> '')
);

COMMIT;
