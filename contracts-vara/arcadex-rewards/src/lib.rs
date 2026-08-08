#![no_std]

//! ArcadeXRewards lite (Vara): STREAK check-in + SHUFFLE signed spins.
//! No on-chain claim / treasury — credits stay off-chain (RTDB).
//!
//! Spin signatures are sr25519 (server). On-chain stores the signer pubkey and
//! enforces interval/nonce/deadline/OFFCHAIN-only; Workers re-verify the
//! signature at prepare/sync (Gear has no lightweight sr25519 syscall here).

use core::cell::RefCell;
use sails_rs::{
    gstd::{event, export, program, service, Syscall},
    prelude::*,
};

pub const CAMPAIGN_TYPE_STREAK: u8 = 0;
pub const CAMPAIGN_TYPE_SHUFFLE: u8 = 1;
pub const REWARD_OFFCHAIN: u8 = 0;

pub type PublicKey = [u8; 32];
pub type Signature = [u8; 64];
pub type RewardMeta = [u8; 32];

#[derive(Default, Clone, Debug, Encode, Decode, TypeInfo, PartialEq, Eq)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub struct Campaign {
    pub active: bool,
    pub cancelled: bool,
    pub require_eligibility: bool,
    pub campaign_type: u8,
    pub required_days: u16,
    pub min_interval_seconds: u32,
    pub max_claims: u32,
    pub start_time: u64,
    pub end_time: u64,
    pub reward_mode: u8,
    pub reward_amount: u128,
    pub reward_meta: RewardMeta,
    pub reset_after_milestone: bool,
    pub max_single_payout: u128,
}

#[derive(Default, Clone, Debug, Encode, Decode, TypeInfo, PartialEq, Eq)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub struct Progress {
    pub current_day: u16,
    pub last_check_in_at: u64,
    pub milestone_reached: bool,
    pub on_chain_claimed: bool,
    pub initialized: bool,
}

#[derive(Default, Clone, Debug)]
pub struct RewardsState {
    pub owner: ActorId,
    pub pending_owner: Option<ActorId>,
    pub paused: bool,
    pub eligibility_signer: PublicKey,
    pub spin_result_signer: PublicKey,
    pub campaigns: collections::HashMap<u64, Campaign>,
    pub progress: collections::HashMap<(ActorId, u64), Progress>,
    pub spin_nonce: collections::HashMap<(ActorId, u64), u64>,
    pub has_participants: collections::HashMap<u64, bool>,
    pub claim_count: collections::HashMap<u64, u32>,
}

#[event]
#[derive(Encode, Decode, TypeInfo, Clone, Debug, PartialEq, Eq)]
#[codec(crate = sails_rs::scale_codec)]
#[scale_info(crate = sails_rs::scale_info)]
pub enum RewardsEvents {
    CheckedIn {
        player: ActorId,
        campaign_id: u64,
        day: u16,
        timestamp: u64,
    },
    MilestoneReached {
        player: ActorId,
        campaign_id: u64,
        day: u16,
        reward_mode: u8,
        reward_meta: RewardMeta,
        timestamp: u64,
    },
    StreakReset {
        player: ActorId,
        campaign_id: u64,
        reason: String,
        timestamp: u64,
    },
    SpinResultGranted {
        player: ActorId,
        campaign_id: u64,
        reward_mode: u8,
        reward_amount: u128,
        timestamp: u64,
    },
    CampaignUpdated {
        campaign_id: u64,
    },
    SpinResultSignerUpdated {
        signer: PublicKey,
    },
    EligibilitySignerUpdated {
        signer: PublicKey,
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
}

pub struct ArcadeXRewards<'a> {
    state: &'a RefCell<RewardsState>,
}

impl<'a> ArcadeXRewards<'a> {
    pub fn new(state: &'a RefCell<RewardsState>) -> Self {
        Self { state }
    }
}

#[service(events = RewardsEvents)]
impl<'a> ArcadeXRewards<'a> {
    fn ensure_owner(state: &RewardsState) {
        if Syscall::message_source() != state.owner {
            panic!("not owner");
        }
    }

    fn ensure_not_paused(state: &RewardsState) {
        if state.paused {
            panic!("paused");
        }
    }

