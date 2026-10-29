# Sotra Signals — Product Features and Requirements

## 1. Product Overview

**Product name:** Sotra Signals  
**Product type:** Personal Telegram trading signal bot  
**Markets:** Forex and gold (XAUUSD, EURUSD, GBPUSD by default)  
**Core stack:** Node.js, TypeScript, Telegraf, market-data API  
**Initial delivery:** Signal-only; no automatic order execution

Sotra Signals monitors configured markets, applies explicit SMC/ICT-inspired rules to completed OHLC candles, and sends a Telegram alert when a setup meets the configured conditions.

The system is an analysis and alerting tool, not a guarantee of profitable trades or financial advice.

## 2. Goals

- Monitor selected forex and gold symbols on a configurable schedule.
- Detect rule-based liquidity sweeps and market structure shifts.
- Produce clear, consistent alerts with entry, stop loss, take profit, and planned reward-to-risk ratio.
- Avoid alerts based on stale, malformed, or potentially incomplete candle data.
- Prevent duplicate alerts for the same symbol, direction, and signal candle.
- Give the owner simple Telegram commands to inspect status, scan markets, and pause/resume alerts.
- Support testing and future strategy improvements without coupling the strategy to Telegram messaging.

## 3. Out of Scope for the Initial Release

- Automatic broker order placement or trade management.
- Claims of guaranteed returns or a guaranteed win rate.
- Paid memberships, billing, or public multi-user access.
- Copy trading or account management.
- News sentiment, economic-calendar integration, or automated fundamental analysis.
- Full discretionary ICT interpretation, including subjective order blocks, fair-value gaps, premium/discount zones, and inducement.
- Web dashboard or mobile application.
- Position-size calculation without broker contract specifications, account currency, and an explicit risk budget.

## 4. Users and Access

### Personal owner

The configured Telegram user/chat is the only authorized user.

Requirements:
- Every bot command must verify the incoming chat ID against `TELEGRAM_CHAT_ID`.
- Unauthorized chats must not be able to scan markets, change settings, or control alerts.
- The bot must not expose credentials, API keys, internal exceptions, or sensitive configuration in Telegram responses.
- The Telegram token and market-data API key must be stored in environment variables, never committed to source control.

## 5. Functional Requirements

### 5.1 Market watchlist

- Configure symbols through `SYMBOLS`, using a comma-separated list.
- Initial defaults: `XAU/USD`, `EUR/USD`, `GBP/USD`.
- Configure candle interval through `INTERVAL`; initial default is `5min`.
- Fetch OHLC candle data from the configured provider.
- Validate numeric OHLC values and ensure high/low values are internally consistent.
- Sort candles chronologically regardless of provider response order.
- Check that the latest usable candle is recent enough before analyzing it.
- Handle unsupported symbols, API quota errors, timeouts, malformed responses, and provider outages without crashing the entire scan.
- Log detailed technical errors to the server console while keeping Telegram error messages concise.

### 5.2 Signal strategy engine

The strategy engine must be a standalone module that accepts candle data and returns either a valid signal or no signal.

#### Liquidity sweep — bullish candidate
- Identify the lowest low in a configurable preceding lookback window.
- A candidate sweep candle must trade below that low and close back above it.

#### Liquidity sweep — bearish candidate
- Identify the highest high in a configurable preceding lookback window.
- A candidate sweep candle must trade above that high and close back below it.

#### Market structure shift
- Define structure levels using a documented lookback window preceding the sweep.
- For a bullish candidate, require a subsequent completed candle to close above the predefined structure high.
- For a bearish candidate, require a subsequent completed candle to close below the predefined structure low.
- The latest usable completed candle must still confirm the required direction.
- If the sweep, shift, or confirmation is absent, return no signal.

#### Signal levels
- Entry: close of the latest completed confirmation candle.
- Bullish stop loss: below the sweep candle's low; include a configurable buffer in a future enhancement.
- Bearish stop loss: above the sweep candle's high; include a configurable buffer in a future enhancement.
- Take profit: calculated using the configured minimum planned reward-to-risk ratio.
- Reject zero or negative risk distance, invalid target placement, and invalid numeric levels.
- Include the signal candle timestamp in UTC.
- Describe the setup using the conditions actually detected; do not claim that unimplemented filters were checked.

**Important:** This is a mechanical approximation of selected SMC/ICT concepts. It is not a complete or validated ICT strategy. Strategy changes must be tested against historical data before being enabled in production.

### 5.3 Signal message

