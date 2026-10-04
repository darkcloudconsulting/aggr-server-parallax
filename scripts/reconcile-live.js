// Read-only comparison of a bounded live journal window with native REST trades.
// Usage: node scripts/reconcile-live.js [VENUE:MARKET ...]
const fs = require('fs')
const { execFileSync } = require('child_process')
process.argv.push('config=config.parallax.json')
const config = require('../src/config')

const selected = process.argv.slice(2).filter(value => !value.startsWith('config='))
const excluded = (process.env.PARALLAX_RECONCILE_EXCLUDE || '').split(',').filter(Boolean)
const markets = selected.length ? selected : config.pairs.filter(market =>
  !excluded.some(venue => market.startsWith(`${venue}:`)))
const repoNames = Object.fromEntries(config.exchanges.map(name => {
  const instance = new (require(`../src/exchanges/${name}`))()
  return [instance.id, name]
}))
const sql = 'const D=require("better-sqlite3");const d=new D("/var/lib/aggr-journal/events.sqlite",{readonly:true});' +
  'console.log(JSON.stringify(d.prepare("SELECT native_id,event_time,price,size,side,executions FROM events ' +
  'WHERE market=? AND event_time>? AND event_time<? AND liquidation=0").all(process.argv[1],+process.argv[2],+process.argv[3])));d.close()'

function localTrades(market, from, to) {
  const output = execFileSync('kubectl', ['-n', 'ai-bot-feeder', 'exec', 'deployment/aggr-server-parallax',
    '--', 'node', '-e', sql, market, String(from), String(to)],
  { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
  return JSON.parse(output)
}

function compare(local, native) {
  const a = new Map(local.map(row => [String(row.native_id), row]))
  const b = new Map(native.map(row => [String(row.id), row]))
  const missing = [...b.keys()].filter(id => !a.has(id))
  const extra = [...a.keys()].filter(id => !b.has(id))
  const differences = []
  for (const [id, row] of b) {
    const got = a.get(id)
    if (!got) continue
    const err = []
    if (Math.abs(got.event_time - row.timestamp) > 1000) err.push('time')
    if (Math.abs(got.price - row.price) > Math.max(1e-8, row.price * 1e-9)) err.push('price')
    if (Math.abs(got.size - row.size) > Math.max(1e-8, row.size * 1e-9)) err.push('baseSize')
    if (got.side !== row.side) err.push('side')
    if (got.executions !== Number(row.count || 1)) err.push('executions')
    if (err.length) differences.push({ id, fields: err })
  }
  return { native: b.size, journal: a.size, missing: missing.slice(0, 10),
    extra: extra.slice(0, 10), differences: differences.slice(0, 10),
    status: missing.length || extra.length || differences.length ? 'MISMATCH'
      : b.size ? 'MATCH' : 'QUIET_UNVERIFIED' }
}

async function main() {
  const result = { startedAt: new Date().toISOString(), markets: {} }
  const instances = {}
  for (const market of markets) {
    const [venue, ...parts] = market.split(':')
    const pair = parts.join(':')
    const row = result.markets[market] = {}
    try {
      const exchange = instances[venue] ||= new (require(`../src/exchanges/${repoNames[venue]}`))()
      if (!exchange.products) await exchange.getProducts(true)
      if (typeof exchange.getMissingTrades !== 'function') throw new Error('No native recovery method')
      const to = Date.now() - Number(process.env.PARALLAX_RECONCILE_LAG_MS || 13000)
      const from = to - Number(process.env.PARALLAX_RECONCILE_WINDOW_MS || 5000)
      row.from = from
      row.to = to
      const native = []
      exchange.emitTrades = (_, trades) => native.push(...trades)
      const range = { pair, from, to }
      try { await exchange.getMissingTrades(range) }
      catch (error) { row.recoveryError = error.message }
      Object.assign(row, compare(localTrades(market, from, to), native))
      if (row.recoveryError && row.status === 'MATCH') row.status = 'MATCH_WITH_RECOVERY_LIMIT'
    } catch (error) {
      row.status = 'ERROR'
      row.error = error.message
    }
    console.log(market, row.status, row.native, row.journal, row.recoveryError || row.error || '')
  }
  result.finishedAt = new Date().toISOString()
  const output = `/tmp/aggr-parallax-reconcile-${Date.now()}.json`
  fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n')
  console.log(output)
}

main().catch(error => { console.error(error); process.exitCode = 1 })
