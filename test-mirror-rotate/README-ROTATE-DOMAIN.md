# Dynamic DNS domain rotation — authorized stress-test training only

**Mirror target:** https://example.com  
**Local mirror port:** 8080  
**Generated:** 2026-06-03T23:27:00.460Z

> **Purpose:** Teach blue/red teams how adversaries rotate hostnames via dynamic DNS (e.g. DuckDNS) to stay reachable after blocklists or takedown actions — and how defenders detect/respond.  
> **This bundle does not call DuckDNS or any DNS API.** All steps are manual documentation.

---

## When this applies (authorized labs only)

During **authorized** resilience and abuse-handling exercises, testers may simulate:

1. Deploying a QA mirror behind a public hostname
2. That hostname appearing on a blocklist or being taken down
3. **Rotating** to a new subdomain while keeping the same backend IP and docker stack

Understanding this workflow helps engineers improve detection (fast-flux patterns, new subdomain alerts) and response (block by infrastructure, not just hostname).

**Never** rotate domains to evade controls on systems you do not own or lack written authorization to test.

---

## Post-deployment workflow (manual)

After you start the mirror (`docker compose up` in this directory):

1. **Expose the stack** — Point a dynamic DNS name at your lab VPS public IP (or tunnel endpoint).
2. **Smoke test** — `curl -I http://YOUR-SUBDOMAIN.duckdns.org:8080/` should hit the local status page.
3. **Simulate takedown** — In the exercise, treat the current hostname as "burned" (blocked in training SIEM / lab DNS sinkhole).
4. **Register a new subdomain** — Create `legion-qa-mirror-02.duckdns.org` (or similar) in DuckDNS dashboard.
5. **Update DNS** — Manually run the update URL or use the template script (copy/edit first).
6. **Re-point clients** — Update exercise runbooks to use the new hostname; nginx/docker stack stays the same.
7. **Log rotation** — Record old/new names and timestamps for blue-team scoring.

---

## DuckDNS sample configuration (manual setup)

1. Create a free account at [duckdns.org](https://www.duckdns.org).
2. Create subdomains for your lab, e.g.:
   - `example-com-01.duckdns.org`
   - `example-com-02.duckdns.org`
3. Copy `duckdns.env.example` → `duckdns.env` and fill placeholders (**lab tokens only**).
4. Do **not** commit `duckdns.env` to git.

**Manual update URL shape** (run from your shell when IP changes):

```text
https://www.duckdns.org/update?domains=SUBDOMAIN&token=TOKEN&ip=PUBLIC_IP
```

Optional: omit `&ip=` to let DuckDNS detect your egress IP.

---

## Files in this bundle

| File | Purpose |
|------|---------|
| `README-ROTATE-DOMAIN.md` | This guide |
| `duckdns.env.example` | Placeholder env vars |
| `rotate-domain.sh.template` | Commented workflow + printed examples (no API calls when run as-is) |

---

## nginx / TLS notes for lab mirrors

The generated `nginx.conf` proxies to https://example.com. For public hostname testing you may additionally:

- Terminate TLS at a lab reverse proxy (Caddy, Traefik) in front of port 8080
- Add `server_name` blocks for each rotated DuckDNS hostname (manual edit)
- Use short-lived Let's Encrypt certs **only** on domains you control

Rotating DNS does not require rebuilding the mirror — only DNS records and client-facing URLs change.

---

## Blue-team detection hints

Monitor for:

- Multiple short-lived subdomains resolving to the same IP / ASN
- Newly registered dynamic DNS names in HTTP Referer or phishing reports
- Certificate transparency logs for unexpected hostnames on your infra
- Correlation: block one hostname → traffic resumes on a sibling subdomain within minutes

Mitigations: block by IP/ASN where appropriate, rate-limit new domain reputation checks, automate takedown playbooks with infrastructure-level blocks.

---

## Relation to this mirror

Target reference: `https://example.com`  
Local status: `http://localhost:8080/`

The `--rotate-domain` flag adds documentation and templates only. No cron jobs, webhooks, or DuckDNS tokens are configured by the generator.

**Authorized use:** Internal stress-test and security awareness training on infrastructure your team operates.