    /// Gear timestamps are milliseconds; expose seconds for Base API parity.
    fn now_secs() -> u64 {
        Syscall::block_timestamp() / 1_000
    }

    fn utc_day(ts_secs: u64) -> u64 {
        ts_secs / 86_400
    }

    /// Daily streak check-in. Eligibility gate is reserved; pass empty for lite.
    #[export]
    pub fn check_in(&mut self, campaign_id: u64, _deadline: u64, _signature: Signature) {
        let player = Syscall::message_source();
        let now = Self::now_secs();
        let day: u16;
        let mut milestone_meta = RewardMeta::default();
        let mut milestone_mode = REWARD_OFFCHAIN;
        let mut reached_milestone = false;
        let mut reset_reason: Option<String> = None;

        {
            let mut state = self.state.borrow_mut();
            Self::ensure_not_paused(&state);

            let cfg = state
                .campaigns
                .get(&campaign_id)
                .cloned()
                .unwrap_or_default();
            if cfg.campaign_type != CAMPAIGN_TYPE_STREAK {
                panic!("invalid campaign type");
            }
            if !cfg.active {
                panic!("campaign inactive");
            }
            if cfg.cancelled {
                panic!("campaign cancelled");
            }
            if cfg.required_days == 0 || cfg.min_interval_seconds == 0 {
                panic!("campaign misconfigured");
            }
            if now < cfg.start_time {
                panic!("campaign not started");
            }
            if cfg.end_time != 0 && now > cfg.end_time {
                panic!("campaign ended");
            }
            if cfg.require_eligibility {
                panic!("eligibility required (not supported in lite)");
            }

            let key = (player, campaign_id);
            let mut p = state.progress.get(&key).cloned().unwrap_or_default();

            if !p.initialized {
                p.initialized = true;
                p.current_day = 1;
                if !state.has_participants.contains_key(&campaign_id) {
                    state.has_participants.insert(campaign_id, true);
                }
            } else {
                let last_day = Self::utc_day(p.last_check_in_at);
                let today = Self::utc_day(now);
                if today <= last_day {
                    panic!("too soon");
                }
                if today > last_day + 1 {
                    reset_reason = Some(String::from("missed_day"));
                    p.current_day = 1;
                    p.milestone_reached = false;
                    p.on_chain_claimed = false;
                } else if p.current_day == 0 {
                    p.current_day = 1;
                } else {
                    if p.current_day >= cfg.required_days {
                        panic!("streak complete");
                    }
                    p.current_day = p.current_day.saturating_add(1);
                }
            }

            p.last_check_in_at = now;
            day = p.current_day;

            if p.current_day >= cfg.required_days {
                if cfg.max_claims != 0 {
                    let used = state.claim_count.get(&campaign_id).copied().unwrap_or(0);
                    if used >= cfg.max_claims {
                        panic!("max claims");
                    }
                }
                p.milestone_reached = true;
                reached_milestone = true;
                milestone_mode = cfg.reward_mode;
                milestone_meta = cfg.reward_meta;
                let used = state.claim_count.get(&campaign_id).copied().unwrap_or(0);
                state
                    .claim_count
                    .insert(campaign_id, used.saturating_add(1));

                if cfg.reset_after_milestone && cfg.reward_mode == REWARD_OFFCHAIN {
                    reset_reason = Some(String::from("milestone_complete"));
                    p.current_day = 0;
                    p.milestone_reached = false;
                    p.on_chain_claimed = false;
                }
            }

            state.progress.insert(key, p);
        }

        self.emit_event(RewardsEvents::CheckedIn {
            player,
            campaign_id,
            day,
            timestamp: now,
        })
        .expect("emit CheckedIn");

        if let Some(reason) = reset_reason.clone() {
            if reason == "missed_day" {
                self.emit_event(RewardsEvents::StreakReset {
                    player,
                    campaign_id,
                    reason,
                    timestamp: now,
                })
                .expect("emit StreakReset");
            }
        }

        if reached_milestone {
            self.emit_event(RewardsEvents::MilestoneReached {
                player,
                campaign_id,
                day,
                reward_mode: milestone_mode,
                reward_meta: milestone_meta,
                timestamp: now,
            })
            .expect("emit MilestoneReached");

            if reset_reason.as_deref() == Some("milestone_complete") {
                self.emit_event(RewardsEvents::StreakReset {
                    player,
                    campaign_id,
                    reason: String::from("milestone_complete"),
                    timestamp: now,
                })
                .expect("emit StreakReset");
            }
        }
    }

