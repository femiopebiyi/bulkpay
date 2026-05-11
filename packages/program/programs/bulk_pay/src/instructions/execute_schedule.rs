// instructions/execute_schedule.rs

use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked},
};

use crate::{
    errors::BulkTransferError,
    instructions::delegate::SCHEDULER_AUTHORITY_SEED,
    state::{
        DelegationAccount, Recurrence, ScheduleAccount, TransferLog, TransferRecord, UserAccount,
    },
};

#[derive(Accounts)]
#[instruction(created_at: i64)]
pub struct ExecuteSchedule<'info> {
    // Backend fee payer — your backend wallet, not the original sender
    #[account(mut)]
    pub executor: Signer<'info>,

    /// CHECK: the original sender — validated via schedule_account.owner
    #[account(
        constraint = sender.key() == schedule_account.owner @ BulkTransferError::Unauthorized
    )]
    pub sender: AccountInfo<'info>,

    #[account(
        mut,
        seeds = [b"schedule", sender.key().as_ref(), &created_at.to_le_bytes()],
        bump   = schedule_account.bump,
        constraint = schedule_account.is_active
            @ BulkTransferError::ScheduleInactive,
        constraint = schedule_account.next_run_at <= Clock::get()?.unix_timestamp
            @ BulkTransferError::ScheduleNotDue,
        constraint = schedule_account.max_runs == 0
            || schedule_account.runs_completed < schedule_account.max_runs
            @ BulkTransferError::ScheduleExhausted,
    )]
    pub schedule_account: Account<'info, ScheduleAccount>,

    #[account(
    seeds  = [b"delegation", sender.key().as_ref(), token_mint.key().as_ref(), &created_at.to_le_bytes()],
    bump   = delegation_account.bump,
    constraint = delegation_account.is_active     @ BulkTransferError::DelegationInactive,
    constraint = delegation_account.expires_at > Clock::get()?.unix_timestamp  @ BulkTransferError::DelegationExpired,
    constraint = delegation_account.mint == schedule_account.mint    @ BulkTransferError::InvalidMint, // ✅ add this
)]
    pub delegation_account: Account<'info, DelegationAccount>,

    #[account(
        mut,
        seeds      = [b"useraccount", sender.key().as_ref()],
        bump       = user_account.bump,
        constraint = user_account.owner == sender.key() @ BulkTransferError::Unauthorized
    )]
    pub user_account: Account<'info, UserAccount>,

    #[account(
        mut,
        associated_token::mint          = token_mint,
        associated_token::authority     = sender,
        associated_token::token_program = token_program,
    )]
    pub sender_ata: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        seeds         = [b"transferlog", sender.key().as_ref()],
        bump          = transfer_log.bump,
        realloc       = TransferLog::space_needed(
            TransferLog::next_capacity(
                transfer_log.records.len(),
                schedule_account.recipients.len()
            )
        ),
        realloc::payer = executor,
        realloc::zero  = false,
    )]
    pub transfer_log: Account<'info, TransferLog>,

    #[account(mint::token_program = token_program)]
    pub token_mint: InterfaceAccount<'info, Mint>,

    /// CHECK: PDA validated by seeds — holds no data, only an authority address
    #[account(seeds = [SCHEDULER_AUTHORITY_SEED], bump)]
    pub scheduler_authority: AccountInfo<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    // remaining_accounts: [ata_0, ata_1, ...] — ATAs only.
    // Wallets come from schedule_account.recipients — no wallet AccountInfos needed.
    // Backend MUST run the pre-ATA pass before calling this instruction.
}

