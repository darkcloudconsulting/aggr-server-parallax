// Recompute every higher-timeframe bar in [from, to] from the bars below it,
// with the server's own resample() (src/storage/influx.js): 10s -> 30s -> 1m
// -> ... -> 6h -> 1d, each by SELECT ... INTO ... GROUP BY time().
//
// Used after scripts/backfill-history.js when the cutoff is not a UTC
// midnight: bars that straddle the cutoff were copied from the old instance
// (complete only up to its stop) or written by the new one (complete only
// from its start). Once the 10s bars on both sides of the cutoff are complete,
// re-running the cascade from the cutoff makes every straddling bar complete.
// Recomputing a bar that was already complete gives the same bar.
//
// Usage: node scripts/resample-range.js --port 8086 --from 2026-10-16T14:32:00Z [--to <iso>|now]
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
  const from = Date.parse(args.from)
  const to = !args.to || args.to === 'now' ? Date.now() : Date.parse(args.to)
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) throw new Error('need --from <= --to')
  const storage = new InfluxStorage()
  storage.influx = new Influx.InfluxDB({ host: args.host || '127.0.0.1', port: Number(args.port || 8086), database: config.influxDatabase })
  const tags = await storage.influx.query(`SHOW TAG VALUES FROM "${config.influxRetentionPrefix}10s"."${config.influxMeasurement}_10s" WITH KEY = "market"`)
  const markets = tags.map((t) => t.value)
  console.log(`resample ${new Date(from).toISOString()} .. ${new Date(to).toISOString()}, ${markets.length} markets, timeframes ${config.influxResampleTo.length}`)
  await storage.resample({ from, to, markets })
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err.message)
  process.exit(1)
})
