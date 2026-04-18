use anchor_lang::prelude::*;

use crate::{
    errors::BulkTransferError,
    state::{DelegationAccount, Recurrence, ScheduleAccount, ScheduledRecipient},
};

#[derive(Accounts)]
#[instruction(recipients: Vec<ScheduledRecipient>)]
pub struct CreateSchedule<'info> {
    #[account(mut)]
    pub sender: Signer<'info>,

    #[account(
        seeds  = [b"delegation", sender.key().as_ref(), schedule_account.mint.as_ref()],
        bump   = delegation_account.bump,
        constraint = delegation_account.owner     == sender.key()    @ BulkTransferError::Unauthorized,
        constraint = delegation_account.is_active == true             @ BulkTransferError::DelegationInactive,
        constraint = delegation_account.expires_at > Clock::get()?.unix_timestamp @ BulkTransferError::DelegationExpired,
    )]
    pub delegation_account: Account<'info, DelegationAccount>,

    #[account(
        init,
        payer  = sender,
        space  = ScheduleAccount::space_needed(recipients.len()),
        seeds  = [b"schedule", sender.key().as_ref(), &Clock::get()?.unix_timestamp.to_le_bytes()],
        bump
    )]
    pub schedule_account: Account<'info, ScheduleAccount>,

    pub system_program: Program<'info, System>,
}

pub fn create_schedule(
    ctx: Context<CreateSchedule>,
    recipients: Vec<ScheduledRecipient>,
    recurrence: Recurrence,
    first_run_at: i64,
    max_runs: u32,
) -> Result<()> {
    let clock = Clock::get()?;

    require!(
        first_run_at > clock.unix_timestamp,
        BulkTransferError::ScheduleNotDue
    );

    // Verify total fits within delegation cap
    let total: u64 = recipients
        .iter()
        .map(|r| r.amount)
        .try_fold(0u64, |acc, amt| acc.checked_add(amt))
        .ok_or(BulkTransferError::Overflow)?;

    require!(
        total <= ctx.accounts.delegation_account.max_amount,
        BulkTransferError::ExceedsDelegationLimit
    );

    let s = &mut ctx.accounts.schedule_account;
    s.owner = ctx.accounts.sender.key();
    s.mint = ctx.accounts.delegation_account.mint;
    s.recurrence = recurrence;
    s.next_run_at = first_run_at;
    s.max_runs = max_runs;
    s.runs_completed = 0;
    s.is_active = true;
    s.bump = ctx.bumps.schedule_account;
    s.recipients = recipients;

    Ok(())
}
