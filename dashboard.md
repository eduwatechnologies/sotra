# Sotra Signals Dashboard Plan

## Purpose

Build a private web dashboard for the existing single-owner Sotra Signals service. The UI is a separate Next.js project in `../sotra_dashboard/`; the Sotra bot remains the source of truth for configuration, state, and scanning. This does not change the Telegram workflow or authorize trading actions.

The selected first connection includes live status/latest signal plus pause/resume and manual scan controls. Authentication is through Vercel Deployment Protection for the dashboard and a separate shared server-to-server `DASHBOARD_API_SECRET` for dashboard API calls.

## Goals

- Give the owner a quick view of alert status, configured markets, and the latest detected signal.
- Provide a usable mobile and desktop interface.
- Keep dashboard access private and preserve the existing Telegram workflow.
- Make dashboard data and actions use the same application state and scan behavior as Telegram and scheduled jobs.

## Out of Scope

- Broker connections, order placement, or trade management.
- Public registration, multiple user accounts, or billing.
- A performance dashboard, win-rate claims, or backtesting results.
- Live prices or charts unless an explicit market-data refresh and display requirement is approved.

## Proposed MVP

### Overview

- Show whether scheduled alerts are active or paused.
- Show configured symbols, scan interval, and planned reward-to-risk setting.
- Show the latest detected signal, including symbol, direction, entry, stop loss, take profit, planned R:R, rationale, and timestamp.
- Clearly show when no signal has been detected.
- Show loading, stale/unavailable data, and request errors distinctly; do not present missing values as valid market data.

### Owner controls

- Pause and resume scheduled alerts.
- Request a manual scan and show per-symbol results, including errors and whether alerts were delivered.
- Require confirmation for state-changing controls and reflect the persisted result in the UI.
- Explain that scanning and alerting are analysis-only and do not place trades.

### Signal history

The current state repository retains only the latest signal and sent-signal deduplication keys; it does not provide a signal history. Keep history out of the first MVP unless the owner approves retaining additional signal records. If approved, define retention, storage limits, and migration behavior before implementation.

## Proposed Architecture

- Deploy the Next.js dashboard as a separate Vercel project and protect its production and preview deployments with Vercel Deployment Protection.
- Add dedicated authenticated dashboard API routes to the existing Sotra Vercel deployment for reading status/latest signal, changing pause state, and requesting a scan.
- Use same-origin Next.js route handlers as a server-side proxy; keep the dashboard API secret out of browser code.
- Reuse `ApplicationRuntime`, `StateRepository`, and `SignalScanner`; do not duplicate strategy or state logic in the browser.
- Return stable, minimal JSON response shapes and explicit HTTP errors. Do not expose environment variables, provider credentials, raw exceptions, or internal state keys.
- Keep cron endpoints dedicated to cron-job.org. Dashboard requests must not use the cron authorization secret.
- Keep dashboard UI separate from Telegram formatting and treat displayed market levels as informational, not execution instructions.

## Access Control and Safety

- Protect both the dashboard page and every dashboard API route; hiding controls in the UI is not authorization.
- Restrict dashboard access through Vercel Deployment Protection. The Sotra API additionally requires the shared dashboard-only bearer secret.
- Use a separate dashboard authentication mechanism from `CRON_SECRET` and `TELEGRAM_WEBHOOK_SECRET`.
- Do not put credentials in query strings, browser source code, or client-side persistent storage.
- Validate request methods and inputs, use same-origin requests, and protect state-changing requests against cross-site request forgery where applicable.
- Avoid logging authorization material or secrets; return generic authentication errors.
- Keep manual scanning subject to the existing scan lock, pause behavior, deduplication, and provider error handling.

## Implementation Phases

1. **Implement and configure the API boundary**
   - Define response and error shapes for status, latest signal, pause/resume, and manual scan.
   - Specify authorization checks, request protections, and scan-conflict behavior.
   - Keep cron and Telegram routes unchanged.
2. **Implement and test dashboard endpoints**
   - Reuse the current runtime and state/scanner interfaces.
   - Add tests for authorized and unauthorized requests, state changes, scan conflicts, provider failures, and response shapes.
3. **Connect the dashboard UI**
   - Implement responsive overview, latest-signal, and watchlist views.
   - Add pause/resume and manual-scan controls after protected endpoints are in place.
   - Include accessible labels, keyboard support, clear confirmations, and error/loading/empty states.
4. **Validate deployment and document operation**
   - Run type-check, tests, and production build.
   - Verify access control and behavior on a deployed preview without exposing real secrets.
   - Document required environment configuration, deployment steps, and recovery behavior.

## Acceptance Criteria

- Unauthenticated visitors cannot read dashboard data or invoke dashboard actions.
- Authorized owner can view alert state, configured markets, strategy settings, and the latest signal.
- Pause/resume changes are persisted through the shared state repository and remain consistent with Telegram commands and scheduled jobs.
- A manual scan uses the existing scanner, respects the shared scan lock and pause state, and reports per-symbol outcomes without leaking internal errors.
- The UI works on mobile and desktop and clearly distinguishes empty, stale/unavailable, loading, and error states.
- No order execution, public account flow, or unsupported performance claims are introduced.

## Deferred

- Signal history remains out of scope until retention, storage limits, and migration behavior are approved.
- Charts remain illustrative; no live quote or candle-history API is exposed by the bot.
- Local dashboard development can use a trusted local server and server-side environment variables; production access must remain protected.
