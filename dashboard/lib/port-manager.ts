import { execSync } from 'child_process';
import { getDb } from './db';

export function findAvailablePort(startPort: number = 8080): number {
  const db = getDb();

  // Get all used ports from database
  const stmt = db.prepare('SELECT port FROM clones WHERE status = ? OR status = ?');
  const usedPorts = (stmt.all('running', 'created') as any[]).map(c => c.port);

  let port = startPort;
  const maxAttempts = 100;

  for (let i = 0; i < maxAttempts; i++) {
    if (!usedPorts.includes(port)) {
      // Verify port is actually free using netstat
      try {
        const output = execSync(`netstat -ano | findstr ":${port}"`, {
          encoding: 'utf-8',
          stdio: 'pipe',
        });

        if (!output.trim()) {
          return port; // Port is free
        }
      } catch (e) {
        // Command failed, port is likely free
        return port;
      }
    }
    port++;
  }

  throw new Error(`Could not find available port starting from ${startPort}`);
}

export function recordPort(cloneId: string, port: number) {
  const db = getDb();
  const stmt = db.prepare('UPDATE clones SET port = ? WHERE id = ?');
  stmt.run(port, cloneId);
}
