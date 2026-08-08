use core::cell::RefCell;

use sails_rs::{
    gstd::{event, export, service, Syscall},
    prelude::*,
};

use crate::tokens::{WUSDC, WUSDT};
use crate::vft::{balance_of, transfer, transfer_from};

#[derive(Clone, Debug)]
pub struct PaymentState {
    pub owner: ActorId,
    pub pending_owner: Option<ActorId>,
    pub paused: bool,
    pub entered: bool,
    pub fee: u128,
    pub wusdt: ActorId,
    pub wusdc: ActorId,
    pub total_collected_usdt: u128,
    pub total_collected_usdc: u128,
    pub total_withdrawn_usdt: u128,
    pub total_withdrawn_usdc: u128,
    pub pay_count_usdt: collections::HashMap<ActorId, u64>,
    pub pay_count_usdc: collections::HashMap<ActorId, u64>,
}

impl PaymentState {
    pub fn new(owner: ActorId, fee: u128) -> Self {
        Self {
            owner,
            pending_owner: None,
            paused: false,
            entered: false,
            fee,
            wusdt: WUSDT,
            wusdc: WUSDC,
            total_collected_usdt: 0,
            total_collected_usdc: 0,
            total_withdrawn_usdt: 0,
            total_withdrawn_usdc: 0,
            pay_count_usdt: collections::HashMap::new(),
            pay_count_usdc: collections::HashMap::new(),
        }
    }
}

#[derive(Encode, Decode, TypeInfo, Clone, Debug, PartialEq, Eq)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub struct PaymentStats {
    pub total_collected_usdt: u128,
    pub total_collected_usdc: u128,
    pub total_withdrawn_usdt: u128,
    pub total_withdrawn_usdc: u128,
}

#[event]
#[derive(Encode, Decode, TypeInfo, Clone, Debug, PartialEq, Eq)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub enum PaymentEvents {
    EntryPaid {
        player: ActorId,
        token: ActorId,
        amount: u128,
        timestamp: u64,
    },
    FeeUpdated {
        old_fee: u128,
        new_fee: u128,
    },
    Paused,
    Unpaused,
    OwnershipTransferStarted {
        previous_owner: ActorId,
        new_owner: ActorId,
    },
    OwnershipTransferred {
        previous_owner: ActorId,
        new_owner: ActorId,
    },
    Withdrawn {
        to: ActorId,
        token: ActorId,
        amount: u128,
    },
}

pub struct PaymentService<'a> {
    state: &'a RefCell<PaymentState>,
}

impl<'a> PaymentService<'a> {
    pub fn new(state: &'a RefCell<PaymentState>) -> Self {
        Self { state }
    }
}

#[service(events = PaymentEvents)]
impl<'a> PaymentService<'a> {
    fn ensure_owner(state: &PaymentState) {
        let caller = Syscall::message_source();
        if caller != state.owner {
            panic!("not owner");
        }
    }

    fn ensure_not_paused(state: &PaymentState) {
        if state.paused {
            panic!("paused");
        }
    }

    fn lock(state: &mut PaymentState) {
        if state.entered {
            panic!("reentrancy");
        }
        state.entered = true;
    }

    fn unlock(state: &mut PaymentState) {
        state.entered = false;
    }

    async fn pay_with_token(&mut self, token: ActorId, is_usdt: bool) {
        let timestamp = Syscall::block_timestamp();
        let player = Syscall::message_source();
        let amount;
        {
            let mut state = self.state.borrow_mut();
            Self::ensure_not_paused(&state);
            Self::lock(&mut state);
            amount = state.fee;
        }

        let self_id = Syscall::program_id();
        let before = balance_of(token, self_id).await;
        let transferred = if amount > 0 {
            transfer_from(token, player, self_id, amount).await
        } else {
            true
        };
        let after = balance_of(token, self_id).await;

        {
            let mut state = self.state.borrow_mut();
            Self::unlock(&mut state);
            if !transferred {
                panic!("transferFrom failed");
            }
            if after < before.saturating_add(amount) {
                panic!("transfer amount mismatch");
            }
            if is_usdt {
                state.total_collected_usdt = state.total_collected_usdt.saturating_add(amount);
                let prev = state.pay_count_usdt.get(&player).copied().unwrap_or(0);
                state.pay_count_usdt.insert(player, prev.saturating_add(1));
            } else {
                state.total_collected_usdc = state.total_collected_usdc.saturating_add(amount);
                let prev = state.pay_count_usdc.get(&player).copied().unwrap_or(0);
                state.pay_count_usdc.insert(player, prev.saturating_add(1));
            }
        }

        self.emit_event(PaymentEvents::EntryPaid {
            player,
            token,
            amount,
            timestamp,
        })
        .expect("emit EntryPaid");
    }

    #[export]
    pub async fn pay_with_usdt(&mut self) {
        let token = self.state.borrow().wusdt;
        self.pay_with_token(token, true).await;
    }

    #[export]
    pub async fn pay_with_usdc(&mut self) {
        let token = self.state.borrow().wusdc;
        self.pay_with_token(token, false).await;
    }

