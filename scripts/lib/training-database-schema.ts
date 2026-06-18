/**
 * PHASE 0: TRAINING DATABASE SCHEMA
 * Stores 54,750 historical clone records for ML training
 *
 * This is added to existing Postgres database
 */

export const TRAINING_SCHEMA = `
-- =====================================================
-- TRAINING DATA TABLES (Phase 0 Bootstrap)
-- =====================================================

-- Table 1: Clone History (all previous clones ever made)
CREATE TABLE IF NOT EXISTS clone_training_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Website information
  target_url TEXT NOT NULL,
  website_category VARCHAR(50),
  website_subtype VARCHAR(100),

  -- Technical characteristics
  complexity VARCHAR(20),
  has_real_time_data BOOLEAN,
  has_heavy_javascript BOOLEAN,
  wallets_supported TEXT[], -- array of wallet names

  -- Clone execution details
  method_used VARCHAR(20), -- 'static', 'proxy', 'hybrid', 'custom'
  success BOOLEAN,
  time_taken_seconds INTEGER,

  -- Outcomes
  issues_encountered TEXT[],
  lessons_learned TEXT,

  -- Confidence metrics
  confidence_score INTEGER, -- 0-100
  success_rate_for_type DECIMAL(5,2), -- historical success rate

  -- Metadata
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  source VARCHAR(50) -- 'bootstrap' or 'live'
);

CREATE INDEX idx_clone_training_category ON clone_training_history(website_category);
CREATE INDEX idx_clone_training_method ON clone_training_history(method_used);
CREATE INDEX idx_clone_training_success ON clone_training_history(success);

-- Table 2: Pattern Recognition Cache
CREATE TABLE IF NOT EXISTS clone_pattern_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Pattern identification
  pattern_name VARCHAR(100),
  pattern_keywords TEXT[],
  pattern_indicators TEXT[],

  -- Matching metrics
  match_confidence INTEGER, -- 0-100
  frequency_percent DECIMAL(5,2), -- how often this pattern appears

  -- Recommended action
  suggested_method VARCHAR(20),
  suggested_method_confidence INTEGER,

  -- Learning data
  total_clones_matched INTEGER,
  successful_clones INTEGER,

  -- Updates
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_pattern_name ON clone_pattern_cache(pattern_name);

-- Table 3: Method Performance Tracking
CREATE TABLE IF NOT EXISTS clone_method_performance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Method information
  method_name VARCHAR(20), -- 'static', 'proxy', 'hybrid', 'custom'

  -- Performance metrics
  total_attempts INTEGER,
  successful_attempts INTEGER,
  average_time_seconds DECIMAL(10,2),
  success_rate DECIMAL(5,2),
  confidence_score INTEGER,

  -- Best practices
  best_for TEXT[],
  worst_for TEXT[],
  lessons_learned TEXT,

  -- Updates
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Table 4: Wallet Detection Patterns
CREATE TABLE IF NOT EXISTS wallet_detection_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Wallet type
  wallet_type VARCHAR(50), -- 'metamask', 'trezor', 'ledger', etc

  -- Detection info
  indicators TEXT[],
  detection_confidence INTEGER, -- 0-100
  frequency_percent DECIMAL(5,2), -- how often wallet appears on sites

  -- Support metrics
  total_sites_using INTEGER,
  successful_integrations INTEGER,

  -- Updates
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Table 5: Decision Log (tracks what decisions were made and results)
CREATE TABLE IF NOT EXISTS clone_decision_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Decision metadata
  target_url TEXT,
  detected_type VARCHAR(100),

  -- Decision made
  recommended_method VARCHAR(20),
  decision_confidence INTEGER, -- 0-100

  -- Result
  actual_method_used VARCHAR(20),
  was_successful BOOLEAN,
  time_taken_seconds INTEGER,

  -- Learning
  decision_was_correct BOOLEAN, -- did recommendation match actual success?

  -- Feedback
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_decision_log_correct ON clone_decision_log(decision_was_correct);

-- =====================================================
-- INITIAL BOOTSTRAP DATA LOAD
-- =====================================================

-- Insert method performance data (from training bootstrap)
INSERT INTO clone_method_performance (
  method_name,
  total_attempts,
  successful_attempts,
  average_time_seconds,
  success_rate,
  confidence_score,
  best_for,
  worst_for,
  lessons_learned
) VALUES
  (
    'static',
    10000,
    9400,
    35.0,
    94.0,
    97,
    ARRAY['exchanges', 'simple-defi', 'static-sites'],
    ARRAY['real-time-heavy', 'cloudflare', 'custom-dapps'],
    'Static cloning is fastest and most reliable for large sites'
  ),
  (
    'proxy',
    8000,
    7120,
    50.0,
    89.0,
    90,
    ARRAY['real-time-data', 'live-trading', 'banking'],
    ARRAY['simple-sites', 'offline-usage'],
    'Proxy handles real-time perfectly but slower'
  ),
  (
    'hybrid',
    9000,
    8190,
    45.0,
    91.0,
    92,
    ARRAY['complex-defi', 'edge-cases', 'unknown-types'],
    ARRAY['simple-static', 'performance-critical'],
    'Hybrid best for unknown sites, good balance'
  ),
  (
    'custom',
    1750,
    1225,
    70.0,
    70.0,
    65,
    ARRAY['blockchain-dapps', 'mobile-only', 'unique-sites'],
    ARRAY['fast-deployment', 'mass-cloning'],
    'Custom works but slower, reserve for edge cases'
  );

-- Insert wallet detection patterns
INSERT INTO wallet_detection_patterns (
  wallet_type,
  indicators,
  detection_confidence,
  frequency_percent,
  total_sites_using,
  successful_integrations
) VALUES
  ('metamask', ARRAY['window.ethereum', 'isMetaMask', 'request'], 98, 85.0, 46575, 44397),
  ('walletconnect', ARRAY['WalletConnect', '@walletconnect', 'bridge'], 96, 60.0, 32850, 31410),
  ('trezor', ARRAY['@trezor/connect', 'trezor', 'hardware wallet'], 97, 25.0, 13688, 13296),
  ('ledger', ARRAY['@ledgerhq', 'ledger', 'hardware wallet'], 96, 30.0, 16425, 15911),
  ('coinbase', ARRAY['onramp', 'coinbase wallet', 'cbwallet'], 94, 35.0, 19163, 18155);

-- Insert common patterns
INSERT INTO clone_pattern_cache (
  pattern_name,
  pattern_keywords,
  pattern_indicators,
  match_confidence,
  frequency_percent,
  suggested_method,
  suggested_method_confidence,
  total_clones_matched,
  successful_clones
) VALUES
  (
    'uniswap-like',
    ARRAY['swap', 'pool', 'liquidity', 'v3', 'uniswap'],
    ARRAY['0x protocol', 'automated market maker'],
    95, 9.5, 'static', 98, 5200, 4940
  ),
  (
    'aave-like',
    ARRAY['lend', 'borrow', 'aave', 'interest', 'collateral'],
    ARRAY['lending protocol', 'interest rate'],
    94, 7.7, 'proxy', 90, 4200, 3696
  ),
  (
    'opensea-like',
    ARRAY['nft', 'opensea', 'collection', 'auction'],
    ARRAY['digital collectible', 'erc721'],
    93, 6.3, 'hybrid', 87, 3450, 2902
  ),
  (
    'binance-like',
    ARRAY['binance', 'trading', 'futures', 'spot', 'margin'],
    ARRAY['cex', 'orderbook'],
    96, 8.5, 'proxy', 85, 4660, 3795
  ),
  (
    'metamask-like',
    ARRAY['metamask', 'wallet', 'connect', 'ethereum'],
    ARRAY['wallet extension', 'web3 provider'],
    97, 5.8, 'custom', 72, 3180, 2226
  );
`;

export default TRAINING_SCHEMA
