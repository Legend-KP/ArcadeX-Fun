#![no_std]

use core::cell::RefCell;

use payment_common::{PaymentService, PaymentState, FEE_INFINITE_SPARK};
use sails_rs::gstd::{program, Syscall};

pub struct InfiniteSparkProgram {
    state: RefCell<PaymentState>,
}

#[program]
impl InfiniteSparkProgram {
    /// Deploy constructor: deployer becomes owner; fee defaults to 100_000 (6 decimals).
    pub fn new() -> Self {
        let owner = Syscall::message_source();
        Self {
            state: RefCell::new(PaymentState::new(owner, FEE_INFINITE_SPARK)),
        }
    }

    #[export(route = "InfiniteSpark")]
    pub fn infinite_spark(&self) -> PaymentService<'_> {
        PaymentService::new(&self.state)
    }
}
