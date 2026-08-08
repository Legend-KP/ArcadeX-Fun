use sails_rs::{
    gstd::msg,
    prelude::*,
};

use crate::tokens::REPLY_DEPOSIT;

/// Encode U256 as little-endian 32 bytes (matches `lib/vara-vft-codec.ts`).
pub fn u256_from_u128(value: u128) -> [u8; 32] {
    let mut out = [0u8; 32];
    out[..16].copy_from_slice(&value.to_le_bytes());
    out
}

/// Decode little-endian U256 into `u128` (panics if high 16 bytes are non-zero).
pub fn u256_to_u128(bytes: [u8; 32]) -> u128 {
    for b in &bytes[16..] {
        if *b != 0 {
            panic!("u256 exceeds u128");
        }
    }
    let mut le = [0u8; 16];
    le.copy_from_slice(&bytes[..16]);
    u128::from_le_bytes(le)
}

fn encode_service_call(service: &str, method: &str, args: impl Encode) -> Vec<u8> {
    let mut payload = (String::from(service), String::from(method)).encode();
    args.encode_to(&mut payload);
    payload
}

/// `Vft::Approve(spender, value)` → `(String, String, [u8;32], U256)`.
pub fn encode_approve(spender: ActorId, value: u128) -> Vec<u8> {
    encode_service_call("Vft", "Approve", (spender, u256_from_u128(value)))
}

/// `Vft::Transfer(to, value)` → `(String, String, [u8;32], U256)`.
pub fn encode_transfer(to: ActorId, value: u128) -> Vec<u8> {
    encode_service_call("Vft", "Transfer", (to, u256_from_u128(value)))
}

/// `Vft::TransferFrom(from, to, value)` → `(String, String, [u8;32], [u8;32], U256)`.
pub fn encode_transfer_from(from: ActorId, to: ActorId, value: u128) -> Vec<u8> {
    encode_service_call(
        "Vft",
        "TransferFrom",
        (from, to, u256_from_u128(value)),
    )
}

/// `Vft::BalanceOf(account)` → `(String, String, [u8;32])`.
pub fn encode_balance_of(account: ActorId) -> Vec<u8> {
    encode_service_call("Vft", "BalanceOf", account)
}

fn decode_bool_reply(reply: &[u8]) -> bool {
    let (service, method, ok) =
        <(String, String, bool)>::decode(&mut &reply[..]).expect("decode bool reply");
    if service != "Vft" {
        panic!("unexpected service reply");
    }
    let _ = method;
    ok
}

fn decode_u256_reply(reply: &[u8]) -> u128 {
    let (service, method, raw) =
        <(String, String, [u8; 32])>::decode(&mut &reply[..]).expect("decode u256 reply");
    if service != "Vft" {
        panic!("unexpected service reply");
    }
    let _ = method;
    u256_to_u128(raw)
}

/// Async `Vft::TransferFrom` via `msg::send_bytes_for_reply`.
pub async fn transfer_from(
    vft: ActorId,
    from: ActorId,
    to: ActorId,
    value: u128,
) -> bool {
    let payload = encode_transfer_from(from, to, value);
    let reply = msg::send_bytes_for_reply(vft, payload, 0, REPLY_DEPOSIT)
        .expect("send TransferFrom")
        .await
        .expect("TransferFrom reply");
    decode_bool_reply(&reply)
}

/// Async `Vft::Transfer` via `msg::send_bytes_for_reply`.
pub async fn transfer(vft: ActorId, to: ActorId, value: u128) -> bool {
    let payload = encode_transfer(to, value);
    let reply = msg::send_bytes_for_reply(vft, payload, 0, REPLY_DEPOSIT)
        .expect("send Transfer")
        .await
        .expect("Transfer reply");
    decode_bool_reply(&reply)
}

/// Async `Vft::BalanceOf` via `msg::send_bytes_for_reply`.
pub async fn balance_of(vft: ActorId, account: ActorId) -> u128 {
    let payload = encode_balance_of(account);
    let reply = msg::send_bytes_for_reply(vft, payload, 0, REPLY_DEPOSIT)
        .expect("send BalanceOf")
        .await
        .expect("BalanceOf reply");
    decode_u256_reply(&reply)
}
