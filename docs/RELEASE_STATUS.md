# Parallax feed release status — current as of 2026-10-05

Status: **PARALLEL FEED LIVE; 24-HOUR VALIDATION PENDING**.

This feed starts a new history. No bars are migrated or backfilled from the
existing snow or SOL collectors. The original deployments and their data must
remain unchanged.

## Market matrix

The configuration contains 66 BTC, ETH, and SOL markets. Product identities
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
| Hyperliquid linear perpetual | `BTC`, `ETH`, `SOL` | 3/3 | Three subscription acknowledgements, 114 websocket fills in 12 seconds, and all ten recent REST fills per market matched websocket identities at 11:20 UTC. USDT denominated with USDC collateral. New 24-hour validation pending. |

### Explicit exclusions

| Market | Reason |
| --- | --- |
| `DERIBIT:BTC-PERPETUAL`, `ETH-PERPETUAL`, `SOL_USDC-PERPETUAL` | Raw trade subscription returns `raw_subscriptions_not_available_for_unauthorized`; no credentials supplied. Adapter retained in source, markets disabled. |
| `COINBASE:BTC-PERP-INTX`, `ETH-PERP-INTX`, `SOL-PERP-INTX` | Catalogued but only stale snapshots appeared in the public probe; no new trades. Reassess with an independent recent-trade window before enabling. |
| `KRAKEN:PI_XBTUSD` | Catalogued inverse contract had no trades in the public probe and is lower priority than active PF contracts. |
| Hyperliquid `UBTC/USDC`, `UETH/USDC`, `USOL/USDC` spot | HyperCore `spotMetaAndAssetCtxs` reported zero 24-hour notional volume for each on 4 October 2026. These tokens were not substituted for BTC, ETH, or SOL perpetuals. |
| BitMEX | Closed product paths in the reviewed deployment. |
| HTX, Poloniex | Lower priority venues outside the reputable-venue selection. |

## Storage and database

At initial deployment, node `snow-node-200` was cordoned. The OS is on
`nvme1n1`. The new
`nvme0n1` was rechecked by stable by-id, model, size, and absence of signatures
immediately before creating the single-disk `aggr-parallax` pool. Dataset
quotas: project 500 GiB, InfluxDB 350 GiB, journal 150 GiB. The rest of the
pool was then unallocated for later PostgreSQL datasets. This whole-disk
layout was superseded by the 5 October partitioned layout recorded in the
[current node-200 storage record](NODE200_STORAGE_2026-10-05.md).

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

Hyperliquid's public `recentTrades` response is capped at ten and ignored
`startTime`/`endTime` in the 4 October 2026 probe. Its adapter resolves a
reconnect gap only when the oldest returned fill is strictly earlier than the
last journaled trade; otherwise it records an unresolved gap. The new markets
must pass a fresh 24-hour observation window before certification.

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
previous 24-hour Job `aggr-parallax-soak-20261004-r4` began at
**2026-10-04 10:03:58 UTC** and samples every five minutes into
`/srv/aggr-parallax/journal/soak-2026-10-04-r4.jsonl`. Its first sample had
63 connected markets, 63 with a settled interval, zero unresolved issues, and
a successful Influx query. The Hyperliquid rollout at 11:25 UTC superseded it
for release validation; its samples remain as evidence. Just after the
preceding restart, 62 subscriptions
had delivered a live trade; thin `BITGET:SOLUSD` had an earlier trade but was
still awaiting one on the new socket. This is not classified as an outage.
By 10:07 UTC, all 63 current subscriptions had delivered a live trade.

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
An additional 18-market OKX and Bitget reconciliation matched all 12 windows
with native executions; six short windows contained no trade and remain
unverified for inactivity. See
[`validation/reconcile-okx-bitget-2026-10-04.json`](../validation/reconcile-okx-bitget-2026-10-04.json).
Bitstamp's two coarse recovery buckets after deployment restarts were compared
event by event with its native API and cleared only after confirming complete
10-second membership and unambiguous OHLC order; see
[`validation/bitstamp-coarse-recovery-2026-10-04.json`](../validation/bitstamp-coarse-recovery-2026-10-04.json).
The native API does not expose subsecond recovery timestamps, so any future
coarse Bitstamp recovery remains flagged for independent validation.

