use anchor_lang::prelude::*;
use anchor_spl::token_interface::{revoke, Mint, Revoke, TokenAccount, TokenInterface};

use crate::state::DelegationAccount;

#[derive(Accounts)]
pub struct RevokeDelegation<'info> {
    pub sender: Signer<'info>,

    #[account(
        mut,
        seeds  = [b"delegation", sender.key().as_ref(), token_mint.key().as_ref()],
        bump   = delegation_account.bump,
        constraint = delegation_account.owner == sender.key()
    )]
    pub delegation_account: Account<'info, DelegationAccount>,

    #[account(
        mut,
        associated_token::mint      = token_mint,
        associated_token::authority = sender,
        associated_token::token_program = token_program,
    )]
    pub sender_ata: InterfaceAccount<'info, TokenAccount>,

    pub token_mint: InterfaceAccount<'info, Mint>,
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn revoke_delegation(ctx: Context<RevokeDelegation>) -> Result<()> {
    // Revoke on the token account level
    revoke(CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        Revoke {
            source: ctx.accounts.sender_ata.to_account_info(),
            authority: ctx.accounts.sender.to_account_info(),
        },
    ))?;

    // Mark delegation inactive on-chain
    ctx.accounts.delegation_account.is_active = false;

    Ok(())
}
