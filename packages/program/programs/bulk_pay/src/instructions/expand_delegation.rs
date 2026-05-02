use anchor_lang::prelude::*;
use anchor_spl::token_interface::{approve, Approve, Mint, TokenAccount, TokenInterface};

use crate::{errors::BulkTransferError, state::DelegationAccount};
pub const SCHEDULER_AUTHORITY_SEED: &[u8] = b"scheduler_authority";

#[derive(Accounts)]
pub struct ExpandDelegation<'info> {
    #[account(mut)]
    pub sender: Signer<'info>,

    #[account(
        mut,
        seeds = [b"delegation", sender.key().as_ref(), token_mint.key().as_ref()],
        bump = delegation_account.bump,
        constraint = delegation_account.owner == sender.key() @ BulkTransferError::Unauthorized,
        constraint = delegation_account.is_active @ BulkTransferError::DelegationInactive,
        constraint = delegation_account.mint == token_mint.key() @ BulkTransferError::InvalidMint,
    )]
    pub delegation_account: Account<'info, DelegationAccount>,

    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = sender,
        associated_token::token_program = token_program,
    )]
    pub sender_ata: InterfaceAccount<'info, TokenAccount>,

    /// CHECK: PDA validated by seeds — holds no data, just an authority address
    #[account(seeds = [SCHEDULER_AUTHORITY_SEED], bump)]
    pub scheduler_authority: AccountInfo<'info>,

    #[account(mint::token_program = token_program)]
    pub token_mint: InterfaceAccount<'info, Mint>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn expand_delegation(
    ctx: Context<ExpandDelegation>,
    additional_amount: u64,
    new_expires_at: i64,
) -> Result<()> {
    let clock = Clock::get()?;

    // 1. Validate the delegation is not already expired
    require!(
        ctx.accounts.delegation_account.expires_at > clock.unix_timestamp,
        BulkTransferError::DelegationExpired
    );

    // 2. New expiry must be in the future
    require!(
        new_expires_at > clock.unix_timestamp,
        BulkTransferError::InvalidExpiry
    );

    // 3. New expiry cannot be earlier than current expiry (no shortening)
    require!(
        new_expires_at >= ctx.accounts.delegation_account.expires_at,
        BulkTransferError::ExpiryCannotDecrease
    );

    // 4. Validate positive increase
    require!(
        additional_amount > 0,
        BulkTransferError::InvalidDelegationAmount
    );

    // 5. Calculate new total without overflow
    let new_max_amount = ctx
        .accounts
        .delegation_account
        .max_amount
        .checked_add(additional_amount)
        .ok_or(BulkTransferError::Overflow)?;

    // 6. Verify sender's ATA has enough balance to cover the new total
    require!(
        ctx.accounts.sender_ata.amount >= new_max_amount,
        BulkTransferError::InsufficientBalance
    );

    // 7. Re-approve the scheduler PDA with the new total allowance
    approve(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Approve {
                to: ctx.accounts.sender_ata.to_account_info(),
                delegate: ctx.accounts.scheduler_authority.to_account_info(),
                authority: ctx.accounts.sender.to_account_info(),
            },
        ),
        new_max_amount,
    )?;

    // 8. Update on-chain delegation record
    let d = &mut ctx.accounts.delegation_account;
    d.max_amount = new_max_amount;
    d.expires_at = new_expires_at;

    Ok(())
}
