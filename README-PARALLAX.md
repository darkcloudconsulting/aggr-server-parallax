# Aggr-server Parallax

This is a targeted maintenance branch of Tucsky's `aggr-server`, built as a
parallel BTC, ETH, and SOL feed. The upstream layout, exchange classes,
historical API, and bar schema remain the base design. The new deployment uses
[`config.parallax.json`](config.parallax.json) and a durable execution journal
to make corrections deterministic and restart-safe.

The journal writer publishes eligible buckets from the last two minutes before
draining older history. Each 10-second pass can publish up to 256 recent and
600 historical buckets. The SQLite index on `(bucket, market)` keeps both
lookups ordered without scanning the pending table. A bucket is removed from
the pending queue only after its Influx point and rollups have been written.

The deployment manifest is [`deploy/node201.yaml`](deploy/node201.yaml):
InfluxDB and the server in `ai-bot-feeder` on `snow-node-201`, on the ZFS
datasets `zfs-201/aggr-influx` and `zfs-201/aggr-journal` (`sync=disabled`;
the journal's `synchronous=FULL` SQLite commits run on the event loop, so slow
fsync stalls the server). The feed moved there from unstable node 200 on
2026-10-16; the move, the backfill and its verification are in
[`docs/NODE201_MOVE_2026-10-16.md`](docs/NODE201_MOVE_2026-10-16.md).
[`deploy/kubernetes.yaml`](deploy/kubernetes.yaml), the
[node-200 storage record](docs/NODE200_STORAGE_2026-10-05.md) and
[`provision-node200.sh`](deploy/provision-node200.sh) are historical: the
node-200 pair is at 0 and its data is kept until the owner signs off.

The current market matrix, exclusions, data semantics, database choice, and
release gate are in [`docs/RELEASE_STATUS.md`](docs/RELEASE_STATUS.md).
The active 24-hour stability run is defined in [`deploy/soak.yaml`](deploy/soak.yaml).
The [data catalog](docs/DATA_CATALOG.md) lists all 66 market IDs, bar fields,
InfluxDB retention policies, and the Snowgraf data source. The
[dedicated feed dashboard](http://192.168.10.208:32161/d/aggr-parallax-feed/aggr-parallax-e28094-btc-eth-sol-feed)
shows open interest, reported liquidations, turnover, and weighted views for
BTC, ETH, and SOL. A separate
[`open-interest` CronJob](deploy/open-interest.yaml) samples four large linear
perpetual venues every five minutes; it does not restart the trade collector.
`npm test` covers journal replay, duplicate delivery, pagination, late
correction, and failed writes. `node scripts/influx-compat.js` checks a
disposable InfluxDB 1.x instance exposed on local port 8087.
