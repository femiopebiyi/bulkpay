use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct TransferRecord {
    // capped at MAX_NAME_LEN
    pub address: Pubkey,              // 32 bytes
    pub amount_received: u64,         // 8 bytes
    pub total_all_time_received: u64, // 8 bytes
    pub timestamp: i64,               // unix timestamp, 8 bytes
}

impl TransferRecord {
    // 32 + 8 + 8 + 8 = 56 bytes (was 92 with name)
    pub const LEN: usize = 32 + 8 + 8 + 8;
}

#[account]
pub struct TransferLog {
    pub bump: u8,
    pub records: Vec<TransferRecord>,
}

impl TransferLog {
    pub const BASE_LEN: usize = 8 + 1 + 4;
    pub const INITIAL_CAPACITY: usize = 50;
    pub const GROWTH_CHUNK: usize = 50;

    pub fn space_needed(record_count: usize) -> usize {
        Self::BASE_LEN + record_count * TransferRecord::LEN
    }

    pub fn initial_space() -> usize {
        Self::space_needed(Self::INITIAL_CAPACITY)
    }

    // grows in chunks — avoids realloc on every single call
    pub fn next_capacity(current_len: usize, new_records: usize) -> usize {
        let needed = current_len + new_records;
        // round up to the next GROWTH_CHUNK boundary
        let chunks = (needed + Self::GROWTH_CHUNK - 1) / Self::GROWTH_CHUNK;
        chunks * Self::GROWTH_CHUNK
    }
}