pub fn execute_schedule<'info>(
    ctx: Context<'_, '_, '_, 'info, ExecuteSchedule<'info>>,
    created_at: i64,
) -> Result<()> {
    let remaining = ctx.remaining_accounts.to_vec();
    let recipients = ctx.accounts.schedule_account.recipients.clone();

    // One ATA per recipient — wallets come from schedule_account, not remaining
    require!(
        remaining.len() == recipients.len(),
        BulkTransferError::InvalidAccountCount
    );

    let clock = Clock::get()?;
    let decimals = ctx.accounts.token_mint.decimals;
    let token_program_key = ctx.accounts.token_program.key();
    let mint_key = ctx.accounts.token_mint.key();
    let scheduler_bump = ctx.bumps.scheduler_authority;

    // Pre-flight: verify sender can cover the full batch before any CPI fires
    let total: u64 = recipients
        .iter()
        .map(|r| r.amount)
        .try_fold(0u64, |acc, amt| acc.checked_add(amt))
        .ok_or(BulkTransferError::Overflow)?;

    require!(
        ctx.accounts.sender_ata.amount >= total,
        BulkTransferError::InsufficientBalance
    );

    // Extract account infos before the loop — avoids borrow conflicts
    let mint = ctx.accounts.token_mint.to_account_info();
    let sender_ata = ctx.accounts.sender_ata.to_account_info();
    let token_prog = ctx.accounts.token_program.to_account_info();
    let authority = ctx.accounts.scheduler_authority.to_account_info();

    let mut new_records: Vec<TransferRecord> = Vec::with_capacity(recipients.len());

    for (i, recipient) in recipients.iter().enumerate() {
        let ata_info = &remaining[i];

        // Verify ATA is derived from the scheduled wallet + mint
        let expected_ata =
            anchor_spl::associated_token::get_associated_token_address_with_program_id(
                &recipient.wallet,
                &mint_key,
                &token_program_key,
            );
        require_keys_eq!(ata_info.key(), expected_ata, BulkTransferError::InvalidAta);

        // Option B: ATA must already exist — backend pre-ATA pass is mandatory
        require!(!ata_info.data_is_empty(), BulkTransferError::AtaNotCreated);
        require!(ata_info.is_writable, BulkTransferError::AtaNotWritable);

        // Transfer using the scheduler PDA as authority — no user sig needed
        transfer_checked(
            CpiContext::new_with_signer(
                token_prog.clone(),
                TransferChecked {
                    from: sender_ata.clone(),
                    mint: mint.clone(),
                    to: ata_info.to_account_info(),
                    authority: authority.clone(),
                },
                // PDA signer seeds — this is how the program signs without a keypair
                &[&[SCHEDULER_AUTHORITY_SEED, &[scheduler_bump]]],
            ),
            recipient.amount,
            decimals,
        )?;

        // Accumulate running total — chain staged records for same-batch duplicates
        let previous_total = ctx
            .accounts
            .transfer_log
            .records
            .iter()
            .chain(new_records.iter())
            .filter(|r| r.address == recipient.wallet)
            .map(|r| r.amount_received)
            .try_fold(0u64, |acc, amt| acc.checked_add(amt))
            .ok_or(BulkTransferError::Overflow)?;

        new_records.push(TransferRecord {
            address: recipient.wallet,
            amount_received: recipient.amount,
            total_all_time_received: previous_total
                .checked_add(recipient.amount)
                .ok_or(BulkTransferError::Overflow)?,
            timestamp: clock.unix_timestamp,
        });

        ctx.accounts.user_account.all_time_amount_sent = ctx
            .accounts
            .user_account
            .all_time_amount_sent
            .checked_add(recipient.amount)
            .ok_or(BulkTransferError::Overflow)?;
    }

    // All transfers succeeded — flush staged records atomically
    ctx.accounts.transfer_log.records.extend(new_records);

    // Advance the schedule state
    let s = &mut ctx.accounts.schedule_account;
    s.runs_completed += 1;

    if s.max_runs > 0 && s.runs_completed >= s.max_runs {
        // Final run — deactivate
        s.is_active = false;
    } else {
        // ✅ handle deactivation explicitly after the match
        s.next_run_at = match s.recurrence {
            Recurrence::Once => s.next_run_at, // no change — deactivated below
            Recurrence::Daily => s.next_run_at + 86_400,
            Recurrence::Weekly => s.next_run_at + 604_800,
            Recurrence::Monthly => s.next_run_at + 2_592_000,
        };

        // Deactivate if this was the final run
        let is_final =
            s.recurrence == Recurrence::Once || (s.max_runs > 0 && s.runs_completed >= s.max_runs);

        if is_final {
            s.is_active = false;
        }
    }

    Ok(())
}