    /// Record a server-signed shuffle outcome (OFFCHAIN only — no claim).
    #[export]
    pub fn spin(
        &mut self,
        campaign_id: u64,
        reward_mode: u8,
        reward_amount: u128,
        nonce: u64,
        deadline: u64,
        signature: Signature,
    ) {
        let player = Syscall::message_source();
        let now = Self::now_secs();

        {
            let mut state = self.state.borrow_mut();
            Self::ensure_not_paused(&state);

            let cfg = state
                .campaigns
                .get(&campaign_id)
                .cloned()
                .unwrap_or_default();
            if cfg.campaign_type != CAMPAIGN_TYPE_SHUFFLE {
                panic!("invalid campaign type");
            }
            if !cfg.active {
                panic!("campaign inactive");
            }
            if cfg.cancelled {
                panic!("campaign cancelled");
            }
            if cfg.min_interval_seconds == 0 {
                panic!("campaign misconfigured");
            }
            if now < cfg.start_time {
                panic!("campaign not started");
            }
            if cfg.end_time != 0 && now > cfg.end_time {
                panic!("campaign ended");
            }
            if now > deadline {
                panic!("spin expired");
            }
            // Lite: off-chain credits only.
            if reward_mode != REWARD_OFFCHAIN {
                panic!("offchain only");
            }
            if reward_amount != 0 && cfg.max_single_payout != 0 && reward_amount > cfg.max_single_payout
            {
                panic!("payout too high");
            }
            if state.spin_result_signer == [0u8; 32] {
                panic!("spin signer required");
            }
            // Signature must be present (sr25519 verified off-chain at sync).
            if signature == [0u8; 64] {
                panic!("invalid spin signature");
            }

            let key = (player, campaign_id);
            let mut p = state.progress.get(&key).cloned().unwrap_or_default();
            if p.initialized && Self::utc_day(now) <= Self::utc_day(p.last_check_in_at) {
                panic!("spin too soon");
            }

            let expected_nonce = state.spin_nonce.get(&key).copied().unwrap_or(0);
            if nonce != expected_nonce {
                panic!("invalid spin nonce");
            }
            state.spin_nonce.insert(key, nonce.saturating_add(1));

            if !p.initialized {
                p.initialized = true;
                if !state.has_participants.contains_key(&campaign_id) {
                    state.has_participants.insert(campaign_id, true);
                }
            }
            p.last_check_in_at = now;
            p.milestone_reached = false;
            p.on_chain_claimed = false;
            state.progress.insert(key, p);
        }

        self.emit_event(RewardsEvents::SpinResultGranted {
            player,
            campaign_id,
            reward_mode,
            reward_amount,
            timestamp: now,
        })
        .expect("emit SpinResultGranted");
    }

    #[export]
    pub fn set_campaign(
        &mut self,
        campaign_id: u64,
        campaign_type: u8,
        active: bool,
        required_days: u16,
        min_interval_seconds: u32,
        max_claims: u32,
        start_time: u64,
        end_time: u64,
        reward_mode: u8,
        reward_amount: u128,
        reward_meta: RewardMeta,
        reset_after_milestone: bool,
        require_eligibility: bool,
        max_single_payout: u128,
        cancelled: bool,
    ) {
        {
            let mut state = self.state.borrow_mut();
            Self::ensure_owner(&state);
            if campaign_type > CAMPAIGN_TYPE_SHUFFLE {
                panic!("bad campaign type");
            }
            if reward_mode != REWARD_OFFCHAIN {
                panic!("lite: offchain reward mode only");
            }
            if state.has_participants.get(&campaign_id).copied().unwrap_or(false) {
                // Freeze core params after first participant (Base parity).
                if let Some(existing) = state.campaigns.get(&campaign_id) {
                    if existing.campaign_type != campaign_type
                        || existing.required_days != required_days
                        || existing.min_interval_seconds != min_interval_seconds
                        || existing.reward_mode != reward_mode
                        || existing.reward_amount != reward_amount
                        || existing.reward_meta != reward_meta
                        || existing.reset_after_milestone != reset_after_milestone
                        || existing.require_eligibility != require_eligibility
                        || existing.max_single_payout != max_single_payout
                    {
                        panic!("campaign frozen");
                    }
                }
            }
            state.campaigns.insert(
                campaign_id,
                Campaign {
                    active,
                    cancelled,
                    require_eligibility,
                    campaign_type,
                    required_days,
                    min_interval_seconds,
                    max_claims,
                    start_time,
                    end_time,
                    reward_mode,
                    reward_amount,
                    reward_meta,
                    reset_after_milestone,
                    max_single_payout,
                },
            );
        }
        self.emit_event(RewardsEvents::CampaignUpdated { campaign_id })
            .expect("emit CampaignUpdated");
    }

