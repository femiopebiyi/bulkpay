use anchor_lang::prelude::*;

#[error_code]
pub enum BulkTransferError {
    // ── bulk_transfer errors ──────────────────────────────────────────────────

    #[msg("remaining_accounts must be exactly 1 account per recipient (ATA only)")]
    InvalidAccountCount,

    #[msg("ATA does not match derived address for recipient + mint")]
    InvalidAta,

    #[msg("ATA account is not writable")]
    AtaNotWritable,

    #[msg("ATA does not exist — run the pre-ATA pass before calling this instruction")]
    AtaNotCreated,

    #[msg("Sender has insufficient token balance to cover the full batch")]
    InsufficientBalance,

    #[msg("Arithmetic overflow")]
    Overflow,

    #[msg("Unauthorized — signer does not own this account")]
    Unauthorized,

    // ── Scheduler errors ──────────────────────────────────────────────────────

    #[msg("Delegation amount must be greater than zero")]
    InvalidDelegationAmount,

    #[msg("Delegation has been revoked or does not exist")]
    DelegationInactive,

    #[msg("Delegation has expired")]
    DelegationExpired,

    #[msg("Delegation is still active — revoke it before closing")]
    DelegationStillActive,

    #[msg("Transfer amount exceeds delegated maximum")]
    ExceedsDelegationLimit,

    #[msg("Schedule is not active")]
    ScheduleInactive,

    #[msg("Schedule is not due yet — first_run_at must be in the future")]
    ScheduleNotDue,

    #[msg("Schedule has completed all runs")]
    ScheduleExhausted,

    #[msg("Mint mismatch — delegation and schedule must cover the same token")]
    InvalidMint,
    #[msg("created_at is outside the acceptable window — must be within 5 minutes of current time")]
InvalidCreatedAt,
}