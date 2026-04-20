-- Batches: one row per bulk_transfer call
CREATE TABLE batches (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_pubkey   VARCHAR(44) NOT NULL,
    tx_signature    VARCHAR(88) UNIQUE,
    status          VARCHAR(16) NOT NULL DEFAULT 'pending',
    total_amount    BIGINT      NOT NULL,
    recipient_count INT         NOT NULL,
    mint_address    VARCHAR(44) NOT NULL,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    confirmed_at    TIMESTAMPTZ,

    CONSTRAINT batches_status_check
        CHECK (status IN ('pending', 'confirmed', 'failed'))
);

CREATE TABLE batch_items (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id      UUID        NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
    wallet_pubkey VARCHAR(44) NOT NULL,
    name          VARCHAR(64),
    description   TEXT,                         -- ✅ per-recipient description
    amount        BIGINT      NOT NULL,
    ata_address   VARCHAR(44),
    ata_exists    BOOLEAN     NOT NULL DEFAULT false,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_batches_sender    ON batches (sender_pubkey);
CREATE INDEX idx_batches_status    ON batches (status);
CREATE INDEX idx_batch_items_batch ON batch_items (batch_id);
