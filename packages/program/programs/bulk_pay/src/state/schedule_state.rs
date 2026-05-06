// ── New: Scheduler types ──────────────────────────────────────────────────────
use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum Recurrence {
    Once,
    Daily,
    Weekly,
    Monthly,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ScheduledRecipient {
    pub wallet: Pubkey, // stored here since scheduler builds tx, not the user
    pub amount: u64,
}

impl ScheduledRecipient {
    pub const LEN: usize = 32 + 8; // 40 bytes
}

#[account]
pub struct ScheduleAccount {
    pub owner: Pubkey, // the sender who created this schedule
    pub mint: Pubkey,  // token mint (USDC)
    pub recurrence: Recurrence,
    pub created_at: i64,
    pub next_run_at: i64, // unix timestamp
    pub max_runs: u32,    // 0 = infinite
    pub runs_completed: u32,
    pub is_active: bool,
    pub bump: u8,
    pub recipients: Vec<ScheduledRecipient>,
}

impl ScheduleAccount {
    // 8 (discriminator) + 32 + 32 + 1 (recurrence) + 8 + 4 + 4 + 1 + 1
    pub const BASE_LEN: usize = 8 + 32 + 32 + 1 + 8 + 8 + 4 + 4 + 1 + 1;

    pub fn space_needed(recipient_count: usize) -> usize {
        Self::BASE_LEN + 4 + recipient_count * ScheduledRecipient::LEN
    }
}

// Tracks the delegation approval — one per sender
#[account]
#[derive(InitSpace)]
pub struct DelegationAccount {
    pub owner: Pubkey,   // the sender
    pub mint: Pubkey,    // token mint the delegation covers
    pub max_amount: u64, // cap on total delegated amount
    pub expires_at: i64, // unix timestamp — delegation auto-expires
    pub is_active: bool,
    pub bump: u8,
    pub created_at: i64,
}
