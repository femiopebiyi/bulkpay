use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct Recipient {
    pub amount_to_be_received: u64,
}
