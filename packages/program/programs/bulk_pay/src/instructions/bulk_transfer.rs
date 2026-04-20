use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};
use std::collections::HashMap;

use crate::{
    errors::BulkTransferError,
    state::{Recipient, TransferLog, TransferRecord, UserAccount},
};

#[derive(Accounts)]
#[instruction(recipients: Vec<Recipient>)]
pub struct BulkTransfer<'info> {
    #[account(mut)]
    pub sender: Signer<'info>,

    #[account(
        mut,
        seeds      = [b"useraccount", sender.key().as_ref()],
        bump       = user_account.bump,
        constraint = user_account.owner == sender.key() @ BulkTransferError::Unauthorized
    )]
    pub user_account: Account<'info, UserAccount>,

    #[account(mint::token_program = token_program)]
    pub token_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        associated_token::mint          = token_mint,
        associated_token::authority     = sender,
        associated_token::token_program = token_program,
    )]
    pub sender_ata_token: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        realloc = TransferLog::space_needed(
            TransferLog::next_capacity(
                transfer_log.records.len(),
                recipients.len()
            )
        ),
        realloc::payer = sender,
        realloc::zero  = false,
        seeds          = [b"transferlog", sender.key().as_ref()],
        bump           = transfer_log.bump,
    )]
    pub transfer_log: Account<'info, TransferLog>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
    // associated_token_program removed — create_idempotent is gone.
    // Pre-ATA pass is mandatory before calling bulk_transfer.
    //
    // remaining_accounts: [ata_0, ata_1, ata_2, ...]
    // ATAs only — wallet address is read directly from ATA account data (bytes 32..64).
    // 1 slot per recipient instead of 2 — doubles the account headroom per transaction.
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/// Reads the token account owner (wallet address) directly from raw ATA data.
/// SPL token account layout: mint (0..32), owner (32..64), amount (64..72), ...
/// Avoids needing wallet AccountInfo in remaining_accounts entirely.
fn read_ata_owner(ata_info: &AccountInfo) -> Result<Pubkey> {
    let data = ata_info.try_borrow_data()?;
    require!(data.len() >= 64, BulkTransferError::InvalidAta);
    Pubkey::try_from(&data[32..64]).map_err(|_| error!(BulkTransferError::InvalidAta))
}

// ─── Instruction ──────────────────────────────────────────────────────────────

pub fn bulk_transfer<'info>(
    ctx: Context<'_, '_, '_, 'info, BulkTransfer<'info>>,
    recipients: Vec<Recipient>,
) -> Result<()> {
    let remaining: Vec<AccountInfo<'info>> = ctx.remaining_accounts.to_vec();

    // Hard cap — prevents CU exhaustion and keeps tx size predictable.
    // Anything over 35 should be split into parallel batches by the client.
    require!(recipients.len() <= 35, BulkTransferError::BatchTooLarge);

    // 1 ATA per recipient
    require!(
        remaining.len() == recipients.len(),
        BulkTransferError::InvalidAccountCount
    );

    // Pre-flight: verify sender can cover the full batch before any CPI fires
    let total: u64 = recipients
        .iter()
        .map(|r| r.amount_to_be_received)
        .try_fold(0u64, |acc, amt| acc.checked_add(amt))
        .ok_or(BulkTransferError::Overflow)?;

    require!(
        ctx.accounts.sender_ata_token.amount >= total,
        BulkTransferError::InsufficientBalance
    );

    let decimals = ctx.accounts.token_mint.decimals;
    let token_program_key = ctx.accounts.token_program.key();
    let mint_key = ctx.accounts.token_mint.key();

    let mint = ctx.accounts.token_mint.to_account_info();
    let sender_ata = ctx.accounts.sender_ata_token.to_account_info();
    let authority = ctx.accounts.sender.to_account_info();
    let token_prog = ctx.accounts.token_program.to_account_info();

    // ── Build running totals map — O(m) once, not O(n×m) per recipient ────────
    //
    // Previous approach scanned the full transfer_log.records vec for every
    // new recipient — O(n×m) where n = new records, m = existing records.
    // At 35 recipients with 500 existing records that's 17,500 iterations.
    //
    // HashMap approach: one pass over existing records to seed the map (O(m)),
    // then O(1) lookup per new recipient. Same-batch accumulation is handled
    // by updating the map after each transfer rather than chaining iterators.
    let mut running_totals: HashMap<Pubkey, u64> = HashMap::new();

    for record in ctx.accounts.transfer_log.records.iter() {
        // last_total_all_time_received for each address — later records overwrite
        // earlier ones which is correct since total_all_time_received is cumulative
        running_totals.insert(record.address, record.total_all_time_received);
    }

    let mut new_records: Vec<TransferRecord> = Vec::with_capacity(recipients.len());
    let clock = Clock::get()?;

    for (i, recipient) in recipients.iter().enumerate() {
        let ata_info = &remaining[i];

        // ATA must already exist — pre-ATA pass is mandatory
        require!(!ata_info.data_is_empty(), BulkTransferError::AtaNotCreated);
        require!(ata_info.is_writable, BulkTransferError::AtaNotWritable);

        // Read wallet address from ATA data — no wallet AccountInfo needed
        let wallet_pubkey = read_ata_owner(ata_info)?;

        // Verify ATA is correctly derived from the owner we just read.
        // Prevents a spoofed ATA whose owner bytes were crafted to pass the read.
        let expected_ata =
            anchor_spl::associated_token::get_associated_token_address_with_program_id(
                &wallet_pubkey,
                &mint_key,
                &token_program_key,
            );
        require_keys_eq!(ata_info.key(), expected_ata, BulkTransferError::InvalidAta);

        transfer_checked(
            CpiContext::new(
                token_prog.clone(),
                TransferChecked {
                    from: sender_ata.clone(),
                    mint: mint.clone(),
                    to: ata_info.to_account_info(),
                    authority: authority.clone(),
                },
            ),
            recipient.amount_to_be_received,
            decimals,
        )?;

        // O(1) lookup — prior_total is 0 if this is the first transfer to wallet
        let prior_total = running_totals.get(&wallet_pubkey).copied().unwrap_or(0);

        let new_total = prior_total
            .checked_add(recipient.amount_to_be_received)
            .ok_or(BulkTransferError::Overflow)?;

        // Update map so same-batch duplicate addresses accumulate correctly
        running_totals.insert(wallet_pubkey, new_total);

        new_records.push(TransferRecord {
            address: wallet_pubkey,
            amount_received: recipient.amount_to_be_received,
            total_all_time_received: new_total,
            timestamp: clock.unix_timestamp,
        });

        ctx.accounts.user_account.all_time_amount_sent = ctx
            .accounts
            .user_account
            .all_time_amount_sent
            .checked_add(recipient.amount_to_be_received)
            .ok_or(BulkTransferError::Overflow)?;
    }

    // All transfers succeeded — flush staged records atomically
    ctx.accounts.transfer_log.records.extend(new_records);

    Ok(())
}
