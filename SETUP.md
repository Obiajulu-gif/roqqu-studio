# Setup: keys and deployment

Roqqu Studio runs with **zero keys**. Every key below only unlocks a live feature.

## What works with no keys

| Feature | Keyless behaviour |
|---|---|
| Templates, canvas, analyzer, Apply-Fix, code tab | Full |
| Chat (Rooky) | Classifies your request and proposes a template ("Set this up") |
| Chat: compose a new flow from free text | Needs an AI key (returns "composing flows needs an AI provider key") |
| Run | Practice mode (simulated, the default) |
| Shop link, invoice, dashboard pages | Render fully |
| Pay button on shop/invoice | Needs a RAS test key (`RAS_TEST_KEY`); returns a clear 502 until then |
| Email / WhatsApp notifications | Recorded only, not sent |
| Roqqu rates card on the dashboard | Works without keys (Roqqu's `/prices` is public); shows "unavailable" if Roqqu is unreachable |

## Keys

Copy `.env.example` to `.env` in the repo root and fill in what you need.

### 1. AI (makes Chat compose flows)

Pick one. Set `AI_PROVIDER` to match.

| Provider | Cost | How to get the key | Env |
|---|---|---|---|
| **NVIDIA NIM** | Free credits on signup | 1. Go to https://build.nvidia.com and sign in. 2. Open any model, e.g. `meta/llama-3.3-70b-instruct`. 3. Click **Get API Key**, then copy the `nvapi-...` value. | `AI_PROVIDER=nvidia`, `NVIDIA_API_KEY=nvapi-...` (optional `NVIDIA_MODEL`) |
| **Google Gemini** | Free tier | 1. Go to https://aistudio.google.com/app/apikey. 2. Click **Create API key**. | `AI_PROVIDER=google`, `GOOGLE_API_KEY=...` |
| Anthropic | Paid | https://console.anthropic.com, then **API Keys** | `AI_PROVIDER=anthropic`, `ANTHROPIC_API_KEY=...` |
| OpenAI | Paid | https://platform.openai.com/api-keys | `AI_PROVIDER=openai`, `OPENAI_API_KEY=...` |

If the first provider fails, the API falls through to the next one that has a key, then to keyword mode.

### 2. Roqqu (makes Pay and live Run work)

The integration follows the Roqqu API Service docs at https://roqqu-api-services.gitbook.io/ras (base URL `https://service.roqqu.com/v1`).

RAS has a **test mode**: a test key calls the real API without moving real money. Start there.

1. Sign up for the RAS console and finish merchant verification.
2. Open **Settings → API Keys and Webhooks**. Generate a **test** key and put it in `RAS_TEST_KEY`. It is sent as `x-staging-api-key`.
3. On the same page, set the webhook URL to `https://<web-domain>/api/ras/webhook`. RAS encrypts every webhook body with your API key, so there is no separate webhook secret.
4. Optional settings:
   - `ROQQU_PAY_TOKEN`: what buyers pay with on the studio's deposit page: `usdt_trc20` (default), `usdt_bep20` or `btc`.
   - `ROQQU_NGN_PER_USD`: fallback NGN rate, used only if RAS `GET /rates` is unreachable.
   - `RAS_MODE`: force `practice`, `test` or `live`. Blank picks test when a test key is set.
5. Going live: put your **live** key in `RAS_LIVE_KEY` (sent as `x-api-key`), remove `RAS_TEST_KEY`, and set `ALLOW_PRODUCTION_EXECUTION=true`. Live calls are refused without it.

How a payment works:
1. The buyer clicks Pay.
2. Studio creates a Roqqu payment link (or a deposit address) priced in naira at Roqqu's live `/rates`.
3. The buyer pays in BTC, USDT (TRC20) or USDT (BEP20), from MetaMask or by scanning the address.
4. RAS sends an encrypted webhook. Studio decrypts it with your key (anything that does not decrypt is rejected), then reads Get Addresses and marks the order paid only if what landed covers the total.

RAS facts to respect:
- POST bodies are form fields; nested objects (customer, wallets) travel as JSON strings.
- Send fees come out of the token you send. A send returns a `refid` at once; the `token_sent` webhook confirms it on-chain.
- Buy, sell and swap emit no webhook: confirm them with balances or history.
- Payment links expire after 2 hours unless you set `expires_at`.

### 3. Notifications (optional)

- **Email:** use ZeptoMail (https://zeptomail.zoho.com, free tier). Set `ZEPTOMAIL_API_KEY` (the full `Zoho-enczapikey ...` value), `ZEPTOMAIL_SENDER` and `ZEPTOMAIL_REPLY_TO`.
- **WhatsApp:** use a self-hosted Evolution API (https://github.com/EvolutionAPI/evolution-api). Set `EVOLUTION_API_URL`, `EVOLUTION_API_KEY` and `EVOLUTION_INSTANCE`.

## Run locally

```bash
docker compose up        # http://localhost:3000, API docs at http://localhost:8010/docs
```

Without Docker, see the README. On Windows, 4 sandbox tests fail because `preexec_fn` is POSIX-only. Docker or WSL avoids this.

## Deploy (cheapest path)

The web app and the API are deployed as two services.

### API on Render (free tier, Docker)

1. Go to https://render.com and click **New**, then **Web Service**. Connect `Obiajulu-gif/roqqu-studio`.
2. Set **Root directory** to `apps/api` and **Runtime** to Docker.
3. Set these env vars:
   - `STUDIO_ENV=production`. This switches the session cookie to `SameSite=None; Secure`, which cross-site calls need.
   - `CORS_ORIGINS=https://<your-web-domain>`
   - `STUDIO_SEED_DEMO=1`
   - plus your AI, Roqqu and notification keys.
4. Deploy, then note the URL, e.g. `https://roqqu-studio-api.onrender.com`.

On the free tier the service sleeps when idle, and all data is in memory, so a restart wipes workflows and orders.

### Web on Vercel (free)

1. Go to https://vercel.com and click **Add New**, then **Project**. Import `Obiajulu-gif/roqqu-studio`.
2. Set **Root directory** to `apps/web`. Vercel detects Next.js.
3. Set `NEXT_PUBLIC_API_URL` to the Render API URL.
4. Deploy. Then put the Vercel domain into the API's `CORS_ORIGINS` and redeploy the API.

### Alternative: Google Cloud Run

`scripts/deploy-cloud-run.sh` and `.github/workflows/deploy.yml` deploy both services to Cloud Run. They need a GCP project, billing, and the repo secrets that `deploy.yml` reads.

### Roqqu webhook

Once deployed, register `https://<api-domain>/roqqu/webhook` as the webhook URL in your Roqqu dashboard. Payments are only marked paid after the API checks the webhook secret and re-reads Get Wallets.
