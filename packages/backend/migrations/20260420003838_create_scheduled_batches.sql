-- Scheduler delegations: mirrors on-chain DelegationAccount
-- Used for fast pre-flight checks without an RPC call
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

-- Scheduled batches: one row per schedule execution slot
-- A recurring schedule inserts a new row after each successful run
CREATE TABLE scheduled_batches (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_pubkey   VARCHAR(44) NOT NULL,
    schedule_pda    VARCHAR(44) NOT NULL,
    delegation_id   UUID        REFERENCES scheduler_delegations(id),
    mint_address    VARCHAR(44) NOT NULL,
    recipients      JSONB       NOT NULL,        -- [{wallet, amount, name}]
    recurrence      VARCHAR(16) NOT NULL,
    scheduled_at    TIMESTAMPTZ NOT NULL,        -- when this execution should fire
    status          VARCHAR(16) NOT NULL DEFAULT 'pending',
    retry_count     INT         NOT NULL DEFAULT 0,
    last_error      TEXT,
    tx_signature    VARCHAR(88),
    runs_completed  INT         NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    confirmed_at    TIMESTAMPTZ,

    CONSTRAINT scheduled_batches_status_check
        CHECK (status IN ('pending', 'running', 'confirmed', 'failed', 'cancelled')),
    CONSTRAINT scheduled_batches_recurrence_check
        CHECK (recurrence IN ('once', 'daily', 'weekly', 'monthly'))
);

CREATE INDEX idx_scheduled_batches_sender     ON scheduled_batches (sender_pubkey);
CREATE INDEX idx_scheduled_batches_status     ON scheduled_batches (status);
CREATE INDEX idx_scheduled_batches_due        ON scheduled_batches (scheduled_at)
    WHERE status = 'pending';                   -- partial index — only pending rows
CREATE INDEX idx_scheduler_delegations_sender ON scheduler_delegations (sender_pubkey);
