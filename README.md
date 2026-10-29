# Sotra Signals

Sotra Signals is a private Telegram bot for paper-testing rule-based market alerts. It fetches Twelve Data candles and sends analysis to one configured Telegram chat. It never places orders, and the strategy is a mechanical approximation rather than a validated or profitable trading system.

## Requirements

- Node.js 18 or newer
- A Telegram bot token and the numeric owner chat ID
- A Twelve Data API key with access to the chosen symbols and intervals

## Setup

1. Install packages with `npm install`.
2. Copy `.env.example` to `.env` and set `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, and `TWELVE_DATA_API_KEY`.
3. Check types with `npm run typecheck` and run tests with `npm test`.
4. Start locally with `npm run dev`, or build and run with `npm run build` followed by `npm start`.

The local state file defaults to `data/state.json`; it is created automatically and excluded from version control. Set `STATE_FILE` to change its location. Keep `.env` private.

## Deploy to Vercel with cron-job.org

The long-polling `npm run dev` process is for local development. Vercel uses serverless functions, so the deployed bot receives Telegram updates through a webhook and stores state in Upstash Redis.

1. Create a Vercel project from this repository and connect an Upstash Redis database. Add these environment variables to Vercel: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TWELVE_DATA_API_KEY`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, and `CRON_SECRET`. Generate separate random values for each secret; the Telegram webhook secret must use only letters, numbers, `_`, or `-`.
2. Deploy the project.
3. Configure the Telegram webhook with `npm run webhook:set -- https://your-project.vercel.app`. Provide `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET` in the shell or a local, uncommitted `.env` file.
4. In cron-job.org, create two `GET` jobs:
   - Normal signal scan: `https://your-project.vercel.app/api/signal-cron`, every 30 minutes.
   - Morning market report: `https://your-project.vercel.app/api/cron`, daily at 09:00 in the `Africa/Lagos` timezone.

   Add this custom HTTP header to both jobs (replace the placeholder with the exact secret value):

   ```text
   Authorization: Bearer <CRON_SECRET>
   ```

   Set `CRON_SECRET` in the Vercel **Production** environment and redeploy after adding or changing it. The cron-job.org header value must match exactly; do not include quotes or put the secret in the URL. Set the morning report job timezone to `Africa/Lagos` and its time to 09:00.

`/api/signal-cron` scans and sends new signals every 30 minutes; existing signal deduplication and pause behavior apply. `/api/cron` sends the morning report once daily at 09:00 Africa/Lagos for every configured symbol. It assesses 4H swing bias, 1H swing-trendline alignment and market-structure shift, an approximate 1H last-opposing-candle zone, and an aligned 5M liquidity-sweep/structure-confirmation setup. The report is not generated if scheduled alerts are paused. Add the same `CRON_SECRET` Authorization header to both jobs. A `GET` from a browser without the header should return `401` by design. `409` means another scan/report is active. Both endpoints return `200` after completing their work, including when some symbols could not be fetched.

At 09:00 Africa/Lagos, `/api/cron` sends a Telegram report for every configured symbol. It assesses 4H swing bias, 1H swing-trendline alignment and market-structure shift, an approximate 1H last-opposing-candle zone, and an aligned 5M liquidity-sweep/structure-confirmation setup. This report is not generated if scheduled alerts are paused. `401` means the request is missing the correct Bearer secret; confirm the production `CRON_SECRET` in Vercel and the cron-job.org `Authorization` header both match exactly. A `GET` from a browser without the header should return `401` by design. `409` means another scan/report is active. The endpoint returns `200` after successfully sending the report, including when some symbols could not be fetched.

The Vercel root URL serves the informational page from `public/`. The Next.js dashboard is a separate project in `../sotra_dashboard/`; deploy it as its own Vercel project and enable Vercel Deployment Protection for the dashboard deployment. Set `DASHBOARD_API_SECRET` on the bot project and the same value as `SOTRA_DASHBOARD_API_SECRET` on the dashboard project. Generate this as a separate random secret; do not reuse `CRON_SECRET` or `TELEGRAM_WEBHOOK_SECRET`. Set `SOTRA_API_URL` on the dashboard project to the bot deployment origin (for example, `https://your-sotra-bot.vercel.app`, with no API path). The dashboard server proxies requests to dedicated `/api/dashboard/*` bot endpoints; the shared secret stays server-side and is never sent to the browser. The status endpoint returns configured markets, settings, pause state, and the latest signal. The pause and manual-scan endpoints reuse the existing state repository and scanner; a manual scan sends Telegram alerts only when scheduled alerts are active. Dashboard API requests are not cron requests and do not use `CRON_SECRET`.

