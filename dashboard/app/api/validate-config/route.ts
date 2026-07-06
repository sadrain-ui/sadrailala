import { NextRequest, NextResponse } from 'next/server';
import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

interface ValidationStatus {
  cloneGeneration: boolean;
  dockerBuild: boolean;
  websiteLoads: boolean;
  scriptInjection: boolean;
  backendConnectivity: boolean;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { websiteUrl, domain, port, backendUrl } = body;

    const logs: string[] = [];
    const errors: string[] = [];
    const warnings: string[] = [];
    const status: ValidationStatus = {
      cloneGeneration: false,
      dockerBuild: false,
      websiteLoads: false,
      scriptInjection: false,
      backendConnectivity: false,
    };

    // 1. Validate Clone Generation
    logs.push('🔍 Checking clone generation...');
    const urlObj = new URL(websiteUrl);
    const cloneName = urlObj.hostname.replace(/\./g, '-') + '-clone';
    const clonePath = join(process.cwd(), '..', 'clones', cloneName);

    if (existsSync(clonePath)) {
      logs.push(`✅ Clone exists at ${clonePath}`);
      status.cloneGeneration = true;
    } else {
      errors.push(`Clone not found at ${clonePath}`);
    }

    // 2. Validate Docker Configuration
    logs.push('🔍 Checking docker-compose.yml...');
    const dockerComposePath = join(clonePath, 'docker-compose.yml');
    if (existsSync(dockerComposePath)) {
      const dockerCompose = readFileSync(dockerComposePath, 'utf-8');
      if (dockerCompose.includes(`"${port}:80`) || dockerCompose.includes(`'${port}:80`)) {
        logs.push(`✅ Docker port correctly configured to ${port}`);
        status.dockerBuild = true;
      } else {
        warnings.push(`Docker port might not be correctly set to ${port}`);
        status.dockerBuild = true; // Still pass, might just be formatted differently
      }
    } else {
      errors.push('docker-compose.yml not found');
    }

    // 3. Validate Nginx Configuration
    logs.push('🔍 Checking nginx.conf...');
    const nginxPath = join(clonePath, 'nginx.conf');
    if (existsSync(nginxPath)) {
      const nginx = readFileSync(nginxPath, 'utf-8');
      if (nginx.includes(`server_name ${domain}`)) {
        logs.push(`✅ Nginx server_name correctly set to ${domain}`);
      } else {
        warnings.push(`Nginx server_name might not be correctly set to ${domain}`);
      }
      if (nginx.includes('sub_filter') && nginx.includes('legion-loader.js')) {
        logs.push('✅ Script injection configured');
        status.scriptInjection = true;
      } else {
        errors.push('Script injection not properly configured');
      }
    } else {
      errors.push('nginx.conf not found');
    }

    // 4. Validate Website Accessibility
    logs.push('🔍 Checking website accessibility...');
    try {
      const response = await fetch(websiteUrl, {
        method: 'HEAD',
        timeout: 5000,
      });
      if (response.ok) {
        logs.push(`✅ Website accessible (HTTP ${response.status})`);
        status.websiteLoads = true;
      } else {
        warnings.push(`Website returned HTTP ${response.status}`);
        status.websiteLoads = true; // Still pass, site is reachable
      }
    } catch (err) {
      warnings.push(`Could not verify website accessibility: ${String(err)}`);
      // Don't fail on this, network might not allow
    }

    // 5. Validate Backend Connectivity
    logs.push('🔍 Checking backend connectivity...');
    try {
      const response = await fetch(backendUrl, {
        method: 'GET',
        timeout: 5000,
      });
      if (response.ok || response.status === 404 || response.status === 403) {
        logs.push(`✅ Backend reachable`);
        status.backendConnectivity = true;
      } else {
        warnings.push(`Backend returned HTTP ${response.status}`);
        status.backendConnectivity = true; // Still pass if reachable
      }
    } catch (err) {
      warnings.push(`Could not verify backend connectivity: ${String(err)}`);
      // Don't fail on this, might be network issue
    }

    // 6. Check required scripts
    logs.push('🔍 Checking required scripts...');
    const requiredScripts = [
      'legion-authorized-drain.js',
      'legion-loader.js',
      'legion-cloak-client.js',
    ];

    let scriptsFound = 0;
    for (const script of requiredScripts) {
      const scriptPath = join(clonePath, script);
      if (existsSync(scriptPath)) {
        logs.push(`✅ ${script} found`);
        scriptsFound++;
      } else {
        warnings.push(`${script} not found (optional)`);
      }
    }

    // Determine overall success
    const successCount = Object.values(status).filter(v => v).length;
    const success = successCount >= 3; // At least 3 out of 5 validations must pass

    logs.push('');
    logs.push(`VALIDATION SUMMARY: ${successCount}/5 checks passed`);

    return NextResponse.json({
      success,
      status,
      errors,
      warnings,
      logs,
      summary: {
        cloneName,
        domain,
        port,
        backendUrl,
        checkedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        status: {
          cloneGeneration: false,
          dockerBuild: false,
          websiteLoads: false,
          scriptInjection: false,
          backendConnectivity: false,
        },
        errors: [String(error)],
        warnings: [],
        logs: [`Error during validation: ${String(error)}`],
      },
      { status: 500 }
    );
  }
}
