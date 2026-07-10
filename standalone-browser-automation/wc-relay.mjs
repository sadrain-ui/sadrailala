#!/usr/bin/env node
/**
 * WalletConnect URI relay — desktop QR ke liye mobile bridge helper.
 * Page se wc: URI capture karke yahan paste karo ya stdin se lo.
 *
 * Usage:
 *   node wc-relay.mjs "wc:abc123..."
 *   echo wc:... | node wc-relay.mjs
 *
 * WalletConnect v2 pairing ke liye @walletconnect/sign-client chahiye hota hai.
 * Ye helper URI ko validate + log karta hai; full mobile relay ke liye
 * WalletConnect Cloud projectId set karo.
 */

import { createInterface } from 'node:readline';

const uri = process.argv[2] || '';

function validateWcUri(u) {
  if (!u.startsWith('wc:')) throw new Error('Invalid URI — must start with wc:');
  const [topic, query] = u.slice(3).split('?');
  if (!topic || topic.length < 10) throw new Error('Invalid topic');
  return { topic, query: new URLSearchParams(query || ''), raw: u };
}

async function main() {
  let input = uri;
  if (!input) {
    const rl = createInterface({ input: process.stdin });
    for await (const line of rl) {
      input = line.trim();
      if (input) break;
    }
  }

  const parsed = validateWcUri(input);
  console.log('[wc-relay] Valid WalletConnect URI');
  console.log('  topic:', parsed.topic);
  console.log('  relay:', parsed.query.get('relay-protocol') || 'irn');
  console.log('  symKey:', parsed.query.get('symKey') ? '[present]' : '[missing]');
  console.log('\nPaste this URI in WalletConnect-compatible mobile wallet (Scan QR / Paste link).');
  console.log('\nFull URI:\n', parsed.raw);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
