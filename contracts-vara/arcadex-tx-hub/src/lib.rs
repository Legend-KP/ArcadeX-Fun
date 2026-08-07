#![no_std]

use core::cell::RefCell;
use sails_rs::{
    gstd::{event, export, program, service, Syscall},
    prelude::*,
};

/// Free play sign-in purpose encoding (document for clients):
/// `blake2b-256(UTF-8 "PLAY:{gameId}")` → `[u8; 32]`.
pub type Purpose = [u8; 32];

#[derive(Default, Clone, Debug)]
pub struct TxHubState {
    pub owner: ActorId,
    pub pending_owner: Option<ActorId>,
    pub paused: bool,
    pub sign_in_count: u64,
    /// Future paid purposes (Phase 2+). Fee is VFT base units.
    pub fees: collections::HashMap<Purpose, u128>,
}

#[event]
#[derive(Encode, Decode, TypeInfo, Clone, Debug, PartialEq, Eq)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub enum TxHubEvents {
    SignedIn {
        player: ActorId,
        purpose: Purpose,
        timestamp: u64,
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
    FeeUpdated {
        purpose: Purpose,
        fee: u128,
    },
}

pub struct ArcadeXTxHub<'a> {
    state: &'a RefCell<TxHubState>,
}

impl<'a> ArcadeXTxHub<'a> {
    pub fn new(state: &'a RefCell<TxHubState>) -> Self {
        Self { state }
    }
}

#[service(events = TxHubEvents)]
impl<'a> ArcadeXTxHub<'a> {
    fn ensure_owner(state: &TxHubState) {
        let caller = Syscall::message_source();
        if caller != state.owner {
            panic!("not owner");
        }
    }

    fn ensure_not_paused(state: &TxHubState) {
        if state.paused {
            panic!("paused");
        }
    }

    /// Free activity tx when the player clicks Start Game.
    #[export]
    pub fn sign_in(&mut self, purpose: Purpose) {
        let timestamp = Syscall::block_timestamp();
        let player = Syscall::message_source();
        {
            let mut state = self.state.borrow_mut();
            Self::ensure_not_paused(&state);
            state.sign_in_count = state.sign_in_count.saturating_add(1);
        }
        self.emit_event(TxHubEvents::SignedIn {
            player,
            purpose,
            timestamp,
        })
        .expect("emit SignedIn");
    }

    #[export]
    pub fn pause(&mut self) {
        {
            let mut state = self.state.borrow_mut();
            Self::ensure_owner(&state);
            state.paused = true;
        }
        self.emit_event(TxHubEvents::Paused).expect("emit Paused");
    }

    #[export]
    pub fn unpause(&mut self) {
        {
            let mut state = self.state.borrow_mut();
            Self::ensure_owner(&state);
            state.paused = false;
        }
        self.emit_event(TxHubEvents::Unpaused).expect("emit Unpaused");
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
            previous_owner = state.owner;
            state.pending_owner = Some(new_owner);
        }
        self.emit_event(TxHubEvents::OwnershipTransferStarted {
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
        self.emit_event(TxHubEvents::OwnershipTransferred {
            previous_owner,
            new_owner: caller,
        })
        .expect("emit OwnershipTransferred");
    }

    /// Owner sets a fee for a future paid purpose (Phase 2 VFT pays).
    #[export]
    pub fn set_fee(&mut self, purpose: Purpose, fee: u128) {
        {
            let mut state = self.state.borrow_mut();
            Self::ensure_owner(&state);
            if fee == 0 {
                state.fees.remove(&purpose);
            } else {
                state.fees.insert(purpose, fee);
            }
        }
        self.emit_event(TxHubEvents::FeeUpdated { purpose, fee })
            .expect("emit FeeUpdated");
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
    pub fn sign_in_count(&self) -> u64 {
        self.state.borrow().sign_in_count
    }

    #[export]
    pub fn fee_of(&self, purpose: Purpose) -> u128 {
        self.state
            .borrow()
            .fees
            .get(&purpose)
            .copied()
            .unwrap_or(0)
    }
}

pub struct ArcadeXTxHubProgram {
    state: RefCell<TxHubState>,
}

#[program]
impl ArcadeXTxHubProgram {
    /// Deploy constructor: deployer becomes owner.
    pub fn new() -> Self {
        let owner = Syscall::message_source();
        Self {
            state: RefCell::new(TxHubState {
                owner,
                pending_owner: None,
                paused: false,
                sign_in_count: 0,
                fees: collections::HashMap::new(),
            }),
        }
    }

    #[export(route = "ArcadeXTxHub")]
    pub fn arcade_x_tx_hub(&self) -> ArcadeXTxHub<'_> {
        ArcadeXTxHub::new(&self.state)
    }
}
