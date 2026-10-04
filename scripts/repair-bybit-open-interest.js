/* global fetch, AbortSignal */
// One-time correction for the 12:25 and 12:30 UTC launch snapshots, which
// used Bybit's both-side OI. The sampler now uses the single-side fields.
const start = Date.parse('2026-10-04T12:25:00Z')
const end = Date.parse('2026-10-04T12:35:00Z')
const correctedTotals = {
  '2026-10-04T12:25:00Z': { BTC: 16484189651.754747, ETH: 12268213147.30616, SOL: 2418550715.406844 },
  '2026-10-04T12:30:00Z': { BTC: 16482273879.4178, ETH: 12264780495.265123, SOL: 2419183288.4282002 }
}
const host = process.env.INFLUX_HOST || 'aggr-parallax-influx'
const queryUrl = `http://${host}:8086/query?db=aggr_parallax&q=`

async function query(statement) {
  const response = await fetch(queryUrl + encodeURIComponent(statement), {
    signal: AbortSignal.timeout(15000)
  })
  if (!response.ok) throw new Error(`Influx query HTTP ${response.status}`)
  const json = await response.json()
  if (json.results?.[0]?.error) throw new Error(json.results[0].error)
  const series = json.results?.[0]?.series || []
  return series.flatMap(s => s.values.map(values =>
    Object.fromEntries(s.columns.map((column, index) => [column, values[index]]))))
}

async function main() {
  const where = `time >= '${new Date(start).toISOString()}' AND ` +
    `time < '${new Date(end).toISOString()}'`
  const bybit = await query(`SELECT * FROM aggr_5m.open_interest WHERE venue='BYBIT' AND ${where}`)
  const totals = await query(`SELECT * FROM aggr_5m.open_interest_total WHERE ${where}`)
  if (bybit.length !== 6 || totals.length !== 6) {
    throw new Error(`expected six Bybit and six total points, got ${bybit.length} and ${totals.length}`)
  }
  const lines = []
  const changes = []
  for (const old of bybit) {
    const time = Date.parse(old.time)
    const total = totals.find(t => t.asset === old.asset && Date.parse(t.time) === time)
    if (!total || !['BTC', 'ETH', 'SOL'].includes(old.asset) || total.venues !== 4 ||
        !(old.base > 0) || !(old.notional_usd > 0) ||
        !(total.notional_usd > old.notional_usd)) {
      throw new Error(`invalid launch point ${old.asset} ${old.time}`)
    }
    const expectedCorrected = correctedTotals[new Date(time).toISOString().replace('.000', '')]?.[old.asset]
    const expectedDelta = old.notional_usd / 2
    if (!expectedCorrected ||
        Math.abs(total.notional_usd - expectedCorrected - expectedDelta) >
          Math.max(0.01, expectedDelta * 1e-8)) {
      throw new Error(`launch correction already applied or unexpected point ${old.asset} ${old.time}`)
    }
    const newBase = old.base / 2
    const newBybit = old.notional_usd / 2
    const newTotal = total.notional_usd - newBybit
    lines.push(`open_interest,asset=${old.asset},venue=BYBIT,market=${old.market} ` +
      `base=${newBase},notional_usd=${newBybit} ${time}`)
    lines.push(`open_interest_total,asset=${old.asset} notional_usd=${newTotal} ${time}`)
    changes.push({ asset: old.asset, time: old.time,
      priorBybitNotional: old.notional_usd, correctedBybitNotional: newBybit,
      priorTotal: total.notional_usd, correctedTotal: newTotal })
  }
  if (process.argv.includes('--apply')) {
    const response = await fetch(`http://${host}:8086/write?db=aggr_parallax&rp=aggr_5m&precision=ms`, {
      method: 'POST', body: lines.join('\n') + '\n', signal: AbortSignal.timeout(15000)
    })
    if (!response.ok) throw new Error(`Influx write HTTP ${response.status}: ${await response.text()}`)
  }
  console.log(JSON.stringify({ applied: process.argv.includes('--apply'), changes }))
}

main().catch(error => { console.error(error); process.exitCode = 1 })
