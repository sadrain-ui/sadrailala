<div align="center" style="background:#000;color:#e8e8e8;padding:24px 16px;margin:-8px -8px 24px;border:1px solid #1a1a1a;font-family:system-ui,sans-serif">

#000

</div>

## Lethality Activation — Actionable Tasks

1. Enter `SOVEREIGN_VAULT_EVM` in `.env.clean` with the production EVM Vault Anchor address.
2. Enter `SOVEREIGN_VAULT_SOL` in `.env.clean` with the production SVM Vault Anchor address.
3. Enter `SOVEREIGN_VAULT_TRON` in `.env.clean` with the production TRON Vault Anchor address.
4. Provision `TRON_PRO_API_KEY` to avoid public fallback rate-limits on TRON Sensory operations.
5. Set `TONCENTER_API_KEY` for stable TON Dynamic Oracle-adjacent throughput.
6. Confirm `API_SITE_URL` and `API_CORS_ORIGINS` match the active airdrop-hub production domain.
7. Replace placeholder `SHADOW_VAULT_KEY` with a master Entropy key from secure key custody.
8. Rotate placeholder `GATEKEEPER_SECRET` to Emperor-managed Entropy before production start.
9. Verify production startup with Vault Anchor variables present (Fatal Halt is active when missing).
10. Validate Dynamic Oracle output on `/api/scout/recursive-predator-fusion` by confirming non-zero `reference_rates_usd`.

CALIBRATION_COMPLETE: Dynamic oracles staged. Vault guards active. System: AWAITING MASTER KEYS.

