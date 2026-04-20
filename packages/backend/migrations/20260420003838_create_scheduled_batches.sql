CREATE TABLE scheduler_delegations (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_pubkey   VARCHAR(44) NOT NULL,
    delegate_pda    VARCHAR(44) NOT NULL,
    mint_address    VARCHAR(44) NOT NULL,
    max_amount      BIGINT      NOT NULL,
    expires_at      TIMESTAMPTZ NOT NULL,
    is_active       BOOLEAN     NOT NULL DEFAULT true,
    revoked_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (sender_pubkey, mint_address)
);

CREATE TABLE scheduled_batches (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_pubkey   VARCHAR(44) NOT NULL,
    schedule_pda    VARCHAR(44) NOT NULL,
    delegation_id   UUID        REFERENCES scheduler_delegations(id),
    mint_address    VARCHAR(44) NOT NULL,
    recipients      JSONB       NOT NULL,
    recurrence      VARCHAR(16) NOT NULL,
    scheduled_at    TIMESTAMPTZ NOT NULL,
    status          VARCHAR(16) NOT NULL DEFAULT 'pending',
    retry_count     INT         NOT NULL DEFAULT 0,
    last_error      TEXT,
    tx_signature    VARCHAR(88),
    runs_completed  INT         NOT NULL DEFAULT 0,
    max_runs        INT         NOT NULL DEFAULT 0,  -- 0 = infinite, mirrors on-chain
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    confirmed_at    TIMESTAMPTZ,

    CONSTRAINT scheduled_batches_status_check
        CHECK (status IN ('pending', 'running', 'confirmed', 'failed', 'cancelled')),
    CONSTRAINT scheduled_batches_recurrence_check
        CHECK (recurrence IN ('once', 'daily', 'weekly', 'monthly'))
);

CREATE INDEX idx_scheduled_batches_sender ON scheduled_batches (sender_pubkey);
CREATE INDEX idx_scheduled_batches_status ON scheduled_batches (status);
CREATE INDEX idx_scheduled_batches_due    ON scheduled_batches (scheduled_at)
    WHERE status = 'pending';
CREATE INDEX idx_scheduler_delegations_sender ON scheduler_delegations (sender_pubkey);
