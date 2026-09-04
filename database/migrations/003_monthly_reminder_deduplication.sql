BEGIN;

ALTER TABLE mifabot.notifications
    ADD CONSTRAINT notifications_reminder_unik
    UNIQUE (user_id, notification_type, related_bill_id);

COMMIT;