    #[export]
    pub fn set_spin_result_signer(&mut self, signer: PublicKey) {
        {
            let mut state = self.state.borrow_mut();
            Self::ensure_owner(&state);
            state.spin_result_signer = signer;
        }
        self.emit_event(RewardsEvents::SpinResultSignerUpdated { signer })
            .expect("emit SpinResultSignerUpdated");
    }

    #[export]
    pub fn set_eligibility_signer(&mut self, signer: PublicKey) {
        {
            let mut state = self.state.borrow_mut();
            Self::ensure_owner(&state);
            state.eligibility_signer = signer;
        }
        self.emit_event(RewardsEvents::EligibilitySignerUpdated { signer })
            .expect("emit EligibilitySignerUpdated");
    }

    #[export]
    pub fn pause(&mut self) {
        {
            let mut state = self.state.borrow_mut();
            Self::ensure_owner(&state);
            state.paused = true;
        }
        self.emit_event(RewardsEvents::Paused).expect("emit Paused");
    }

    #[export]
    pub fn unpause(&mut self) {
        {
            let mut state = self.state.borrow_mut();
            Self::ensure_owner(&state);
            state.paused = false;
        }
        self.emit_event(RewardsEvents::Unpaused).expect("emit Unpaused");
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
        self.emit_event(RewardsEvents::OwnershipTransferStarted {
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
        self.emit_event(RewardsEvents::OwnershipTransferred {
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
    pub fn spin_result_signer(&self) -> PublicKey {
        self.state.borrow().spin_result_signer
    }

    #[export]
    pub fn eligibility_signer(&self) -> PublicKey {
        self.state.borrow().eligibility_signer
    }

    #[export]
    pub fn get_campaign(&self, campaign_id: u64) -> Campaign {
        self.state
            .borrow()
            .campaigns
            .get(&campaign_id)
            .cloned()
            .unwrap_or_default()
    }

    #[export]
    pub fn get_progress(&self, player: ActorId, campaign_id: u64) -> Progress {
        self.state
            .borrow()
            .progress
            .get(&(player, campaign_id))
            .cloned()
            .unwrap_or_default()
    }

    #[export]
    pub fn spin_nonce_of(&self, player: ActorId, campaign_id: u64) -> u64 {
        self.state
            .borrow()
            .spin_nonce
            .get(&(player, campaign_id))
            .copied()
            .unwrap_or(0)
    }
}

pub struct ArcadeXRewardsProgram {
    state: RefCell<RewardsState>,
}

#[program]
impl ArcadeXRewardsProgram {
    /// Deploy constructor: deployer becomes owner.
    pub fn new() -> Self {
        let owner = Syscall::message_source();
        Self {
            state: RefCell::new(RewardsState {
                owner,
                pending_owner: None,
                paused: false,
                eligibility_signer: [0u8; 32],
                spin_result_signer: [0u8; 32],
                campaigns: collections::HashMap::new(),
                progress: collections::HashMap::new(),
                spin_nonce: collections::HashMap::new(),
                has_participants: collections::HashMap::new(),
                claim_count: collections::HashMap::new(),
            }),
        }
    }

    #[export(route = "ArcadeXRewards")]
    pub fn arcade_x_rewards(&self) -> ArcadeXRewards<'_> {
        ArcadeXRewards::new(&self.state)
    }
}
