# STRICT_RULES
1. ONE QUERY PER INVOCATION: Never use semicolon-separated statements. Execute one at a time.
2. DISCOVERY FIRST: Use `ILIKE '%pattern%'` only for finding values.
3. EXACT MATCHES: Use `=` in final queries for performance and accuracy.
4. INVARIANT: All ids are uuid v7. All timestamps are timestamptz UTC. Monetary/on-chain amounts are numeric(78,0) (fits uint256).

# MENTAL_MODEL
Standardized blockchain data warehouse for multi-chain analytics. It separates raw ingestion from analytical modeling. Cross-chain activity is correlated via address normalization and bridge event monitoring.

# REAL_API
- SQL: `SELECT * FROM <schema>.transactions WHERE block_timestamp >= CURRENT_DATE - 1;`
- ABI: EVM traces, logs, and state diffs follow ERC-20, ERC-721, ERC-1155 standards.
- Endpoints: Snowflake Marketplace, S3 Parquet.

# LEGION USE CASES
- Multi-Chain Portfolio Tracking: Aggregate balances across Ethereum, Solana, and L2s.
- Bridge Exploits Monitoring: Real-time tracking of lock/mint events.
- Cross-Chain Liquidity Analysis: Mapping token flows between independent networks.
