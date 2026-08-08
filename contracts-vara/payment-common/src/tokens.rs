use sails_rs::prelude::*;

/// Vara mainnet bridged wUSDC program id.
pub const WUSDC: ActorId = ActorId::new(hex_to_actor(
    "d1de816d7dce6439504552686ab333e5b7302b1549763656b30af1f8a5871b6a",
));

/// Vara mainnet bridged wUSDT program id.
pub const WUSDT: ActorId = ActorId::new(hex_to_actor(
    "4255ff4a87a4c13dc39f74ace8c4948bbef2f75fb639d66639a1cfcc99e6243e",
));

/// Default SparkRefill fee (6 decimals): $0.05.
pub const FEE_SPARK_REFILL: u128 = 50_000;

/// Default ScoreSubmit fee (6 decimals): $0.05.
pub const FEE_SCORE_SUBMIT: u128 = 50_000;

/// Default InfiniteSpark fee (6 decimals): $0.10.
pub const FEE_INFINITE_SPARK: u128 = 100_000;

/// Gas reserved for VFT reply handling (`msg::send_bytes_for_reply` deposit).
pub const REPLY_DEPOSIT: u64 = 10_000_000_000;

/// Compile-time hex → `[u8; 32]` (no `0x` prefix).
const fn hex_to_actor(hex: &str) -> [u8; 32] {
    let bytes = hex.as_bytes();
    assert!(bytes.len() == 64);
    let mut out = [0u8; 32];
    let mut i = 0;
    while i < 32 {
        out[i] = (hex_nibble(bytes[i * 2]) << 4) | hex_nibble(bytes[i * 2 + 1]);
        i += 1;
    }
    out
}

const fn hex_nibble(b: u8) -> u8 {
    match b {
        b'0'..=b'9' => b - b'0',
        b'a'..=b'f' => b - b'a' + 10,
        b'A'..=b'F' => b - b'A' + 10,
        _ => panic!("invalid hex"),
    }
}
