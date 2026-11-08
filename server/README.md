# FarmConnect: website + server in one

Zero dependencies. Node 22.5 or newer. Data is one SQLite file. The server serves the website, the API and the admin page, so there is nothing else to host.

## Try it on your computer
    cp .env.example .env     # then export the values (or set them in your shell)
    node --no-warnings seed.js           # loads 35 Bengaluru markets (add --demo for fake produce, test sites only)
    node --no-warnings server.js         # http://localhost:8787  (use INSECURE_COOKIE=1 for plain http)
    node --no-warnings test.js           # 46+ server checks, uses a simulated Razorpay

With no SMS provider, sign-up codes print in the server log. Admin page: `/admin` (ADMIN_PHONE + ADMIN_PASSWORD).

## Put it online (Render, about 20 minutes)
1. Push this folder to a private GitHub repo. In Render choose New > Blueprint; it reads `render.yaml`. Railway and Fly.io also work with the Dockerfile.
2. The database must live on a persistent disk (`/var/data`). The blueprint creates one. Turn on daily disk snapshots.
3. Fill in the environment values from `.env.example`. Use a long ADMIN_PASSWORD.
4. Point your domain at it. https is automatic on these hosts.

## Razorpay
1. Complete Razorpay KYC. Start with **test keys**; place a test order and pay with Razorpay's test card.
2. Webhook: Dashboard > Webhooks > `https://YOUR-DOMAIN/api/webhooks/razorpay`, events `payment.captured` and `payment.failed`, same secret as RAZORPAY_WEBHOOK_SECRET.
3. Switch to live keys only after a full test order, a refund and a failed payment all behave.
4. Money lands in your account. Paying farmers directly needs Razorpay Route, or a weekly payout you run yourself. Ask Razorpay about marketplace onboarding before taking live money.

## Phone codes (SMS)
In India, SMS needs DLT registration. MSG91 walks you through it: register your business and a template containing `##message##`, then set MSG91_AUTHKEY and MSG91_TEMPLATE_ID. Twilio also works. Until this is done, do not launch: sign-up and password reset depend on it.

## Running the marketplace
- **New sellers** appear in `/admin` > Sellers. They can list produce straight away but customers only see it after you approve. Check their FSSAI number there.
- **Remove** a listing or market, cancel an order (paid orders refund), and answer support tickets from `/admin`.
- **Orders** go from the customer to the farmer instantly. Farmers accept, mark ready or dispatched, and decline (online payments refund automatically).
- Unpaid online orders release their stock after 15 minutes.

## What the server guarantees
Prices come from the database, never from the browser. Stock is checked and reserved when an order is placed, so two people cannot take the last kilo. Razorpay signatures are verified; webhooks are de-duplicated and amount-checked. Passwords are hashed (PBKDF2). Sign-in, codes and requests are rate limited. A seller can only touch their own products, markets and orders.

## Before the first real customer
- [ ] SMS provider working, one real code received
- [ ] Razorpay test order, refund and failed payment all checked; then live keys
- [ ] Support phone, email, grievance officer and business address filled in
- [ ] Terms, privacy and refund pages read by a lawyer
- [ ] FSSAI (and GST if you cross the threshold) for you and your sellers
- [ ] Disk snapshots on; an uptime alert (UptimeRobot is free) on `/health`
