// Recompute the higher-timeframe bars over a list of per-market ranges, with
// the server's own resample() (src/storage/influx.js), as resample-range.js
// does for one range and every market.
//
// Used after 10s bars were rewritten for scattered minutes (for example from
// the market-data store's trades, docs/STORE_FILL_2026-11-01.md): each range
// cascades 10s -> 30s -> ... -> 1d for its market only.
//
// Usage: node scripts/resample-ranges.js --port 8086 --ranges ranges.json
//   ranges.json: [{"market": "BITGET:BTCUSDT", "from": <ms>, "to": <ms>}, ...]
const fs = require('fs')
const args = Object.fromEntries(
  process.argv.slice(2).map((arg, i, all) =>
    arg.startsWith('--') ? [arg.slice(2), all[i + 1]] : null
  ).filter(Boolean)
)
process.argv.splice(2)
process.argv.push('config=config.parallax.json')
const config = require('../src/config')
config.collect = false
const Influx = require('influx')
const InfluxStorage = require('../src/storage/influx')

async function main() {
  const ranges = JSON.parse(fs.readFileSync(args.ranges, 'utf8'))
  const storage = new InfluxStorage()
  storage.influx = new Influx.InfluxDB({ host: args.host || '127.0.0.1', port: Number(args.port || 8086), database: config.influxDatabase })
  let done = 0
  for (const range of ranges) {
    if (!Number.isFinite(range.from) || !Number.isFinite(range.to) || range.to < range.from) throw new Error(`bad range ${JSON.stringify(range)}`)
    await storage.resample({ from: range.from, to: range.to, markets: [range.market] })
    done++
    if (done % 25 === 0) console.log(`${done}/${ranges.length} ranges resampled`)
  }
  console.log(`resampled ${done} ranges`)
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err.message)
  process.exit(1)
})
