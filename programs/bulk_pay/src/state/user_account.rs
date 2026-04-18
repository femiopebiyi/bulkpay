use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct UserAccount {
    pub owner: Pubkey,
    pub all_time_amount_sent: u64,
    pub bump: u8,
    pub is_created: bool,
}
