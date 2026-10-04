# Parallax feed release status — 2026-10-04

Status: **DEPLOYMENT IN PROGRESS; 24-HOUR PARALLEL VALIDATION PENDING**.

This feed starts a new history. No bars are migrated or backfilled from the
existing snow or SOL collectors. The original deployments and their data must
remain unchanged.

## Market matrix

The configuration contains 63 BTC, ETH, and SOL markets. Product identities
are kept separate by venue and spot, linear, or inverse contract. A 25-second
public websocket probe is archived in
[`validation/probe-2026-10-04.json`](../validation/probe-2026-10-04.json).
An empty 25-second window is **not** evidence of an outage.

| Venue | Enabled market IDs | Probe with trades | Notes |
| --- | --- | ---: | --- |
| Binance spot | `btcusdt`, `ethusdt`, `solusdt` | 3/3 | Aggregate trade stream matches REST identity. |
| Binance futures | `btcusdt`, `ethusdt`, `solusdt`, `btcusd_perp`, `ethusd_perp`, `solusd_perp` | 6/6 | USDⓈ-M and COIN-M keep separate units. |
| Coinbase spot | `BTC-USD`, `ETH-USD`, `SOL-USD` | 3/3 | INTX perps excluded below. |
| Kraken spot | `XBT/USD`, `ETH/USD`, `SOL/USD` | 3/3 | Spot uses v2 trade IDs; local XBT identity retained. |
| Kraken futures | `PF_XBTUSD`, `PF_ETHUSD`, `PF_SOLUSD` | 3/3 | `PI_XBTUSD` excluded below. |
| OKX spot | `BTC-USDT`, `ETH-USDT`, `SOL-USDT` | 3/3 | Native trade ID recovery. |
| OKX linear swaps | `BTC-USDT-SWAP`, `ETH-USDT-SWAP`, `SOL-USDT-SWAP` | 3/3 | Contract metadata controls size conversion. |
| OKX inverse swaps | `BTC-USD-SWAP`, `ETH-USD-SWAP`, `SOL-USD-SWAP` | 1/3 | Two contracts quiet in probe; validate against REST. |
| Bybit spot | `BTCUSDT-SPOT`, `ETHUSDT-SPOT`, `SOLUSDT-SPOT` | 3/3 | Separate spot socket. |
| Bybit linear | `BTCUSDT`, `ETHUSDT`, `SOLUSDT` | 3/3 | Catalog queries each base coin. |
| Bybit inverse | `BTCUSD`, `ETHUSD`, `SOLUSD` | 2/3 | One contract quiet in probe; validate against REST. |
| Bitget spot | `BTCUSDT-SPOT`, `ETHUSDT-SPOT`, `SOLUSDT-SPOT` | 3/3 | v3 execution ID is `i`. |
| Bitget linear | `BTCUSDT`, `ETHUSDT`, `SOLUSDT` | 3/3 |  |
| Bitget inverse | `BTCUSD`, `ETHUSD`, `SOLUSD` | 2/3 | One contract quiet in probe; validate against REST. |
| Crypto.com spot | `BTC_USD`, `ETH_USD`, `SOL_USD` | 3/3 |  |
| Crypto.com perpetual | `BTCUSD-PERP`, `ETHUSD-PERP`, `SOLUSD-PERP` | 3/3 |  |
| Bitfinex spot | `BTCUSD`, `ETHUSD`, `SOLUSD` | 3/3 |  |
| Bitstamp spot | `btcusd`, `ethusd`, `solusd` | 3/3 |  |
| KuCoin spot | `BTC-USDT`, `ETH-USDT`, `SOL-USDT` | 3/3 |  |
| KuCoin linear | `XBTUSDTM`, `ETHUSDTM`, `SOLUSDTM` | 3/3 | Futures multiplier applied. |

### Explicit exclusions

| Market | Reason |
| --- | --- |
| `DERIBIT:BTC-PERPETUAL`, `ETH-PERPETUAL`, `SOL_USDC-PERPETUAL` | Raw trade subscription returns `raw_subscriptions_not_available_for_unauthorized`; no credentials supplied. Adapter retained in source, markets disabled. |
| `COINBASE:BTC-PERP-INTX`, `ETH-PERP-INTX`, `SOL-PERP-INTX` | Catalogued but only stale snapshots appeared in the public probe; no new trades. Reassess with an independent recent-trade window before enabling. |
| `KRAKEN:PI_XBTUSD` | Catalogued inverse contract had no trades in the public probe and is lower priority than active PF contracts. |
| BitMEX | Closed product paths in the reviewed deployment. |
| HTX, Poloniex | Lower priority venues outside the reputable-venue selection. |

## Storage and database

Node `snow-node-200` remains cordoned. The OS is on `nvme1n1`. The new
`nvme0n1` was rechecked by stable by-id, model, size, and absence of signatures
immediately before creating the single-disk `aggr-parallax` pool. Dataset
quotas: project 500 GiB, InfluxDB 350 GiB, journal 150 GiB. The rest of the
pool is unallocated for later PostgreSQL datasets.

InfluxDB `1.13.0` is documented but its Docker tag returns `manifest unknown`
and its official tarball URL returns HTTP 404 as of this review. InfluxDB
`1.12.4` was tested with database and retention-policy creation, journal
writes, correction of a 10-second point, one-minute rollup correction, and
InfluxQL reads. The exact image digest is in `deploy/kubernetes.yaml`.
InfluxDB 3 Core is not a compatible target for this retention-policy and
same-point correction design.

## Data meaning and quality

`cbuy` and `csell` count underlying executions where native data exposes an
aggregate count; otherwise each reported execution counts once. Side is taker
side. `vbuy` and `vsell` are quote currency notional, calculated as price times
base quantity. `lbuy` and `lsell` are liquidation quote notional. Native
quantity and unit, trade ID, event time, normalized base size, and source are
retained in the SQLite WAL journal for seven days. The journal deduplicates by
native trade ID and orders equal-time trades by ID for deterministic OHLC.

`/health/feeds` reports connection request state, last trade, journal writes,
unresolved recovery or data issues, and recent interval finality. A missing bar
means there was no accepted trade in that interval. `writer_settled` means the
point and rollups were written with no known gap; exchange reconciliation is a
separate validation gate.

## Remaining release gate

Run the new deployment for 24 hours and reconcile busy and quiet intervals
against each venue's native trade API. Any market with an unresolved identity,
quantity, side, timestamp, count, OHLC, or gap discrepancy must be disabled
with its reason added here. Record the completed 24-hour window, pod readiness,
journal replay, Influx writes, disk use, and unchanged original pod specs here
before marking this release PASS.
