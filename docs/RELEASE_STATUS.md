# Parallax feed release status — 2026-10-04

Status: **PARALLEL FEED LIVE; 24-HOUR VALIDATION PENDING**.

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
| OKX spot | `BTC-USDT`, `ETH-USDT`, `SOL-USDT` | 3/3 | `trades-all` supplies individual executions; native trade ID recovery. |
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

The application build is published at GHCR digest
`sha256:1e53141d81016bb926839eb1bd60983cfb682afafee7664c3a4994dcf826ce8a`.
GHCR currently requires authentication for this package. An authenticated
controller pulled that exact image, saved it, and imported it into node-200's
`k8s.io` containerd namespace. The import produced the equivalent local OCI
manifest digest `sha256:25d861f9453f4fc396a293d225e2078bfe5f588229112510b0dc6661234e8066`;
the deployment pins this local digest with `imagePullPolicy: Never`. Restarts
on node-200 use that content without cluster credentials.

## Data meaning and quality

`cbuy` and `csell` count underlying executions where native data exposes an
aggregate count; otherwise each reported execution counts once. Side is taker
side. `vbuy` and `vsell` are quote currency notional, calculated as price times
base quantity. `lbuy` and `lsell` are liquidation quote notional. Native
quantity and unit, trade ID, event time, normalized base size, and source are
retained in the SQLite WAL journal for seven days. The journal deduplicates by
native trade ID and orders equal-time trades by ID for deterministic OHLC.

`/health/feeds` reports connection request state, trades observed on the current
subscription, last trade, journal writes,
unresolved recovery or data issues, and recent interval finality. A missing bar
means there was no accepted trade in that interval. `writer_settled` means the
point and rollups were written with no known gap; exchange reconciliation is a
separate validation gate. A historical trade recovered after a restart does not
prove that the new websocket subscription has delivered a live trade.

## Live deployment checkpoint

At 2026-10-04 09:26 UTC, InfluxDB and the application were Ready on
`snow-node-200`, all 63 markets were connected and had emitted a trade, InfluxDB
1.12.4 had created all 12 configured retention policies, and recent one-minute
bars were queryable. The pool was ONLINE with 2.91 TiB total, project quota
500 GiB, Influx quota 350 GiB, and journal quota 150 GiB. Node-200 remained
cordoned. Pre- and post-deployment snapshots showed unchanged deployment and
pod specifications, image IDs, and Ready status for `aggr-server-snow` and
`aggr-server-sol`.

The original soak and two short restart checks were superseded by subsequent
connector and health fixes; their files remain on the journal dataset. The
current 24-hour Job `aggr-parallax-soak-20261004-r4` began at
**2026-10-04 10:03:58 UTC** and samples every five minutes into
`/srv/aggr-parallax/journal/soak-2026-10-04-r4.jsonl`. Its first sample had
63 connected markets, 63 with a settled interval, zero unresolved issues, and
a successful Influx query. Completion is expected after
**2026-10-05 10:03:58 UTC**. Just after the final restart, 62 subscriptions
had delivered a live trade; thin `BITGET:SOLUSD` had an earlier trade but was
still awaiting one on the new socket. This is not classified as an outage.

The first native REST check matched Binance spot, Binance futures, Coinbase
spot, Kraken spot, Bybit linear, Crypto.com spot, Bitfinex spot, Bitstamp spot,
and KuCoin spot by trade ID, count, side, base quantity, price, and timestamp.
It exposed a real OKX mismatch: the old `trades` socket aggregated fills while
REST returned individual trades. The connector now uses the public
`trades-all` channel on the business socket; its subscription ACK and live
trade frames were confirmed by a new probe. Bitget's REST recent-fill limit
is 100; that was corrected and two short busy windows matched by ID and
quantity. Longer gaps beyond that REST depth are recorded as unresolved.
The corrected image is live. A bounded replay of Parallax's own launch window
(`09:22–09:47 UTC`) replaced grouped OKX records with native executions and
cleared all nine launch issues. An independently queried 09:30 OKX BTC spot
10-second bar and its one-minute rollup matched the journal's execution counts
and OHLC; see [`validation/okx-launch-bar-2026-10-04.json`](../validation/okx-launch-bar-2026-10-04.json).

Across 45 other representative market windows, 25 matched native REST trade
identity and values, 17 had no trade in the bounded window, and three initial
comparisons were limited by Bybit spot's short recent-trade depth or
Bitstamp's second-resolution REST timestamps. A subsequent Bybit ETH spot
window matched six executions. The raw receipts are retained in
[`validation/reconcile-other-markets-2026-10-04.json`](../validation/reconcile-other-markets-2026-10-04.json)
and [`validation/reconcile-bybit-spot-2026-10-04.json`](../validation/reconcile-bybit-spot-2026-10-04.json).
Bitstamp's two coarse recovery buckets after deployment restarts were compared
event by event with its native API and cleared only after confirming complete
10-second membership and unambiguous OHLC order; see
[`validation/bitstamp-coarse-recovery-2026-10-04.json`](../validation/bitstamp-coarse-recovery-2026-10-04.json).
The native API does not expose subsecond recovery timestamps, so any future
coarse Bitstamp recovery remains flagged for independent validation.

At 10:04 UTC, the ZFS pool was ONLINE with no known errors; project, Influx,
and journal datasets used about 47 MiB, 23 MiB, and 24 MiB respectively within
their 500/350/150 GiB quotas. Node-200 remained cordoned. The original snow
and SOL deployment specs, pod UIDs, image IDs, and Ready status were unchanged
after the final rollout.

## Remaining release gate

Run the new deployment for 24 hours and reconcile busy and quiet intervals
against each venue's native trade API. Any market with an unresolved identity,
quantity, side, timestamp, count, OHLC, or gap discrepancy must be disabled
with its reason added here. Record the completed 24-hour window, pod readiness,
journal replay, Influx writes, disk use, and unchanged original pod specs here
before marking this release PASS.
