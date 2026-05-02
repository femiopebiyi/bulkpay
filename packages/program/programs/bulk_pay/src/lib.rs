use anchor_lang::prelude::*;

mod errors;
mod instructions;
mod state;

use crate::state::Recipient;
use crate::state::{Recurrence, ScheduledRecipient};
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

    pub fn delegate(ctx: Context<Delegate>, max_amount: u64, expires_at: i64) -> Result<()> {
        instructions::delegate::delegate(ctx, max_amount, expires_at)
    }

    pub fn revoke_delegation(ctx: Context<RevokeDelegation>) -> Result<()> {
        instructions::revoke_delegation::revoke_delegation(ctx)
    }

    pub fn create_schedule(
        ctx: Context<CreateSchedule>,
        recipients: Vec<ScheduledRecipient>,
        recurrence: Recurrence,
        first_run_at: i64,
        max_runs: u32,
        created_at: i64, // ✅ added
    ) -> Result<()> {
        instructions::create_schedule::create_schedule(
            ctx,
            recipients,
            recurrence,
            first_run_at,
            max_runs,
            created_at,
        )
    }

    pub fn execute_schedule<'info>(
        ctx: Context<'_, '_, '_, 'info, ExecuteSchedule<'info>>,
        created_at: i64,
    ) -> Result<()> {
        instructions::execute_schedule::execute_schedule(ctx, created_at)
    }

    pub fn close_schedule(ctx: Context<CloseSchedule>) -> Result<()> {
        instructions::close_schedule::close_schedule(ctx)
    }

    pub fn expand_delegation(
        ctx: Context<ExpandDelegation>,
        additional_amount: u64,
        new_expires_at: i64,
    ) -> Result<()> {
        instructions::expand_delegation::expand_delegation(ctx, additional_amount, new_expires_at)
    }
    pub fn close_delegation(ctx: Context<CloseDelegation>) -> Result<()> {
        instructions::close_delegation::close_delegation(ctx)
    }
}
