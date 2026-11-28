# Karnataka mandi price relay (Cloudflare Worker)

This directory contains the Cloudflare Worker used by FarmConnect's GitHub Actions workflow to reach the official data.gov.in mandi-price API.

## Current deployment

- Worker name: `farmconnect-mandi-relay`
- Worker URL: `https://farmconnect-mandi-relay.manishn1877.workers.dev`
- Source: `worker.js`
- Wrangler configuration: `wrangler.toml`

The Worker is already deployed. Do not redeploy it just to run the normal price update workflow.

## Why the relay exists

The GitHub-hosted runner used by the project could not reliably establish a direct connection to `api.data.gov.in`. The Cloudflare Worker acts as an authenticated HTTPS relay between GitHub Actions and the official API. This separates the network path from the Python data-processing script.

## Request flow

```text
GitHub Actions
  -> Cloudflare Worker (X-Relay-Token)
  -> data.gov.in (API key forwarded in X-Api-Key)
  -> scripts/fetch_prices.py
  -> data/prices.json and data/board.json
```

The Worker is deliberately not a general-purpose proxy. It uses a fixed upstream, validates the shared relay token, and restricts accepted query parameters. Do not broaden those restrictions without a security review.

## Cost and Free plan limits

The Worker can run on Cloudflare's **Workers Free** plan at **$0/month**, provided the account stays within the free usage limits. Cloudflare currently documents a limit of **100,000 Worker requests per day** and **10 ms CPU time per invocation** on the Free plan. This project calls the relay only during the two scheduled price updates and occasional manual tests, so its expected request volume is far below that request allowance.

The Free plan does not automatically turn into a paid plan when the free request limit is reached; requests can fail with Cloudflare's limit response until the quota resets. A Workers Paid plan starts at **US$5/month** and is not required for the current low-volume use case. Check Cloudflare's current pricing and limits before changing plans:

- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)

Do not enable a paid plan solely for this FarmConnect relay unless actual usage or a required feature justifies it. You can review usage and billing in the Cloudflare dashboard.

## Required secrets

### Cloudflare Worker secret

The Worker must have a secret named `RELAY_TOKEN`. Set or rotate it from the `relay/` directory:

```bash
npx wrangler secret put RELAY_TOKEN
```

Wrangler prompts for the value. Do not put the token in `wrangler.toml`, source code, shell history, Git commits, or screenshots.

### GitHub repository Actions secrets

Configure these in **GitHub → Farm-Connect → Settings → Secrets and variables → Actions**:

| Secret | Value |
| --- | --- |
| `FC_RELAY_URL` | `https://farmconnect-mandi-relay.manishn1877.workers.dev` |
| `FC_RELAY_TOKEN` | The same secret value configured as the Worker's `RELAY_TOKEN` |
| `DATA_GOV_API_KEY` | The API key issued by data.gov.in |

The secret values must never be committed to the repository or copied into documentation.

## Test the deployed relay

The probe checks connectivity from the Worker to the upstream API without requiring the data.gov.in API key:

```bash
curl -H "X-Relay-Token: <your-relay-token>" \
  https://farmconnect-mandi-relay.manishn1877.workers.dev/probe
```

A healthy response should include:

- `"relay":"ok"`
- `"upstream_reachable":true`
- An `upstream_status` value such as `200`, `401`, or `403`

An upstream `401` or `403` during this keyless probe can still mean the upstream host was reached; the probe is testing reachability, not validating the private API key.

Then test the complete workflow:

1. Open the repository's **Actions** tab.
2. Select **Update daily mandi prices**.
3. Choose the `main` branch in **Run workflow**.
4. Start the run and check that preflight, price fetching, and commit steps complete.

## Scheduled updates

The workflow is configured for two daily runs:

- 11:10 AM IST (`05:40 UTC`)
- 7:10 PM IST (`13:40 UTC`)

GitHub Actions schedules are best-effort and may start later than the exact cron minute. Manual runs are available from the Actions tab.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Relay returns HTTP 401 | `FC_RELAY_TOKEN` in GitHub must match the Worker's `RELAY_TOKEN`. |
| Relay URL cannot be reached | Check `FC_RELAY_URL`, Worker deployment status, and Cloudflare dashboard. |
| Worker probe says upstream is unreachable | Check Cloudflare egress/placement and the current data.gov.in availability. |
| Upstream returns 401/403 during a full fetch | Verify `DATA_GOV_API_KEY` is valid and authorized for the resource. |
| Workflow succeeds but reports no price changes | The source may not have published newer records yet; inspect the fetched data date. |
| Workflow fails during price validation | Inspect the Action logs; do not manually replace the stored JSON with an empty or partial response. |

## Deploy or update the Worker

Only redeploy when `worker.js` or `wrangler.toml` has intentionally changed, or when recreating the deployment:

```bash
cd relay
npx wrangler login
npx wrangler deploy
```

After deployment, confirm the Worker URL and run the probe. Keep the existing URL and GitHub secret values aligned. Never paste secrets into a GitHub issue or pull request.

## Security notes

- The Worker requires `X-Relay-Token`.
- The upstream host and resource are fixed in the Worker implementation.
- Only explicitly supported query parameters should be forwarded.
- The data.gov.in key is forwarded over HTTPS and must not be logged or echoed.
- Rotate the relay token if it is exposed, then update both the Cloudflare Worker secret and GitHub's `FC_RELAY_TOKEN` secret.
