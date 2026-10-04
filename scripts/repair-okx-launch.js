// Correct only Parallax's own initial OKX bars after moving to individual trades.
const config = require('../src/config')
const Journal = require('../src/storage/journal')
const Okex = require('../src/exchanges/okex')

async function main() {
  const from = Date.parse(process.argv[2])
  const to = Date.parse(process.argv[3])
  if (!config.parallaxJournalLocation || !Number.isFinite(from) || !Number.isFinite(to) ||
      from >= to || to - from > 24 * 3600000 || from < Date.parse('2026-10-04T09:22:00Z')) {
    throw new Error('Expected a bounded Parallax launch interval after 2026-10-04T09:22:00Z')
  }
  const journal = new Journal(config.parallaxJournalLocation, config.influxTimeframe)
  const exchange = new Okex()
  await exchange.getProducts()
  exchange.emitTrades = (_, trades) => journal.append(trades, 'recovery')
  exchange.emitLiquidations = () => {}
  const results = []
  try {
    for (const market of config.pairs.filter(market => market.startsWith('OKEX:'))) {
      const pair = market.slice(5)
      const count = await exchange.getMissingTrades({ pair, from, to }, 0, false)
      results.push({ market, recoveredExecutions: count })
      console.log(JSON.stringify(results.at(-1)))
    }
    console.log(JSON.stringify({ from, to, results, pendingBuckets: journal.health().pending }))
  } finally {
    journal.db.close()
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