Each signal alert must include:
- Product name: Sotra Signals.
- Symbol.
- Direction: BUY or SELL.
- Entry price.
- Stop-loss price.
- Take-profit price.
- Planned reward-to-risk ratio.
- Short explanation of the detected setup.
- Signal candle timestamp in UTC.
- A reminder to verify broker price, spread, and risk before acting.

Formatting must be readable on mobile Telegram clients. Price precision should be configurable or derived from the instrument's actual tick size in a future release; fixed decimal formatting is only a prototype behavior.

### 5.4 Scheduled scanning

- Run an initial scan after successful bot startup.
- Repeat scans at `SCAN_INTERVAL_MS`; default is five minutes.
- Do not allow overlapping scans.
- Process each configured symbol independently so a failure on one symbol does not block all other symbols.
- Respect the provider's rate limits and subscription quotas.
- Do not publish signals from stale or invalid data.
- Scheduled alerts must stop while paused and resume when explicitly requested.

### 5.5 Duplicate prevention and persistence

- Define a signal identity key using symbol, direction, and signal-candle timestamp.
- Do not send the same signal key more than once.
- Persist sent keys and the latest detected signal across restarts.
- Persist pause/resume state across restarts.
- Limit retained signal keys to a configured maximum to avoid unbounded growth.
- The initial local JSON state file is suitable only for a single process. A database with atomic uniqueness constraints is required before running multiple instances.

### 5.6 Telegram commands

| Command | Requirement |
|---|---|
| `/start` | Explain the bot and available commands. |
| `/status` | Show online state, alert pause state, watchlist, candle interval, scan frequency, and configured reward-to-risk threshold. |
| `/markets` | List configured symbols. |
| `/scan` | Trigger an immediate scan and return a concise per-symbol result. |
| `/last` | Show the most recently detected signal, or explain that no signal exists yet. |
| `/pause` | Pause scheduled signal alerts and persist the setting. |
| `/resume` | Resume scheduled signal alerts and persist the setting. |

Manual scans while paused may analyze markets but must not publish scheduled signal alerts. This behavior must be made clear to the user.

### 5.7 Logging and operational visibility

- Log startup, shutdown, scan start/end, per-symbol failures, and Telegram handler errors.
- Never log tokens, API keys, or full secret-bearing request URLs.
- Use concise, actionable error messages.
- Provide enough diagnostic information to identify API quota failures, invalid symbols, stale data, and network errors.

## 6. Non-Functional Requirements

### Security
- Secrets are read from environment variables.
- `.env`, local state files, logs, and build output are excluded from version control where appropriate.
- Commands are restricted to the configured owner.
- Network requests have timeouts.
- No broker credentials are required in the initial release.

### Reliability
- A single symbol's data error must not terminate the process.
- A scan must be guarded against concurrent execution.
- State changes must be persisted.
- A failed Telegram send must be logged and must not be reported as successfully delivered.
- Production state persistence should use atomic writes or a database.

### Maintainability
- Keep market data, strategy, Telegram commands, configuration, and state management in separate modules.
- Use TypeScript strict mode.
- Keep strategy logic deterministic where possible so it can be tested without Telegram or network access.
- Document all strategy rules and configuration settings.

### Performance and API usage
- Use a configurable scan interval.
- Avoid unnecessary repeated API requests.
- Keep scan results concise.
- Respect provider quotas and backoff/retry guidance.

## 7. Configuration

| Variable | Purpose | Default |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Telegram bot token | Required |
| `TELEGRAM_CHAT_ID` | Authorized owner chat ID | Required |
| `TWELVE_DATA_API_KEY` | Market-data provider key | Required |
| `SYMBOLS` | Comma-separated market symbols | `XAU/USD,EUR/USD,GBP/USD` |
| `INTERVAL` | Candle interval | `5min` |
| `SCAN_INTERVAL_MS` | Scheduled scan frequency in milliseconds | `300000` |
| `MIN_REWARD_RISK` | Minimum planned reward-to-risk ratio | `3` |
| `SWING_LOOKBACK` | Candles used to identify prior liquidity highs/lows | `10` |
| `STRUCTURE_LOOKBACK` | Candles used to define structure levels | `5` |
| `MAX_BARS_SINCE_SWEEP` | Maximum completed candles between a liquidity sweep and confirmation | `3` |
| `ATR_PERIOD` | Candles used to calculate average true range | `14` |
| `MAX_RISK_ATR_MULTIPLE` | Maximum stop distance as a multiple of ATR | `2` |
| `MAX_CANDLE_AGE_MINUTES` | Maximum age of the latest usable candle | `20` |

