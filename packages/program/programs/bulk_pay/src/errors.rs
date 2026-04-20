use anchor_lang::prelude::*;

#[error_code]
pub enum BulkTransferError {
    #[msg("remaining_accounts must be exactly 2 per recipient")]
    InvalidAccountCount,
    #[msg("Wallet does not match recipient address")]
    InvalidRecipient,
    #[msg("ATA does not match derived address")]
    InvalidAta,
    #[msg("ATA account is not writable")]
    AtaNotWritable,
    #[msg("Wallet account is executable — not a valid recipient")]
    InvalidWallet,
    #[msg("Sender has insufficient token balance")]
    InsufficientBalance,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Unauthorized — signer does not own this account")]
    Unauthorized,
    #[msg("Recipient name exceeds maximum length")]
    NameTooLong,
    #[msg("There is a mint mismatch, not the expected mint")]
    InvalidMint,

    // ── Scheduler errors ─────────────────────────────────────────────────────
    #[msg("Delegation has been revoked or does not exist")]
    DelegationInactive,
    #[msg("Delegation has expired")]
    DelegationExpired,
    #[msg("Transfer amount exceeds delegated maximum")]
    ExceedsDelegationLimit,
    #[msg("Schedule is not active")]
    ScheduleInactive,
    #[msg("Schedule is not due yet")]
    ScheduleNotDue,
    #[msg("Schedule has completed all runs")]
    ScheduleExhausted,
    #[msg("Scheduler authority does not match")]
    InvalidSchedulerAuthority,
    #[msg("ATA does not exist — run the pre-ATA pass before executing a schedule")]
    AtaNotCreated,
    #[msg("The amount provided is not a valid amount")]
    InvalidDelegationAmount,
    #[msg("This schedule is still active")]
    ScheduleStillActive,
    #[msg("This delegation is still active")]
    DelegationStillActive,
    #[msg("created_at is outside acceptable window — must be within 5 minutes of current time")]
    InvalidCreatedAt,
}
