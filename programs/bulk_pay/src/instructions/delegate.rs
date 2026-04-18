use anchor_lang::prelude::*;
use anchor_spl::token_interface::{approve, Approve, Mint, TokenAccount, TokenInterface};

use crate::{errors::BulkTransferError, state::DelegationAccount};

// Seeds for the scheduler authority PDA — signs on behalf of delegating senders
pub const SCHEDULER_AUTHORITY_SEED: &[u8] = b"scheduler_authority";

#[derive(Accounts)]
pub struct Delegate<'info> {
    #[account(mut)]
    pub sender: Signer<'info>,

    #[account(
        init_if_needed,
        payer  = sender,
        space  = 8 + DelegationAccount::INIT_SPACE,
        seeds  = [b"delegation", sender.key().as_ref(), token_mint.key().as_ref()],
        bump
    )]
    pub delegation_account: Account<'info, DelegationAccount>,

    #[account(
        mut,
        associated_token::mint      = token_mint,
        associated_token::authority = sender,
        associated_token::token_program = token_program,
    )]
    pub sender_ata: InterfaceAccount<'info, TokenAccount>,

    // The PDA that will act as delegate — no keypair, signs via seeds
    /// CHECK: PDA validated by seeds — holds no data, just an authority address
    #[account(seeds = [SCHEDULER_AUTHORITY_SEED], bump)]
    pub scheduler_authority: AccountInfo<'info>,

    #[account(mint::token_program = token_program)]
    pub token_mint: InterfaceAccount<'info, Mint>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn delegate(
    ctx: Context<Delegate>,
    max_amount: u64,
    expires_at: i64, // unix timestamp — frontend passes e.g. now + 30 days
) -> Result<()> {
    let clock = Clock::get()?;

    require!(
        expires_at > clock.unix_timestamp,
        BulkTransferError::DelegationExpired
    );

    // Approve the scheduler PDA as delegate on sender's ATA
    approve(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Approve {
                to: ctx.accounts.sender_ata.to_account_info(),
                delegate: ctx.accounts.scheduler_authority.to_account_info(),
                authority: ctx.accounts.sender.to_account_info(),
            },
        ),
        max_amount,
    )?;

    // Record the delegation on-chain
    let d = &mut ctx.accounts.delegation_account;
    d.owner = ctx.accounts.sender.key();
    d.mint = ctx.accounts.token_mint.key();
    d.max_amount = max_amount;
    d.expires_at = expires_at;
    d.is_active = true;
    d.bump = ctx.bumps.delegation_account;

    Ok(())
}
