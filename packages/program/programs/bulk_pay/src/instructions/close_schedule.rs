use anchor_lang::prelude::*;

use crate::{errors::BulkTransferError, state::ScheduleAccount};

#[derive(Accounts)]
pub struct CloseSchedule<'info> {
    #[account(mut)]
    pub sender: Signer<'info>,

    #[account(
        mut,
        seeds  = [b"schedule", sender.key().as_ref(), &schedule_account.created_at.to_le_bytes()],
        bump   = schedule_account.bump,
        // ✅ ownership is the only gate — sender can close at any time
        constraint = schedule_account.owner == sender.key() @ BulkTransferError::Unauthorized,
        close  = sender
    )]
    pub schedule_account: Account<'info, ScheduleAccount>,
}

pub fn close_schedule(ctx: Context<CloseSchedule>) -> Result<()> {
    // If still active this is a cancellation — emit a distinct event so the
    // backend scheduler loop knows to stop and not attempt execution
    if ctx.accounts.schedule_account.is_active {
        emit!(ScheduleCancelled {
            owner: ctx.accounts.sender.key(),
            schedule: ctx.accounts.schedule_account.key(),
            runs_completed: ctx.accounts.schedule_account.runs_completed,
        });
    }

    // Anchor's `close = sender` handles rent return and account wipe
    // No need to set is_active = false — the account ceases to exist
    Ok(())
}

#[event]
pub struct ScheduleCancelled {
    pub owner: Pubkey,
    pub schedule: Pubkey,
    pub runs_completed: u32,
}