The provider's symbol support, timestamp format, candle finalization behavior, and subscription limits must be verified against its current documentation.

## 8. Risk Controls and Limitations

- Signal-only mode; no orders are executed.
- No signal is a guarantee of future price movement.
- Signals must be checked against the user's broker feed before any trading decision.
- Spread, slippage, commissions, swaps, and broker-specific contract/tick specifications can materially change trade outcomes.
- No position sizing is provided in the initial release.
- No news or session filter is included in the initial release.
- A planned 3:1 reward-to-risk ratio is not the same as an achieved 3:1 result.
- Do not advertise a win rate until supported by reproducible, out-of-sample testing and transparent performance reporting.
- Backtests must avoid look-ahead bias and account for spread, slippage, commissions, and ambiguous candles that touch both stop and target.
- Paper trade before considering live use.

## 9. Testing Requirements

### Unit tests
- Insufficient candle history returns no signal.
- Stale candles return no signal.
- Invalid OHLC data is rejected by the market-data adapter.
- Monotonic candles without a sweep do not generate a signal.
- A bullish sweep without a bullish structure shift does not generate a BUY signal.
- A bearish sweep without a bearish structure shift does not generate a SELL signal.
- Valid bullish and bearish fixtures generate correctly placed entry, stop-loss, and take-profit levels.
- Risk distance must be positive.
- Reward-to-risk calculation matches the configured threshold.
- Candle ordering does not affect analysis results.
- Forming/latest candle is excluded from signal calculations.
- The same signal key is deduplicated across restarts.

### Integration tests
- Bot starts with valid configuration and fails clearly when required variables are missing.
- Authorized owner can use commands.
- Unauthorized chat cannot control the bot.
- API timeout, quota error, unsupported symbol, and malformed response are handled gracefully.
- Telegram delivery failures are logged.
- Pause/resume state survives restart.
- Scans do not overlap.

### Strategy validation
- Backtest on multiple market conditions and time periods.
- Use out-of-sample data not used to tune strategy parameters.
- Report trade count, win rate, average win/loss, expectancy, maximum drawdown, and profit factor.
- Include spread, commissions, and slippage assumptions.
- Compare signal prices with the intended broker's prices.
- Run in demo/paper mode before live use.

## 10. Acceptance Criteria for Version 1

Version 1 is ready for personal paper testing when:
- [ ] The owner can start the bot and use every documented command.
- [ ] Unauthorized users cannot control the bot.
- [ ] Market data is validated and stale candles are rejected.
- [ ] Signals are generated only when the defined sweep and structure conditions are met.
- [ ] Each alert includes symbol, direction, entry, stop, target, planned R:R, rationale, and UTC timestamp.
- [ ] Duplicate alerts are suppressed across restarts.
- [ ] Pause/resume state is persistent.
- [ ] API and Telegram errors do not crash the service.
- [ ] Unit and integration tests pass.
- [ ] Backtesting and paper-trading limitations are documented.
- [ ] No live order execution is possible in this version.

## 11. Suggested Future Roadmap

### V1.1 — Strategy quality
- Add configurable London/New York session windows.
- Add higher-timeframe bias.
- Add explicit confirmation rules and optional entry buffers.
- Add broker-aware symbol precision and spread filters.
- Add a historical backtesting runner.

### V1.2 — Signal lifecycle
- Track each alert until stop, target, expiry, or manual cancellation.
- Handle candles that hit both stop and target conservatively.
- Generate daily and weekly performance summaries.
- Store signals and outcomes in SQLite or PostgreSQL.

### V1.3 — Operational maturity
- Add retries with bounded exponential backoff.
- Add health checks and uptime monitoring.
- Move secrets to a managed secret store for hosted deployments.
- Add database-backed deduplication and multi-instance safety.

### V2 — Optional integrations
- Add an economic calendar/news blackout filter.
- Add chart snapshots and richer Telegram messages.
- Add an optional dashboard.
- Consider broker integration only as a separate, explicitly enabled project with demo testing, strict position/risk limits, and emergency stop controls.

## 12. Definition of Done

The first release is complete when the bot reliably scans configured markets, identifies only the explicitly defined strategy setups, sends non-duplicated alerts to the authorized owner, handles data/provider errors safely, passes automated tests, and is documented for demo/paper validation. Profitability is not assumed and must be evaluated independently.
