-- Nonces: short-lived challenges for wallet signature verification
-- Each nonce is single-use — deleted immediately after verification
CREATE TABLE nonces (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet      VARCHAR(44) NOT NULL,
    nonce       VARCHAR(64) NOT NULL UNIQUE,
    expires_at  TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '5 minutes',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast lookup by wallet + nonce during verification
CREATE INDEX idx_nonces_wallet  ON nonces (wallet);

-- Nonces expire after 5 minutes — this index lets Postgres
-- efficiently clean up expired rows
CREATE INDEX idx_nonces_expires ON nonces (expires_at);