    #[export]
    pub fn set_fee(&mut self, new_fee: u128) {
        let old_fee;
        {
            let mut state = self.state.borrow_mut();
            Self::ensure_owner(&state);
            old_fee = state.fee;
            state.fee = new_fee;
        }
        self.emit_event(PaymentEvents::FeeUpdated { old_fee, new_fee })
            .expect("emit FeeUpdated");
    }

    async fn withdraw_token(&mut self, token: ActorId, is_usdt: bool) {
        let owner;
        {
            let mut state = self.state.borrow_mut();
            Self::ensure_owner(&state);
            Self::lock(&mut state);
            owner = state.owner;
        }

        let self_id = Syscall::program_id();
        let bal = balance_of(token, self_id).await;
        if bal == 0 {
            {
                let mut state = self.state.borrow_mut();
                Self::unlock(&mut state);
            }
            panic!("no balance");
        }

        let ok = transfer(token, owner, bal).await;
        {
            let mut state = self.state.borrow_mut();
            if !ok {
                Self::unlock(&mut state);
                panic!("transfer failed");
            }
            if is_usdt {
                state.total_withdrawn_usdt = state.total_withdrawn_usdt.saturating_add(bal);
            } else {
                state.total_withdrawn_usdc = state.total_withdrawn_usdc.saturating_add(bal);
            }
            Self::unlock(&mut state);
        }

        self.emit_event(PaymentEvents::Withdrawn {
            to: owner,
            token,
            amount: bal,
        })
        .expect("emit Withdrawn");
    }

    #[export]
    pub async fn withdraw_usdt(&mut self) {
        let token = self.state.borrow().wusdt;
        self.withdraw_token(token, true).await;
    }

    #[export]
    pub async fn withdraw_usdc(&mut self) {
        let token = self.state.borrow().wusdc;
        self.withdraw_token(token, false).await;
    }

    #[export]
    pub fn pause(&mut self) {
        {
            let mut state = self.state.borrow_mut();
            Self::ensure_owner(&state);
            if state.paused {
                panic!("already paused");
            }
            state.paused = true;
        }
        self.emit_event(PaymentEvents::Paused).expect("emit Paused");
    }

    #[export]
    pub fn unpause(&mut self) {
        {
            let mut state = self.state.borrow_mut();
            Self::ensure_owner(&state);
            if !state.paused {
                panic!("not paused");
            }
            state.paused = false;
        }
        self.emit_event(PaymentEvents::Unpaused)
            .expect("emit Unpaused");
    }

    #[export]
    pub fn transfer_ownership(&mut self, new_owner: ActorId) {
        if new_owner == ActorId::zero() {
            panic!("zero owner");
        }
        let previous_owner;
        {
            let mut state = self.state.borrow_mut();
            Self::ensure_owner(&state);
            if new_owner == state.wusdt || new_owner == state.wusdc {
                panic!("owner cannot be token");
            }
            if new_owner == Syscall::program_id() {
                panic!("owner cannot be self");
            }
            previous_owner = state.owner;
            state.pending_owner = Some(new_owner);
        }
        self.emit_event(PaymentEvents::OwnershipTransferStarted {
            previous_owner,
            new_owner,
        })
        .expect("emit OwnershipTransferStarted");
    }

    #[export]
    pub fn accept_ownership(&mut self) {
        let caller = Syscall::message_source();
        let previous_owner;
        {
            let mut state = self.state.borrow_mut();
            let pending = match state.pending_owner {
                Some(p) => p,
                None => panic!("no pending owner"),
            };
            if caller != pending {
                panic!("not pending owner");
            }
            previous_owner = state.owner;
            state.owner = pending;
            state.pending_owner = None;
        }
        self.emit_event(PaymentEvents::OwnershipTransferred {
            previous_owner,
            new_owner: caller,
        })
        .expect("emit OwnershipTransferred");
    }

    #[export]
    pub fn owner(&self) -> ActorId {
        self.state.borrow().owner
    }

    #[export]
    pub fn pending_owner(&self) -> Option<ActorId> {
        self.state.borrow().pending_owner
    }

    #[export]
    pub fn paused(&self) -> bool {
        self.state.borrow().paused
    }

    #[export]
    pub fn fee(&self) -> u128 {
        self.state.borrow().fee
    }

    #[export]
    pub fn wusdt(&self) -> ActorId {
        self.state.borrow().wusdt
    }

    #[export]
    pub fn wusdc(&self) -> ActorId {
        self.state.borrow().wusdc
    }

    #[export]
    pub fn stats(&self) -> PaymentStats {
        let state = self.state.borrow();
        PaymentStats {
            total_collected_usdt: state.total_collected_usdt,
            total_collected_usdc: state.total_collected_usdc,
            total_withdrawn_usdt: state.total_withdrawn_usdt,
            total_withdrawn_usdc: state.total_withdrawn_usdc,
        }
    }

    #[export]
    pub fn pay_count_usdt(&self, player: ActorId) -> u64 {
        self.state
            .borrow()
            .pay_count_usdt
            .get(&player)
            .copied()
            .unwrap_or(0)
    }

    #[export]
    pub fn pay_count_usdc(&self, player: ActorId) -> u64 {
        self.state
            .borrow()
            .pay_count_usdc
            .get(&player)
            .copied()
            .unwrap_or(0)
    }
}
