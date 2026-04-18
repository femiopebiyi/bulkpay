use anchor_lang::prelude::*;

use crate::state::TransferLog;

#[derive(Accounts)]
pub struct InitTransferLog<'info> {
    #[account(mut)]
    pub sender: Signer<'info>,

    #[account(
        init,
        payer = sender,
        space = TransferLog::initial_space(),
        seeds = [b"transferlog", sender.key().as_ref()],
        bump,
    )]
    pub transfer_log: Account<'info, TransferLog>,

    pub system_program: Program<'info, System>,
}

pub fn init_transfer_log(ctx: Context<InitTransferLog>) -> Result<()> {
    let log = &mut ctx.accounts.transfer_log;
    log.bump = ctx.bumps.transfer_log;
    log.records = Vec::new();
    Ok(())
}
