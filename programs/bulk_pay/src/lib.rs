use anchor_lang::prelude::*;

mod errors;
mod instructions;
mod state;

use crate::state::Recipient;
use instructions::*;

declare_id!("Bh6ADbE6SmBjta1YYSGvMp3i4Tqomey9NcFdpgHJAhpT");

#[program]
pub mod bulk_pay {

    use super::*;

    pub fn create_account(ctx: Context<CreateAccount>) -> Result<()> {
        instructions::create_account::create_account_initializer(ctx)
    }

    pub fn init_transfer_log(ctx: Context<InitTransferLog>) -> Result<()> {
        instructions::init_transfer_log::init_transfer_log(ctx)
    }

    pub fn bulk_transfer<'info>(
        ctx: Context<'_, '_, '_, 'info, BulkTransfer<'info>>,
        recipients: Vec<Recipient>,
    ) -> Result<()> {
        instructions::bulk_transfer::bulk_transfer(ctx, recipients)
    }
}