Vercel functions do not use local JSON state. Pause state, latest signal, deduplication keys, and cross-invocation scan locks are stored in Upstash. Preview and production deployments use separate key prefixes by default; `UPSTASH_STATE_PREFIX` can override the prefix. Vercel deployments enforce `STATE_BACKEND=upstash`; local development uses `data/state.json` unless `STATE_BACKEND=upstash` is set. `SCAN_INTERVAL_MS` applies to local polling mode; configure the cron-job.org signal job to the same cadence for Vercel. Do not run local long polling with the production bot token while the webhook is active; Telegram only allows one update-delivery mode for a bot at a time.

## MVC structure

- **Models** (`src/models/`) define domain types and persist pause state, detected signals, and delivery keys.
- **Views** (`src/views/`) format Telegram status, commands, scan reports, and signal alerts.
- **Controllers** (`src/controllers/`) authorize Telegram commands and coordinate model/service calls.
- **Services** (`src/services/`) fetch, analyze, and schedule market scans and morning reports.
- **Application composition** (`src/app.ts`) wires dependencies and process lifecycle; `src/index.ts` is the entry point.

## Configuration

| Variable | Default | Description |
|---|---:|---|
| `TELEGRAM_BOT_TOKEN` | Required | Bot token from BotFather |
| `TELEGRAM_CHAT_ID` | Required | Only authorized Telegram chat ID |
| `TWELVE_DATA_API_KEY` | Required | Twelve Data API key |
| `SYMBOLS` | `XAU/USD,EUR/USD,GBP/USD` | Comma-separated Twelve Data symbols |
| `INTERVAL` | `5min` | Candle interval for local scans and `/scan` |
| `SCAN_INTERVAL_MS` | `1800000` | Delay between scheduled scans in local polling mode (30 minutes by default); configure the Vercel signal cron to the same cadence |
| `MIN_REWARD_RISK` | `3` | Planned reward-to-risk target |
| `SWING_LOOKBACK` | `10` | Prior candles used for the liquidity extreme |
| `STRUCTURE_LOOKBACK` | `5` | Candles before a sweep used to establish structure |
| `MAX_BARS_SINCE_SWEEP` | `3` | Maximum completed candles between a liquidity sweep and confirmation |
| `ATR_PERIOD` | `14` | Candles used to calculate average true range |
| `MAX_RISK_ATR_MULTIPLE` | `2` | Maximum stop distance as a multiple of ATR |
| `MAX_CANDLE_AGE_MINUTES` | `20` | Maximum age allowed for the latest completed candle |
| `MAX_STORED_SIGNAL_KEYS` | `1000` | Maximum retained delivery-deduplication keys |
| `STATE_FILE` | `data/state.json` | Optional local state-file path |
| `CRON_SECRET` | Required on Vercel | Shared secret for cron-job.org requests to `/api/cron` and `/api/signal-cron` |
| `DASHBOARD_API_SECRET` | Required for dashboard | Separate bearer secret authorizing the dashboard server to call `/api/dashboard/*` |

## Commands

- `/start` explains the bot and available commands.
- `/status` reports the watchlist, interval, schedule, reward-to-risk threshold, and alert state.
- `/markets` lists configured symbols.
- `/scan` analyzes configured markets immediately and publishes new signals when alerts are active. While paused, it reports results but does not publish alerts.
- `/last` displays the latest detected setup.
- `/pause` and `/resume` persist the scheduled-alert setting.

All commands are restricted to `TELEGRAM_CHAT_ID`. Unauthorized chats receive only a private-bot notice.

## Morning report rules and limitations

- **4H bias:** bullish when the latest two confirmed swing highs and lows are both higher; bearish when both are lower; otherwise neutral.
- **1H setup:** checks whether swing lows rise for a bullish bias or swing highs fall for a bearish bias, then requires the latest completed 1H close to break the latest confirmed swing level in the bias direction.
- **1H order block:** marks the range of the last opposing candle before the 1H break. This is a simple approximation, not a full discretionary order-block model.
- **5M entry:** requires the existing liquidity-sweep and structure-confirmation rules to produce a signal aligned with the 4H bias and confirmed 1H setup. If those conditions are absent, the report says to wait rather than inventing an entry.
- The newest candle that has not closed is excluded. Stale timeframe data is reported and does not qualify as a fresh entry.

Alerts are analysis only. Check broker prices, spread, slippage, commissions, and risk independently. Do not treat a planned reward-to-risk ratio as an achieved result or assume profitability. Validate strategy behavior with historical out-of-sample data and paper trading before considering any real-world use. Local JSON state is for one process only; use a database with atomic uniqueness constraints before running multiple instances.
# sotra
