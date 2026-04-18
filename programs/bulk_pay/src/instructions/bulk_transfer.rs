use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::{self, AssociatedToken, Create},
    token_interface::{transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked},
};

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
        seeds = [b"useraccount", sender.key().as_ref()],
        bump = user_account.bump,
        constraint = user_account.owner == sender.key() @ BulkTransferError::Unauthorized
    )]
    pub user_account: Account<'info, UserAccount>,

    #[account(mint::token_program = token_program)]
    pub token_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = sender,
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
        realloc::zero = false, // ✅ fixed: was true with a comment saying false — zero=false is faster
        seeds = [b"transferlog", sender.key().as_ref()],
        bump = transfer_log.bump,
        // ✅ removed redundant find_program_address constraint —
        //    Anchor already verifies seeds match the provided account
    )]
    pub transfer_log: Account<'info, TransferLog>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn bulk_transfer<'info>(
    ctx: Context<'_, '_, '_, 'info, BulkTransfer<'info>>,
    recipients: Vec<Recipient>,
) -> Result<()> {
    let remaining: Vec<AccountInfo<'info>> = ctx.remaining_accounts.to_vec();

    require!(
        remaining.len() == recipients.len() * 2,
        BulkTransferError::InvalidAccountCount
    );

    // ✅ Pre-flight balance check — sum amounts before touching anything
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

    let payer = ctx.accounts.sender.to_account_info();
    let mint = ctx.accounts.token_mint.to_account_info();
    let sender_ata = ctx.accounts.sender_ata_token.to_account_info();
    let authority = ctx.accounts.sender.to_account_info();
    let system_prog = ctx.accounts.system_program.to_account_info();
    let token_prog = ctx.accounts.token_program.to_account_info();
    let assoc_prog = ctx.accounts.associated_token_program.to_account_info();

    let mut new_records: Vec<TransferRecord> = Vec::with_capacity(recipients.len());
    let clock = Clock::get()?;

    for (i, recipient) in recipients.iter().enumerate() {
        let wallet_info = &remaining[i * 2];
        let ata_info = &remaining[i * 2 + 1];

        // ✅ address now read from remaining_accounts — no longer in Recipient
        //    wallet_info IS the recipient address, no cross-check needed

        require!(!wallet_info.executable, BulkTransferError::InvalidRecipient);
        require!(ata_info.is_writable, BulkTransferError::AtaNotWritable);

        // ✅ ATA derivation now uses wallet_info.key() directly
        let expected_ata =
            anchor_spl::associated_token::get_associated_token_address_with_program_id(
                &wallet_info.key(),
                &mint_key,
                &token_program_key,
            );
        require_keys_eq!(ata_info.key(), expected_ata, BulkTransferError::InvalidAta);

        associated_token::create_idempotent(CpiContext::new(
            assoc_prog.clone(),
            Create {
                payer: payer.clone(),
                associated_token: ata_info.clone(),
                authority: wallet_info.clone(),
                mint: mint.clone(),
                system_program: system_prog.clone(),
                token_program: token_prog.clone(),
            },
        ))?;

        transfer_checked(
            CpiContext::new(
                token_prog.clone(),
                TransferChecked {
                    from: sender_ata.clone(),
                    mint: mint.clone(),
                    to: ata_info.clone(),
                    authority: authority.clone(),
                },
            ),
            recipient.amount_to_be_received,
            decimals,
        )?;

        // ✅ previous_total reads address from staged records and on-chain log
        //    using wallet_info.key() — no recipient.address reference anywhere
        let previous_total = ctx
            .accounts
            .transfer_log
            .records
            .iter()
            .chain(new_records.iter())
            .filter(|r| r.address == wallet_info.key())
            .map(|r| r.amount_received)
            .try_fold(0u64, |acc, amt| acc.checked_add(amt))
            .ok_or(BulkTransferError::Overflow)?;

        new_records.push(TransferRecord {
            address: wallet_info.key(), // ✅ from remaining_accounts
            amount_received: recipient.amount_to_be_received,
            total_all_time_received: previous_total
                .checked_add(recipient.amount_to_be_received)
                .ok_or(BulkTransferError::Overflow)?,
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