At 21:59 AEDT on 4 October (10:59 UTC), a bounded stability check found both
Parallax deployments and the soak pod Ready with zero restarts. All 63 markets
were connected and had observed a live trade on their current subscriptions;
there were no unresolved issues. The latest soak samples reported successful
Influx reads and settled bars. This checkpoint does not replace the full
24-hour release gate.

Snowgraf now has the additive **Aggr Parallax (InfluxQL)** data source, UID
`aggr-parallax-influxql`. Its Grafana proxy returned the 12 project retention
policies plus `autogen`, and a live `BINANCE:btcusdt` one-minute bar. The
[data catalog](DATA_CATALOG.md) lists the current 66 symbols, bar fields, and retention
periods. The versioned datasource definition and idempotent registration are
in [`deploy/`](../deploy/grafana-datasource.json).

At 10:04 UTC, the ZFS pool was ONLINE with no known errors; project, Influx,
and journal datasets used about 47 MiB, 23 MiB, and 24 MiB respectively within
their 500/350/150 GiB quotas. Node-200 remained cordoned. The original snow
and SOL deployment specs, pod UIDs, image IDs, and Ready status were unchanged
after the final rollout.

## Hyperliquid rollout — 2026-10-04

The adapter now waits for a `subscriptionResponse` before marking a market
connected, keeps the websocket alive, and retains the native `(time, coin,
tid)` identity and base quantity. Three perpetual markets were added:
`HYPERLIQUID:BTC`, `HYPERLIQUID:ETH`, and `HYPERLIQUID:SOL`. Hyperliquid's
contract specification makes these USDT-denominated linear perps with USDC
collateral. The spot candidates remain excluded for zero reported 24-hour
volume. The bounded websocket and REST probe is in
[`validation/hyperliquid-2026-10-04.json`](../validation/hyperliquid-2026-10-04.json).
Recovery beyond the latest ten native fills remains a known limit; incomplete
reconnect intervals are flagged unresolved rather than certified.

The image imported on node-200 has immutable local OCI digest
`sha256:2cff2df2a50ae6c2a5a1fa822c9ebf38a347943784b16cf99edce6f3189ac3a0`.
At 11:28 UTC, the application and InfluxDB pods were Ready with zero restarts;
all 66 markets were connected and had delivered a trade on their current
subscriptions. Each Hyperliquid market had a settled interval with no weak
trade identity, and all three had queryable one-minute Influx bars. The journal
had zero unresolved gaps. Four Bitstamp second-resolution recovery buckets
created by this rollout were independently matched to their native REST
executions and cleared; the evidence is in
[`validation/bitstamp-coarse-hyperliquid-rollout-2026-10-04.json`](../validation/bitstamp-coarse-hyperliquid-rollout-2026-10-04.json).

