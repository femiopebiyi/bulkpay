use anchor_lang::prelude::*;

#[error_code]
pub enum BulkTransferError {
    #[msg("remaining_accounts must be exactly 2 accounts per recipient (wallet + ata)")]
    InvalidAccountCount,
    #[msg("Wallet account does not match recipient address")]
    InvalidRecipient,
    #[msg("ATA does not match derived address for recipient + mint")]
    InvalidAta,
    #[msg("Integer Overflow!!!!")]
    Overflow,
    #[msg("Name of recipient is too long")]
    NameTooLong,
    #[msg("Sender balance not enough to cover entire transaction")]
    InsufficientBalance,
    #[msg("The ata provided is not writable")]
    AtaNotWritable,
    #[msg("Unauthorized transaction(credential mismatch)")]
    Unauthorized,
    #[msg("This transfer log is invalid(probably doesn't belong to you")]
    InvalidTransferLog,
}
