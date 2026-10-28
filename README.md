# Sotra Signals

Sotra Signals is a private Telegram bot for paper-testing rule-based market alerts. It fetches Twelve Data candles, checks for a preceding liquidity sweep followed by a completed-candle structure shift, and sends alerts to one configured Telegram chat. It never places orders, and the strategy is a mechanical approximation rather than a validated or profitable trading system.

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

## Deploy to Vercel

The long-polling `npm run dev` process is for local development. Vercel uses serverless functions, so the deployed bot receives Telegram updates through a webhook and stores state in Upstash Redis.

1. Create a Vercel project from this repository and connect an Upstash Redis database. Add these environment variables to Vercel: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TWELVE_DATA_API_KEY`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, and `CRON_SECRET`. Generate separate random values for the two secrets; the Telegram webhook secret must use only letters, numbers, `_`, or `-`.
2. Deploy the project. Vercel's Hobby plan supports one cron execution per day, so the included `vercel.json` scans daily at 09:00 UTC (Vercel Hobby can run it within that hour). Five-minute scans require a Vercel Pro plan; on Pro, change the cron schedule to `*/5 * * * *`.
3. Configure the Telegram webhook using your deployment URL: `npm run webhook:set -- https://your-project.vercel.app`. Provide `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET` in the shell or a local, uncommitted `.env` file. The script prints only the deployment host.
4. Verify the deployment at `/api/cron` only through Vercel Cron or an authorized request with `Authorization: Bearer <CRON_SECRET>`. Telegram posts to `/api/telegram`; its webhook secret is verified.

The Vercel root URL serves a small informational page from `public/`; this project has no web dashboard. The Vercel functions do not use local JSON state. Pause state, latest signal, deduplication keys, and cross-invocation scan locks are stored in Upstash. Preview and production deployments use separate key prefixes by default; `UPSTASH_STATE_PREFIX` can override the prefix. Vercel deployments enforce `STATE_BACKEND=upstash`; local development uses `data/state.json` unless `STATE_BACKEND=upstash` is set. `SCAN_INTERVAL_MS` applies to local polling mode; on Vercel, change the cron expression in `vercel.json` to adjust scheduled scans. Do not run local long polling with the production bot token while the webhook is active; Telegram only allows one update-delivery mode for a bot at a time.

## MVC structure

- **Models** (`src/models/`) define domain types and persist pause state, detected signals, and delivery keys.
- **Views** (`src/views/`) format Telegram status, commands, scan reports, and signal alerts.
- **Controllers** (`src/controllers/`) authorize Telegram commands and coordinate model/service calls.
- **Services** (`src/services/`) fetch, analyze, and schedule market scans.
- **Application composition** (`src/app.ts`) wires dependencies and process lifecycle; `src/index.ts` is the entry point.

## Configuration

| Variable | Default | Description |
|---|---:|---|
| `TELEGRAM_BOT_TOKEN` | Required | Bot token from BotFather |
| `TELEGRAM_CHAT_ID` | Required | Only authorized Telegram chat ID |
| `TWELVE_DATA_API_KEY` | Required | Twelve Data API key |
| `SYMBOLS` | `XAU/USD,EUR/USD,GBP/USD` | Comma-separated Twelve Data symbols |
| `INTERVAL` | `5min` | Candle interval, for example `5min` or `1h` |
| `SCAN_INTERVAL_MS` | `300000` | Delay between scheduled scans in local polling mode |
| `MIN_REWARD_RISK` | `2` | Planned reward-to-risk target |
| `SWING_LOOKBACK` | `10` | Prior candles used for the liquidity extreme |
| `STRUCTURE_LOOKBACK` | `5` | Candles before a sweep used to establish structure |
| `MAX_CANDLE_AGE_MINUTES` | `20` | Maximum age allowed for the latest completed candle |
| `MAX_STORED_SIGNAL_KEYS` | `1000` | Maximum retained delivery-deduplication keys |
| `STATE_FILE` | `data/state.json` | Optional local state-file path |

## Commands

- `/start` explains the bot and available commands.
- `/status` reports the watchlist, interval, schedule, reward-to-risk threshold, and alert state.
- `/markets` lists configured symbols.
- `/scan` analyzes markets immediately and publishes new signals when alerts are active. While paused, it reports results but does not publish alerts.
- `/last` displays the latest detected setup.
- `/pause` and `/resume` persist the scheduled-alert setting.

All commands are restricted to `TELEGRAM_CHAT_ID`. Unauthorized chats receive only a private-bot notice.

## Strategy behavior and limitations

The scanner sorts and validates OHLC data, excludes the newest candle as potentially incomplete, and rejects stale confirmation candles. A BUY requires a sweep below the preceding `SWING_LOOKBACK` low that closes back above it, followed by the latest completed candle closing above the `STRUCTURE_LOOKBACK`-candle structure high defined before the sweep. SELL setups use the mirrored high/low conditions. Entry is the confirmation close; the stop is the sweep extreme; target distance is the configured planned reward-to-risk multiple.

Alerts are analysis only. Check broker prices, spread, slippage, commissions, and risk independently. Do not treat a planned reward-to-risk ratio as an achieved result or assume profitability. Validate strategy behavior with historical out-of-sample data and paper trading before considering any real-world use. Local JSON state is for one process only; use a database with atomic uniqueness constraints before running multiple instances.
# sotra