The new 24-hour Job `aggr-parallax-soak-20261004-r5` started at
**2026-10-04 11:25:55 UTC**, sampling every five minutes into
`/srv/aggr-parallax/journal/soak-2026-10-04-r5.jsonl`. Its first sample
reported 66 connected markets and a successful Influx read; it preceded the
Bitstamp bucket verification and recorded four then-unresolved issues. The
11:30:55 UTC sample recorded 66 connected and 66 settled markets, zero
unresolved issues, and a successful Influx read. Completion is due after
**2026-10-05 11:25:55 UTC**. The 24-hour release gate remains pending.
Node-200 remained cordoned; journal and Influx ZFS datasets used 59 MiB and
67 MiB of their respective 150 and 350 GiB quotas. Pre- and post-rollout
comparisons found the original snow and SOL deployment specs identical and
both Ready at 1/1. The InfluxDB deployment spec was also unchanged.
The [repository image build](https://github.com/darkcloudconsulting/aggr-server-parallax/actions/runs/37198935660)
for this merged source revision completed successfully.

## Feed dashboard and open interest — 2026-10-04

The dedicated [Aggr Parallax feed dashboard](http://192.168.10.208:32161/d/aggr-parallax-feed/aggr-parallax-e28094-btc-eth-sol-feed)
is live in Snowgraf's **Aggr Parallax Feed** folder. Its 15 panels cover
four-venue open interest, five-venue trade turnover over several windows,
observed liquidation notional and intensity for four reporting venues,
liquidation bar coverage, quote-volume-weighted taker buy share, and a
turnover-weighted close proxy. All 13 data panels returned Grafana datasource
frames without errors for BTC, ETH, and SOL. The dashboard is versioned in
[`deploy/grafana-feed-dashboard.json`](../deploy/grafana-feed-dashboard.json)
and registered by [`deploy/grafana-feed-dashboard.py`](../deploy/grafana-feed-dashboard.py).
The close proxy is not execution VWAP; liquidation streams can omit events,
including Binance's selected order per one-second interval.

The separate `aggr-parallax-open-interest` CronJob samples Binance USDⓈ-M,
Bybit linear, OKX USDT swaps, and Hyperliquid every five minutes. It writes
12 venue snapshots and three complete four-venue totals to `aggr_5m` (90-day
retention), with no historical backfill. The CronJob uses immutable local OCI
image digest `sha256:1c45cb968ac3bc8a27ead7c639b7465c5a4b4f16cd888ae5532ed21e928a8c10`.
The first scheduled run, the corrected 12:35 UTC check, and the 12:40 UTC
scheduled run each completed with all three assets and no failures. The
initial 12:25 and 12:30 UTC snapshots
used Bybit's both-side fields; all six Bybit points and their six totals were
corrected at the same Influx timestamps after checking the source's 2:1
both-to-single-side relationship. See
[`validation/bybit-open-interest-launch-correction-2026-10-04.json`](../validation/bybit-open-interest-launch-correction-2026-10-04.json).

At 12:35 UTC, the trade soak still reported 66 connected and settled markets,
zero unresolved issues, and successful Influx reads. The four existing
deployment specifications (snow, SOL, Parallax trade service, InfluxDB) were
identical before and after the dashboard and sampler rollout and all remained
Ready at 1/1. The new sampler does not reset the 24-hour trade validation
window.

## Node-200 repartition and stability run — 2026-10-05 AEDT

The owner repartitioned `nvme0n1` into a roughly 650 GiB ZFS partition for
Parallax and a roughly 2.3 TiB XFS partition mounted at `/srv/pg-node200`.
The recreated `aggr-parallax` pool has a 520 GiB project quota, split into
420 GiB for InfluxDB and 100 GiB for the journal. The pool is online with no
reported data errors. The [current storage record](NODE200_STORAGE_2026-10-05.md)
details the mount, limits, boot status, and the still-unreconciled static
Kubernetes PV/PVC declarations of 350 GiB for Influx and 150 GiB for the
journal. The journal's effective ZFS limit is 100 GiB.

The previous `r5` soak Job stopped during the storage change; its JSONL
evidence remains on the journal dataset. The new
`aggr-parallax-soak-20261005-r6` Job started at **2026-10-05 02:05:48 AEDT**
(2026-10-04 15:05:48 UTC) and samples every five minutes into
`/srv/aggr-parallax/journal/soak-2026-10-05-r6.jsonl`. Its first sample
reported 66 connected markets, 45 with a recent settled interval, 124
unresolved journal entries, and a successful Influx query. The collector is
receiving new data, and pre-change one-minute bars remained queryable for all
66 markets. Of the 124 unresolved entries, 122 were first seen after the
repartition and concern buckets around 01:36:30–01:44:50 AEDT. These are
recorded as incomplete pending native recovery verification. The new 24-hour
window is due after **2026-10-06 02:05:48 AEDT**; no PASS is claimed yet.

## Retention extension — 2026-10-05

At 09:37 UTC (20:37 AEDT), the live `aggr_parallax` InfluxDB retention
policies were verified at 30 days for `aggr_10s`, 365 days for `aggr_1m`, and
728 days for `aggr_5m`. The last policy also retains five-minute open-interest
snapshots for 728 days. The versioned `config.parallax.json` and data catalog
now specify these values. Existing data was not backfilled.

The live Parallax image still contains the previous durations. Its startup
code only creates missing retention policies, so restarting that image does
not overwrite the three live changes; rebuild from this source revision before
recreating the database. Recent one-minute trade and five-minute open-interest
queries succeeded after the change. The Parallax and InfluxDB pods remained
Ready with zero restarts, and the `r6` soak Job remained active. The Influx
dataset's 420 GiB quota is unchanged; watch its use as retention fills.

## Remaining release gate

Run the new deployment for 24 hours and reconcile busy and quiet intervals
against each venue's native trade API. Any market with an unresolved identity,
quantity, side, timestamp, count, OHLC, or gap discrepancy must be disabled
with its reason added here. Record the completed 24-hour window, pod readiness,
journal replay, Influx writes, disk use, and unchanged original pod specs here
before marking this release PASS.
