# Parallax feed data catalog

This catalog describes the **new parallel feed**, not the existing snow or SOL
collectors. The configured database is `aggr_parallax` on InfluxDB 1.12.4.
Collection began on 4 October 2026 at about 20:22 AEDT (09:22 UTC); there is
no migration or backfill. The 24-hour release validation remains in progress;
see [release status](RELEASE_STATUS.md) before treating a market as certified.

## Grafana and query path

- Market-data Grafana: [Snowgraf](http://192.168.10.208:32161/), namespace `monitor`.
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

There are **63 configured markets** across 11 venue IDs. Deribit perpetuals,
Coinbase INTX perpetuals, Kraken `PI_XBTUSD`, BitMEX, HTX, and Poloniex are
excluded with reasons in [release status](RELEASE_STATUS.md). An idle but
subscribed market has no bar for an interval with no accepted executions;
absence of a bar alone does not prove an outage.

## Bars, fields, and retention

InfluxDB stores **bars**, not the individual execution journal. Every named
retention policy contains a measurement with the matching timeframe. The
measurement has the `market` tag and these fields:

| Field | Meaning |
| --- | --- |
| `open`, `high`, `low`, `close` | Execution price OHLC ordered by native event time and deterministic trade identity. |
| `cbuy`, `csell` | Taker-buy and taker-sell execution counts; a native aggregate contributes its underlying count when exposed. |
| `vbuy`, `vsell` | Taker-buy and taker-sell **quote notional**: execution price × normalized base quantity. The quote unit follows the product's USD or USDT quote. |
| `lbuy`, `lsell` | Liquidation quote notional where the venue provides liquidation events; absent fields mean none was written for that point. |

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
