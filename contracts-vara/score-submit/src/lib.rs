#![no_std]

use core::cell::RefCell;

use payment_common::{PaymentService, PaymentState, FEE_SCORE_SUBMIT};
use sails_rs::gstd::{program, Syscall};

pub struct ScoreSubmitProgram {
    state: RefCell<PaymentState>,
}

#[program]
impl ScoreSubmitProgram {
    /// Deploy constructor: deployer becomes owner; fee defaults to 50_000 (6 decimals).
    pub fn new() -> Self {
        let owner = Syscall::message_source();
        Self {
            state: RefCell::new(PaymentState::new(owner, FEE_SCORE_SUBMIT)),
        }
    }

    #[export(route = "ScoreSubmit")]
    pub fn score_submit(&self) -> PaymentService<'_> {
        PaymentService::new(&self.state)
    }
}
