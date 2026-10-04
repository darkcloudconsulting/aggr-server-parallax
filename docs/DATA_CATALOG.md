# Parallax feed data catalog

This catalog describes the **new parallel feed**, not the existing snow or SOL
collectors. The configured database is `aggr_parallax` on InfluxDB 1.12.4.
Collection began on 4 October 2026 at about 20:22 AEDT (09:22 UTC); there is
no migration or backfill. The 24-hour release validation remains in progress;
see [release status](RELEASE_STATUS.md) before treating a market as certified.

## Grafana and query path

- Market-data Grafana: [Snowgraf](http://192.168.10.208:32161/), namespace `monitor`.
- Dedicated dashboard: [Aggr Parallax — BTC / ETH / SOL feed](http://192.168.10.208:32161/d/aggr-parallax-feed/aggr-parallax-e28094-btc-eth-sol-feed),
  in the **Aggr Parallax Feed** folder. Choose BTC, ETH, or SOL at the top.
- Data source: **Aggr Parallax (InfluxQL)**, UID `aggr-parallax-influxql`.
- InfluxDB service: `aggr-parallax-influx.ai-bot-feeder.svc.cluster.local:8086`.
- Database: `aggr_parallax`; query language: InfluxQL. Grafana's server proxies
  queries to the internal service. The data source is additive and is not the
  default Grafana source.
- The source is registered by [`deploy/grafana-datasource.py`](../deploy/grafana-datasource.py)
  from the versioned [definition](../deploy/grafana-datasource.json). Its live
  proxy was checked with a retention-policy query and a BTC one-minute bar.

Select a named retention policy in Explore or fully qualify measurements, for
example:

```sql
SELECT cbuy, csell, vbuy, vsell, open, high, low, close
FROM aggr_1m.trades_1m
WHERE market = 'BINANCE:btcusdt' AND time > now() - 1h
```

The `market` tag is the exact **venue ID:symbol** shown below. Symbols with
similar spelling on different venues, and spot versus contract products, are
different series. `XBT` is Kraken's or KuCoin's BTC symbol; it remains `XBT` in
the market ID.

## Collected markets

Each row lists three separate active market IDs, one each for BTC, ETH, and
SOL. Prefix each symbol with the venue ID and a colon; for example the first
row is `BINANCE:btcusdt`, `BINANCE:ethusdt`, and `BINANCE:solusdt`.

| Venue ID | Product and quote | BTC symbol | ETH symbol | SOL symbol |
| --- | --- | --- | --- | --- |
| `BINANCE` | Spot, USDT | `btcusdt` | `ethusdt` | `solusdt` |
| `BINANCE_FUTURES` | Linear perpetual, USDT | `btcusdt` | `ethusdt` | `solusdt` |
| `BINANCE_FUTURES` | Inverse perpetual, USD | `btcusd_perp` | `ethusd_perp` | `solusd_perp` |
| `COINBASE` | Spot, USD | `BTC-USD` | `ETH-USD` | `SOL-USD` |
| `KRAKEN` | Spot, USD | `XBT/USD` | `ETH/USD` | `SOL/USD` |
| `KRAKEN` | USD perpetual, quote-contract quantity | `PF_XBTUSD` | `PF_ETHUSD` | `PF_SOLUSD` |
| `OKEX` | Spot, USDT | `BTC-USDT` | `ETH-USDT` | `SOL-USDT` |
| `OKEX` | Linear swap, USDT | `BTC-USDT-SWAP` | `ETH-USDT-SWAP` | `SOL-USDT-SWAP` |
| `OKEX` | Inverse swap, USD | `BTC-USD-SWAP` | `ETH-USD-SWAP` | `SOL-USD-SWAP` |
| `BYBIT` | Spot, USDT | `BTCUSDT-SPOT` | `ETHUSDT-SPOT` | `SOLUSDT-SPOT` |
| `BYBIT` | Linear perpetual, USDT | `BTCUSDT` | `ETHUSDT` | `SOLUSDT` |
| `BYBIT` | Inverse perpetual, USD | `BTCUSD` | `ETHUSD` | `SOLUSD` |
| `BITGET` | Spot, USDT | `BTCUSDT-SPOT` | `ETHUSDT-SPOT` | `SOLUSDT-SPOT` |
| `BITGET` | Linear perpetual, USDT | `BTCUSDT` | `ETHUSDT` | `SOLUSDT` |
| `BITGET` | Inverse perpetual, USD | `BTCUSD` | `ETHUSD` | `SOLUSD` |
| `CRYPTOCOM` | Spot, USD | `BTC_USD` | `ETH_USD` | `SOL_USD` |
| `CRYPTOCOM` | USD perpetual, reported base quantity | `BTCUSD-PERP` | `ETHUSD-PERP` | `SOLUSD-PERP` |
| `BITFINEX` | Spot, USD | `BTCUSD` | `ETHUSD` | `SOLUSD` |
| `BITSTAMP` | Spot, USD | `btcusd` | `ethusd` | `solusd` |
| `KUCOIN` | Spot, USDT | `BTC-USDT` | `ETH-USDT` | `SOL-USDT` |
| `KUCOIN` | Linear perpetual, USDT | `XBTUSDTM` | `ETHUSDTM` | `SOLUSDTM` |
| `HYPERLIQUID` | Linear perpetual, USDT denominated; USDC collateral | `BTC` | `ETH` | `SOL` |

There are **66 configured markets** across 12 venue IDs. Deribit perpetuals,
Coinbase INTX perpetuals, Kraken `PI_XBTUSD`, BitMEX, HTX, and Poloniex are
excluded with reasons in [release status](RELEASE_STATUS.md). An idle but
subscribed market has no bar for an interval with no accepted executions;
absence of a bar alone does not prove an outage.

Hyperliquid's `BTC`, `ETH`, and `SOL` IDs are its primary perpetual contracts,
not spot tokens. Their trade sizes are base units and `vbuy`/`vsell` are
USDT-denominated price × base size. Collateral and PnL settlement use USDC.
HyperCore's similarly named `UBTC/USDC`, `UETH/USDC`, and `USOL/USDC` spot
products were excluded after the API reported zero 24-hour notional volume on
4 October 2026. Hyperliquid's `recentTrades` API provides only ten fills and
does not honor time-range parameters; reconnect intervals outside that ten-fill
window remain explicitly unresolved in feed health.

## Bars, fields, and retention

InfluxDB stores **bars**, not the individual execution journal. Every named
retention policy contains a measurement with the matching timeframe. The
measurement has the `market` tag and these fields:

| Field | Meaning |
| --- | --- |
| `open`, `high`, `low`, `close` | Execution price OHLC ordered by native event time and deterministic trade identity. |
| `cbuy`, `csell` | Taker-buy and taker-sell execution counts; a native aggregate contributes its underlying count when exposed. |
| `vbuy`, `vsell` | Taker-buy and taker-sell **quote notional**: execution price × normalized base quantity. The quote unit follows the product's USD, USDT, or USDC price denomination. |
| `lbuy`, `lsell` | Observed liquidation-stream quote notional where the venue provides events; absent fields mean none was written for that point. Exchange streams can be sampled or incomplete, so these fields are not a certified total of all liquidations. |

| Retention policy | Measurement | Interval | Retention |
| --- | --- | --- | --- |
| `aggr_10s` | `trades_10s` | 10 seconds | 7 days |
| `aggr_30s` | `trades_30s` | 30 seconds | 30 days |
| `aggr_1m` | `trades_1m` | 1 minute | 30 days |
| `aggr_3m` | `trades_3m` | 3 minutes | 90 days |
| `aggr_5m` | `trades_5m` | 5 minutes | 90 days |
| `aggr_15m` | `trades_15m` | 15 minutes | 90 days |
| `aggr_30m` | `trades_30m` | 30 minutes | 90 days |
| `aggr_1h` | `trades_1h` | 1 hour | 104 weeks (728 days) |
| `aggr_2h` | `trades_2h` | 2 hours | 104 weeks (728 days) |
| `aggr_4h` | `trades_4h` | 4 hours | 104 weeks (728 days) |
| `aggr_6h` | `trades_6h` | 6 hours | 104 weeks (728 days) |
| `aggr_1d` | `trades_1d` | 1 day | 104 weeks (728 days) |

InfluxDB also has its default `autogen` policy with unlimited duration. The
Parallax writer targets the named `aggr_*` policies, so fully qualify a policy
in ad hoc queries. The SQLite WAL execution journal is separately capped at
seven days and contains native trade ID, timestamp, quantity and unit,
normalized base quantity, price, side, source, and correction state. It is not
the Grafana bar database.

The service's `/health/feeds` endpoint reports each market's current
subscription state, last trade, recent interval quality, pending writes, and
unresolved gaps. `writer_settled` means Influx point and rollups were written;
the 24-hour independent exchange validation is a separate release gate.

## Open interest snapshots

The separate [`aggr-parallax-open-interest` CronJob](../deploy/open-interest.yaml)
samples BTC, ETH, and SOL every five minutes from these linear perpetual
markets:

| Venue | BTC market | ETH market | SOL market |
| --- | --- | --- | --- |
| Binance USDⓈ-M | `BINANCE_FUTURES:btcusdt` | `BINANCE_FUTURES:ethusdt` | `BINANCE_FUTURES:solusdt` |
| Bybit | `BYBIT:BTCUSDT` | `BYBIT:ETHUSDT` | `BYBIT:SOLUSDT` |
| OKX | `OKEX:BTC-USDT-SWAP` | `OKEX:ETH-USDT-SWAP` | `OKEX:SOL-USDT-SWAP` |
| Hyperliquid | `HYPERLIQUID:BTC` | `HYPERLIQUID:ETH` | `HYPERLIQUID:SOL` |

These are **12 snapshot series**, separate from
the 66 trade markets. Collection started on 4 October 2026 at about
23:25 AEDT (12:25 UTC); older open interest is not backfilled.

| Measurement in `aggr_5m` | Tags | Fields | Retention |
| --- | --- | --- | --- |
| `open_interest` | `asset`, `venue`, exact `market` | `base` (one-sided open contracts in base units), `notional_usd` (nominal USD equivalent), `mark_price`, `source_time_ms` | 90 days |
| `open_interest_total` | `asset` | `notional_usd` (sum of all four selected venues), `venues` (= 4) | 90 days |

Binance and Hyperliquid notional use base open interest × venue mark price;
Bybit supplies its **single-side** open-interest value and OKX supplies `oiUsd`.
Bybit's similarly named `openInterest` and `openInterestValue` count both
sides and are intentionally excluded from the total. The cross
venue total treats USDT- and USDC-denominated values as nominal USD equivalents
without an FX or stablecoin depeg adjustment. A total point is written only
when all four venue snapshots for that asset pass validation. It counts open
contracts once, rather than adding long and short sides. A missed sample leaves
a gap; it is not forward-filled. The sampler uses the InfluxDB dataset, whose
current ZFS quota is 420 GiB, and the existing 90-day `aggr_5m` retention
policy. The static Kubernetes claim still declares 350 GiB; see the
[node-200 storage record](NODE200_STORAGE_2026-10-05.md).
The Influx timestamp marks the start of the five-minute sampling bucket;
`source_time_ms` retains the venue's source timestamp when supplied. See
[Bybit's open interest field definitions](https://bybit-exchange.github.io/docs/v5/market/open-interest),
[Binance's futures market-data API](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data),
[OKX public data](https://www.okx.com/docs-v5/en/), and
[Hyperliquid asset contexts](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals).

The dashboard's **taker buy share** is `Σvbuy / (Σvbuy + Σvsell)` across five
large linear perpetual markets, naturally weighted by quote turnover. Its
**composite close proxy** is `Σ(close × five-minute quote turnover) / Σ(turnover)`;
it is not trade-level VWAP. The liquidation mean divides observed notional by
four reporting markets (Binance, Bybit, OKX, Bitget) and has a separate market
bar coverage panel. Binance's `forceOrder` stream publishes only a selected
liquidation order per symbol in each one-second window, so the liquidation
panels are a **reported-stream signal**, not a full venue reconciliation.
See [Binance's liquidation stream specification in its connector](https://github.com/binance/binance-futures-connector-python/blob/main/binance/websocket/um_futures/websocket_client.py)
for its one-order-per-symbol-per-second snapshot limit.
