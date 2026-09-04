-- Legacy DANA data remains valid, while newly configured wallet channels use
-- E_WALLET.  This must be in its own migration: PostgreSQL requires the enum
-- value to be committed before a later migration can reference it.

ALTER TYPE mifabot.jenis_metode_pembayaran
    ADD VALUE IF NOT EXISTS 'E_WALLET';
