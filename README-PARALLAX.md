# Aggr-server Parallax

This is a targeted maintenance branch of Tucsky's `aggr-server`, built as a
parallel BTC, ETH, and SOL feed. The upstream layout, exchange classes,
historical API, and bar schema remain the base design. The new deployment uses
[`config.parallax.json`](config.parallax.json) and a durable execution journal
to make corrections deterministic and restart-safe.

The deployment manifest is [`deploy/kubernetes.yaml`](deploy/kubernetes.yaml).
It creates only new named volumes, deployments, and services in
`ai-bot-feeder`, pinned to cordoned `snow-node-200`. Provisioning is scripted in
[`deploy/provision-node200.sh`](deploy/provision-node200.sh). Do not run that
script again on an initialized disk; it deliberately refuses an existing pool.

The current market matrix, exclusions, data semantics, database choice, and
release gate are in [`docs/RELEASE_STATUS.md`](docs/RELEASE_STATUS.md).
`npm test` covers journal replay, duplicate delivery, pagination, late
correction, and failed writes. `node scripts/influx-compat.js` checks a
disposable InfluxDB 1.x instance exposed on local port 8087.
