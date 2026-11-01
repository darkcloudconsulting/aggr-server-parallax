# Bars filled from the market-data store, and why the feed went silent: 2026-11-01

Executor: Claude (Opus 5.5), 2026-11-01 09:00–09:25 UTC, at the owner's direction ("repair what can be
repaired"). Found by the controller's data quality check (`infra/kafka/HEALTH_CHECK_2026-11-01.md` in
the controller repository). Evidence and the tools used: [`store-fill-20261101/`](store-fill-20261101/).

## What was wrong

**Half-open sockets.** At 2026-10-30 15:09:44 UTC the Bitget, Bybit spot and Hyperliquid WebSockets
stopped delivering frames without closing. No disconnect was logged. The server noticed only when the
kernel reset each connection (`read ECONNRESET`): Bitget at 15:17:07, Bybit spot at 15:19:18 and
Hyperliquid at 15:21:15, a blackout of 7–11 minutes. Recovery then failed: `Bitget recent fills` /
`Bybit recent trades` / `Hyperliquid recent trades do not cover the full recovery interval`. The
activity monitor (`monitorExchangesActivity`, every 60 s) reconnects an API only after
`reconnectionThreshold` without a trade, and that is the upstream default of **1 hour for every market**
(`src/config.js`). The market-data Kafka publishers on the same venues cut their sockets after 60 s with
no frame, and each runs as a pair, so the store lost only Hyperliquid 10-30 15:09–15:11.

**The same cause, over the whole store period.** From 2026-10-14 to 2026-11-01, aggr held fewer trades
than the store in 840 minutes across 24 markets: **607,624 trades**, about 1 % of Bitget linear and
spot, 0.2–0.4 % of Bybit and Hyperliquid, and less elsewhere ([`short-before.json`](store-fill-20261101/short-before.json)).
The journal's 483 `recovery_failed` / `recovery_pending` markers since 10-16 describe the same blackouts.

## What was filled

From store copy 205's raw trades (`md.trades`, which carry venue trade ids, REST repairs and daily-file
fills), 10-second bars for those 840 minutes ([`fill.sql`](store-fill-20261101/fill.sql)), with
OHLC by event time and trade id, `cbuy`/`csell` taker counts, and `vbuy`/`vsell` = Σ price × base quantity.
These are aggr's own definitions (DATA_CATALOG.md).

- **Markets:** Bitget linear and spot, Bybit linear and spot, Hyperliquid, Binance spot, Coinbase and
  Kraken spot (BTC, ETH, SOL each). Only markets whose daily trade counts and volume agree with the store
  to within 0.5 % on ordinary days are included. Excluded: OKX (aggr counts fills differently; its volume
  agrees and it had no missing bars), Binance futures (different count basis), and Kraken futures
  (volume units differ by about 10⁵).
- **Rule:** write a bucket only where the store holds more trades than aggr. In all 5,004 buckets the store
  held at least as many as aggr; 1,824 were equal and left alone. In all 574 partial aggr bars, aggr's
  high and low were inside the store bar's range. **3,180 bars written** to `aggr_10s.trades_10s`
  ([`plan.py`](store-fill-20261101/plan.py), [`fill.lp`](store-fill-20261101/fill.lp)). Writing merges
  fields, so `lbuy`/`lsell` (liquidations) were kept.
- **Cascade:** [`scripts/resample-ranges.js`](../scripts/resample-ranges.js), the server's own `resample()`,
  rebuilt 30s → 1d for the 368 affected per-market ranges ([`ranges.json`](store-fill-20261101/ranges.json)).
- **Rollback:** [`preimage-aggr-10s.json`](store-fill-20261101/preimage-aggr-10s.json) holds every replaced bar (`null` where
  there was none). Rewrite those points and re-run the cascade over the same ranges.

**Result** ([`detect-after.txt`](store-fill-20261101/detect-after.txt)): 0 short minutes in every filled market. aggr/store
over 10-14 → 11-01 is now 0.99997–1.00002 (was 0.9901–0.9999). BITGET:BTCUSDT 10-15 → 11-01: 12,943,445
trades in the 1m, 1h and 1d bars alike.

**Not filled:** Hyperliquid 10-30 15:09–15:11 (1,070 trades), which neither the store nor any other source holds
(Hyperliquid serves no trade history); Bybit and Bitget inverse contracts, which the store does not carry;
KuCoin, Bitstamp, Bitfinex, Crypto.com, OKX inverse; anything before 10-14. **The journal's `unresolved`
markers were not cleared.** The journal is the live server's SQLite and has no endpoint for it; they now
over-report the gaps in the filled markets.

## The fix for the cause: proposed, not applied

`reconnectionThreshold` takes a formula of the market's own trade rate (`connection.avg`, trades a
minute). Proposed:

```
RECONNECTION_THRESHOLD='Math.min(3600000, Math.max(120000, 7200000 / Math.max(connection.avg, 0.5)))'
```

That is, silence of 120 expected trades, at least 2 minutes and at most the current hour. Replayed over
the last 24 h of 10s bars for all 66 markets ([`threshold-sim.txt`](store-fill-20261101/threshold-sim.txt)):
about 4 reconnects a day, mostly in bursty inverse contracts, against 106 for a 30-trade/60 s rule. BTC on
Bitget, Bybit spot and Hyperliquid would be detected after 2 minutes plus up to one 60 s monitor tick,
instead of 7–11 minutes. A reconnect resets every market on that socket and triggers a short REST
recovery; Binance futures recovery is already budgeted against the shared IP weight.

It needs no image: `src/config.js` maps the env var onto `reconnectionThreshold` (the image runs with
`RUNNING_IN_DOCKER`; `INFLUX_HOST` uses the same path). **Applying it restarts the collector pod**, which
the owner approves first (controller rule: collector changes lose live data). Apply:

```
kubectl -n ai-bot-feeder set env deploy/aggr-server-parallax-201 \
  RECONNECTION_THRESHOLD='Math.min(3600000, Math.max(120000, 7200000 / Math.max(connection.avg, 0.5)))'
```

Then record it in `deploy/node201.yaml`, and check the log for `overriding 'reconnectionThreshold'` and,
on the next silence, `reconnection threshold reached` instead of a late ECONNRESET.
