use anchor_lang::prelude::*;
use anchor_spl::token_interface::{revoke, Mint, Revoke, TokenAccount, TokenInterface};

use crate::{errors::BulkTransferError, state::DelegationAccount};
#[derive(Accounts)]
pub struct CloseDelegation<'info> {
    #[account(mut)]
    pub sender: Signer<'info>,

    #[account(
        mut,
        seeds  = [b"delegation", sender.key().as_ref(), token_mint.key().as_ref()],
        bump   = delegation_account.bump,
        constraint = delegation_account.owner == sender.key() @ BulkTransferError::Unauthorized,
        // ✅ must be inactive — either expired, revoked, or never re-delegated
        constraint = !delegation_account.is_active @ BulkTransferError::DelegationStillActive,
        close  = sender
    )]
    pub delegation_account: Account<'info, DelegationAccount>,

    #[account(
        mut,
        associated_token::mint      = token_mint,
        associated_token::authority = sender,
        associated_token::token_program = token_program,
    )]
    pub sender_ata: InterfaceAccount<'info, TokenAccount>,

    #[account(mint::token_program = token_program)]
    pub token_mint: InterfaceAccount<'info, Mint>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn close_delegation(ctx: Context<CloseDelegation>) -> Result<()> {
    // Revoke token approval if it somehow wasn't revoked already
    // This is a no-op if already revoked — safe to call unconditionally
    revoke(CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        Revoke {
            source: ctx.accounts.sender_ata.to_account_info(),
            authority: ctx.accounts.sender.to_account_info(),
        },
    ))?;
    // Anchor closes the account via `close = sender`
    Ok(())
}
