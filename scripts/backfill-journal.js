// Fill 10 s bars that are missing from InfluxDB with bars rebuilt from a copy
// of a server's execution journal, then cascade the higher timeframes.
//
// Used after the node 200 -> node 201 move: node 200's InfluxDB has no bars for
// most markets from 2026-10-06 to 2026-10-11, while its journal still holds the
// executions for part of that time (settled events are pruned after seven
// days). See docs/NODE200_REMOVAL_2026-10-16.md: for that gap the journal had
// nothing InfluxDB lacked, so the tool was run in plan mode only.
//
// Fill-only: a (market, 10 s bucket) that already has a point in
// aggr_10s.trades_10s is never written. Where both exist the journal bar is
// compared with the stored one and differences are reported, not repaired.
// Bars are built with the server's own Journal.bar() and the point mapping of
// InfluxStorage.flushJournalEntries(), so a filled bar is the bar the server
// would have written.
//
// Run it on a COPY of the journal: opening the file runs the Journal
// constructor (CREATE TABLE IF NOT EXISTS, WAL pragma), which writes to it.
//
// Usage (plan only unless --execute):
//   node scripts/backfill-journal.js --journal /path/copy/events.sqlite \
//     --url http://127.0.0.1:8086 --from 2026-10-04T00:00:00Z \
//     --to 2026-10-16T14:32:00Z [--markets A,B] [--execute]
//
// With --execute: write the missing 10 s points, run the server's resample()
// per UTC day over the filled range for the filled markets only, then verify
// that every journal bucket in range has a 10 s point.

const args = Object.fromEntries(
  process.argv.slice(2).map((arg, i, all) =>
    arg.startsWith('--') ? [arg.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true] : null
  ).filter(Boolean)
)
process.argv.splice(2)
process.argv.push('config=config.parallax.json')
const config = require('../src/config')
config.collect = false
const Influx = require('influx')
const InfluxStorage = require('../src/storage/influx')
const Journal = require('../src/storage/journal')

const DAY = 86400000
const TF = config.influxTimeframe
const RP = config.influxRetentionPrefix + '10s'
const MEASUREMENT = config.influxMeasurement + '_10s'
const FIELDS = ['cbuy', 'csell', 'vbuy', 'vsell', 'open', 'high', 'low', 'close', 'lbuy', 'lsell']
const FROM = Date.parse(args.from)
const TO = Date.parse(args.to)
const EXECUTE = args.execute === true
const iso = (ms) => new Date(ms).toISOString()

if (!args.journal || !Number.isFinite(FROM) || !Number.isFinite(TO) || FROM % TF || TO % TF || TO <= FROM) {
  console.error('need --journal <copy> --from <iso> --to <iso>, both on 10 s boundaries, from < to')
  process.exit(2)
}

// The field mapping of InfluxStorage.flushJournalEntries().
function toPoint(bar) {
  const fields = {}
  if (bar.cbuy || bar.csell) {
    Object.assign(fields, { cbuy: bar.cbuy, csell: bar.csell,
      vbuy: bar.vbuy, vsell: bar.vsell,
      open: bar.open, high: bar.high, low: bar.low, close: bar.close })
  }
  if (bar.lbuy || bar.lsell) {
    fields.lbuy = bar.lbuy
    fields.lsell = bar.lsell
  }
  return { measurement: MEASUREMENT, tags: { market: bar.market }, fields, timestamp: bar.time }
}

// Compares the stored fields only: toPoint() omits the trade fields of a
// liquidation-only bar and the liquidation fields when both are zero, so a
// journal 0 and an absent stored field are the same value.
function differs(a, b) {
  const point = toPoint(a).fields
  for (const f of FIELDS) {
    const x = point[f] ?? null
    const y = b[f] ?? null
    if (x === null && y === null) continue
    if (x === null || y === null) return f
    if (Math.abs(x - y) > 1e-9 * Math.max(1, Math.abs(x), Math.abs(y))) return f
  }
  return null
}

async function stored(influx, market, from, to) {
  const rows = await influx.query(
    `SELECT ${FIELDS.join(', ')} FROM "${RP}"."${MEASUREMENT}"
     WHERE market = ${Influx.escape.stringLit(market)} AND time >= ${from}ms AND time < ${to}ms`,
    { precision: 'ms' })
  const map = new Map()
  for (const row of rows) map.set(row.time.getTime(), row)
  return map
}

