#![no_std]

use core::cell::RefCell;

use payment_common::{PaymentService, PaymentState, FEE_SPARK_REFILL};
use sails_rs::gstd::{program, Syscall};

pub struct SparkRefillProgram {
    state: RefCell<PaymentState>,
}

#[program]
impl SparkRefillProgram {
    /// Deploy constructor: deployer becomes owner; fee defaults to 50_000 (6 decimals).
    pub fn new() -> Self {
        let owner = Syscall::message_source();
        Self {
            state: RefCell::new(PaymentState::new(owner, FEE_SPARK_REFILL)),
        }
    }

    #[export(route = "SparkRefill")]
    pub fn spark_refill(&self) -> PaymentService<'_> {
        PaymentService::new(&self.state)
    }
}
