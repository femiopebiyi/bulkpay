use anchor_lang::prelude::*;

use crate::state::UserAccount;

#[derive(Accounts)]
pub struct CreateAccount<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        init_if_needed,
        payer = owner,
        space = 8 + UserAccount::INIT_SPACE,
        seeds =[b"useraccount", owner.key().as_ref()],
        bump
    )]
    pub account: Account<'info, UserAccount>,

    pub system_program: Program<'info, System>,
}

impl<'info> CreateAccount<'info> {
    fn create_account(&mut self, bumps: &CreateAccountBumps) -> Result<()> {
        if !self.account.is_created {
            self.account.is_created = true;
            self.account.all_time_amount_sent = 0;
            self.account.owner = self.owner.key();
            self.account.bump = bumps.account;
        }

        Ok(())
    }
}

pub fn create_account_initializer(ctx: Context<CreateAccount>) -> Result<()> {
    ctx.accounts.create_account(&ctx.bumps)
}