async function main() {
  const journal = new Journal(args.journal, TF)
  const db = journal.db
  const url = new URL(args.url || 'http://127.0.0.1:8086')
  const influx = new Influx.InfluxDB({ host: url.hostname, port: Number(url.port || 8086), database: config.influxDatabase })
  const markets = args.markets
    ? String(args.markets).split(',')
    : db.prepare('SELECT market FROM feed_state ORDER BY market').all().map((r) => r.market)
  const buckets = db.prepare(`SELECT DISTINCT bucket FROM events
    WHERE market = ? AND bucket >= ? AND bucket < ? ORDER BY bucket`).pluck()

  console.log(`journal ${args.journal}`)
  console.log(`target  ${url.origin} ${config.influxDatabase}.${RP}.${MEASUREMENT}`)
  console.log(`range   ${iso(FROM)} .. ${iso(TO)}, ${markets.length} markets, ${EXECUTE ? 'EXECUTE' : 'plan only'}`)

  const filled = new Map() // market -> [min bucket, max bucket]
  const totals = { journal: 0, present: 0, missing: 0, written: 0, mismatched: 0 }
  const examples = []
  for (const market of markets) {
    const per = { journal: 0, present: 0, missing: 0, mismatched: 0, first: null, last: null }
    for (let day = Math.floor(FROM / DAY) * DAY; day < TO; day += DAY) {
      const from = Math.max(day, FROM)
      const to = Math.min(day + DAY, TO)
      const list = buckets.all(market, from, to)
      if (!list.length) continue
      const have = await stored(influx, market, from, to)
      const points = []
      for (const bucket of list) {
        const bar = journal.bar(market, bucket)
        if (!bar) continue
        per.journal++
        const row = have.get(bucket)
        if (row) {
          per.present++
          const field = differs(bar, row)
          if (field) {
            per.mismatched++
            if (examples.length < 20) examples.push(`${market} ${iso(bucket)} ${field}: journal ${bar[field]} influx ${row[field]}`)
          }
          continue
        }
        per.missing++
        per.first ??= bucket
        per.last = bucket
        points.push(toPoint(bar))
      }
      if (EXECUTE && points.length) {
        for (let i = 0; i < points.length; i += 5000) {
          await influx.writePoints(points.slice(i, i + 5000), { precision: 'ms', retentionPolicy: RP })
        }
        totals.written += points.length
      }
    }
    if (per.missing) filled.set(market, [per.first, per.last])
    for (const k of ['journal', 'present', 'missing', 'mismatched']) totals[k] += per[k]
    console.log(`${market.padEnd(28)} journal ${String(per.journal).padStart(7)}  in influx ${String(per.present).padStart(7)}  missing ${String(per.missing).padStart(7)}  differ ${per.mismatched}` +
      (per.missing ? `  fill ${iso(per.first)} .. ${iso(per.last)}` : ''))
  }
  console.log(`TOTAL journal buckets ${totals.journal}, already in influx ${totals.present}, missing ${totals.missing}, differ ${totals.mismatched}, written ${totals.written}`)
  for (const e of examples) console.log(`  differ: ${e}`)
  if (!EXECUTE || !filled.size) return

  // Higher timeframes, by the server's own cascade, only for filled markets,
  // one UTC day at a time over the filled range (resample() floors each
  // timeframe's range itself, so the 1d bar of each day is rebuilt whole).
  const storage = new InfluxStorage()
  storage.influx = influx
  const lo = Math.min(...[...filled.values()].map((v) => v[0]))
  const hi = Math.max(...[...filled.values()].map((v) => v[1]))
  for (let day = Math.floor(lo / DAY) * DAY; day <= hi; day += DAY) {
    const dayMarkets = [...filled].filter(([, [a, b]]) => a < day + DAY && b >= day).map(([m]) => m)
    if (!dayMarkets.length) continue
    console.log(`resample ${iso(day)} .. ${iso(day + DAY - TF)} for ${dayMarkets.length} markets`)
    await storage.resample({ from: day, to: day + DAY - TF, markets: dayMarkets })
  }

  // Verify: every journal bucket in range now has a 10 s point.
  let absent = 0
  for (const market of filled.keys()) {
    for (let day = Math.floor(FROM / DAY) * DAY; day < TO; day += DAY) {
      const from = Math.max(day, FROM)
      const to = Math.min(day + DAY, TO)
      const list = buckets.all(market, from, to)
      if (!list.length) continue
      const have = await stored(influx, market, from, to)
      for (const bucket of list) if (!have.has(bucket) && journal.bar(market, bucket)) absent++
    }
  }
  console.log(absent ? `VERIFY FAILED: ${absent} journal buckets still without a 10 s point` : 'VERIFY PASSED: every journal bucket in range has a 10 s point')
  if (absent) process.exitCode = 1
}

main().then(() => process.exit(process.exitCode || 0)).catch((err) => {
  console.error(err.stack || err.message || err)
  process.exit(1)
})
