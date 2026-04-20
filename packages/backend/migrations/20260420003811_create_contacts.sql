CREATE TABLE contacts (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_pubkey  VARCHAR(44) NOT NULL,
    wallet_pubkey VARCHAR(44) NOT NULL,
    name          VARCHAR(64) NOT NULL,
    email         VARCHAR(128),
    description   TEXT,                         -- ✅ default description for this contact
    notes         TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (owner_pubkey, wallet_pubkey)
);

CREATE INDEX idx_contacts_owner ON contacts (owner_pubkey);
