# Mandi price relay (Cloudflare Worker)

## Why this is needed
`api.data.gov.in` (IP 164.100.61.198) refuses connections from GitHub-hosted runners. This was
measured on ubuntu, ubuntu-arm, windows and macos runners: TCP "connection refused" (or timeout on
Windows) in under 300 ms, while example.com, workers.dev and script.google.com were reachable from
the same runners. It is a network-level block, not an API key, request-format or Python problem.
So the fetch has to leave from an address data.gov.in accepts. This Worker is that address.

## One-time setup (about 10 minutes, free plan is enough)
1. Create a free Cloudflare account at https://dash.cloudflare.com/sign-up
2. On any computer with Node 18+ (only needed this once):
   ```
   cd relay
   npx wrangler login
   npx wrangler deploy
   ```
   Wrangler prints your URL, e.g. `https://farmconnect-mandi-relay.<your-subdomain>.workers.dev`
3. Make a long random token and store it as a Worker secret:
   ```
   openssl rand -hex 32                 # copy the output
   npx wrangler secret put RELAY_TOKEN  # paste it when asked
   ```
4. Add two GitHub secrets (repo -> Settings -> Secrets and variables -> Actions):
   - `FC_RELAY_URL`   = the workers.dev URL from step 2 (no trailing slash)
   - `FC_RELAY_TOKEN` = the same token from step 3
   `DATA_GOV_API_KEY` stays as it is.
5. Test it BEFORE trusting it (does not use your API key):
   ```
   curl -H "X-Relay-Token: <token>" https://<your-worker>.workers.dev/probe
   ```
   Expected: `"upstream_reachable":true` and an `upstream_status` such as 401/403/200.
   If it says `"upstream_reachable":false`, see "If the probe fails" below.
6. GitHub -> Actions -> "Update daily mandi prices" -> Run workflow.

## Expected successful log
```
Preflight - can this runner reach the price source?
  Route: relay
  Relay answer: {"relay":"ok","colo":"BOM","upstream_reachable":true,"upstream_status":403,...}
Fetch official mandi prices
  Route: relay (Cloudflare Worker)
  Fetching latest rows for Karnataka
  Got 471 rows from 25 districts
  Wrote board.json: 68 rows, 3 markets
  Wrote data/prices.json: 41 commodities, latest data date 2026-11-27
Commit updated prices
  [main abc1234] Update mandi prices
```

## If the probe fails (`upstream_reachable:false`)
The Worker's egress address is also not accepted by data.gov.in. In order of effort:
- Confirm `placement.region` in `wrangler.toml` took effect: the probe's `colo` should be an Indian
  Cloudflare city (BOM, MAA, DEL, BLR...). Redeploy after any change.
- Google Apps Script relay (same contract, different egress): not tested, Google egress is US-based
  and may be blocked the same way.
- A tiny always-on VM in India (for example AWS ap-south-1 or Oracle Cloud Mumbai free tier) running
  the same fetch script from cron, pushing to the repo with a deploy key. Most reliable, not free of upkeep.

## Safety properties
- Not an open proxy: fixed upstream URL, only 5 allow-listed query parameters, limit capped at 1000.
- Requires `X-Relay-Token` (constant-time compare). The data.gov.in key travels in `X-Api-Key` over
  HTTPS, is used for the single upstream call, and is never logged or echoed.
- A failed fetch never changes `data/prices.json` or `data/board.json`. The job turns red only if the
  stored prices are more than 3 days old (`FC_STALE_DAYS`).
