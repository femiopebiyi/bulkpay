use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenInterface};

use crate::{
    errors::BulkTransferError,
    state::{DelegationAccount, Recurrence, ScheduleAccount, ScheduledRecipient},
};

#[derive(Accounts)]
// ✅ added created_at to #[instruction] so it's available in seeds
#[instruction(recipients: Vec<ScheduledRecipient>, recurrence: Recurrence, first_run_at: i64, max_runs: u32, created_at: i64)]
pub struct CreateSchedule<'info> {
    #[account(mut)]
    pub sender: Signer<'info>,

    #[account(mint::token_program = token_program)]
    pub token_mint: InterfaceAccount<'info, Mint>,

    #[account(
        seeds  = [b"delegation", sender.key().as_ref(), token_mint.key().as_ref()],
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
        // ✅ created_at from instruction args — no Clock::get()? in seeds
        seeds  = [b"schedule", sender.key().as_ref(), &created_at.to_le_bytes()],
        bump
    )]
    pub schedule_account: Account<'info, ScheduleAccount>,

    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn create_schedule(
    ctx: Context<CreateSchedule>,
    recipients: Vec<ScheduledRecipient>,
    recurrence: Recurrence,
    first_run_at: i64,
    max_runs: u32,
    created_at: i64, // ✅ client passes this — used as permanent PDA seed
) -> Result<()> {
    let clock = Clock::get()?;

    // Sanity check: created_at must be close to actual current time
    // prevents seed squatting with arbitrary timestamps
    require!(
        created_at >= clock.unix_timestamp - 300 && created_at <= clock.unix_timestamp + 60,
        BulkTransferError::InvalidCreatedAt
    );

    require!(
        first_run_at > clock.unix_timestamp,
        BulkTransferError::ScheduleNotDue
    );

    let total: u64 = recipients
        .iter()
        .map(|r| r.amount)
        .try_fold(0u64, |acc, amt| acc.checked_add(amt))
        .ok_or(BulkTransferError::Overflow)?;

    let lifetime_total = if max_runs > 0 {
        total
            .checked_mul(max_runs as u64)
            .ok_or(BulkTransferError::Overflow)?
    } else {
        total
    };

    require!(
        lifetime_total <= ctx.accounts.delegation_account.max_amount,
        BulkTransferError::ExceedsDelegationLimit
    );

    let s = &mut ctx.accounts.schedule_account;
    s.owner = ctx.accounts.sender.key();
    s.mint = ctx.accounts.token_mint.key();
    s.recurrence = recurrence;
    s.created_at = created_at; // ✅ store arg, not clock.unix_timestamp
    s.next_run_at = first_run_at;
    s.max_runs = max_runs;
    s.runs_completed = 0;
    s.is_active = true;
    s.bump = ctx.bumps.schedule_account;
    s.recipients = recipients;

    Ok(())
}
