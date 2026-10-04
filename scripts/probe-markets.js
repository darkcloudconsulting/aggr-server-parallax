// Bounded public-feed probe. It does not connect to storage or existing pods.
const fs = require('fs')
const path = require('path')

const duration = Math.min(Number(process.argv[2]) || 30000, 60000)
const output = process.argv[3] || '/tmp/aggr-parallax-probe.json'
process.argv = [process.argv[0], process.argv[1], 'config=config.parallax.json']
const config = require('../src/config')

async function main() {
  const names = config.exchanges
  const receipt = { startedAt: new Date().toISOString(), durationMs: duration, venues: {} }
  const instances = []
  for (const name of names) {
    const Exchange = require(path.join('../src/exchanges', name))
    const exchange = new Exchange()
    const venue = receipt.venues[exchange.id] = {
      requested: config.pairs.filter(pair => pair.startsWith(exchange.id + ':')),
      missingProducts: [], errors: [], control: [], trades: {}
    }
    exchange.on('trades', trades => {
      for (const trade of trades) {
        const market = `${trade.exchange}:${trade.pair}`
        const stat = venue.trades[market] ||= { messages: 0, executions: 0, first: null, last: null, weakIds: 0 }
        stat.messages++
        stat.executions += Number(trade.count || 1)
        stat.first ||= trade.timestamp
        stat.last = Math.max(stat.last || 0, trade.timestamp)
        if (trade.id == null) stat.weakIds++
      }
    })
    const original = exchange.onMessage.bind(exchange)
    exchange.onMessage = (event, api) => {
      try {
        if (event.data === 'pong') return
        const data = event.data === 'pong' ? { op: 'pong' } : JSON.parse(event.data)
        if (venue.control.length < 20 && (data.event || data.op || data.success !== undefined || data.result === null || data.code)) {
          venue.control.push({ event: data.event, op: data.op, success: data.success,
            code: data.code, msg: data.msg, arg: data.arg, id: data.id })
        }
        return original(event, api)
      } catch (error) {
        venue.errors.push(error.message)
      }
    }
    instances.push(exchange)
    try {
      await exchange.getProducts(true)
      venue.missingProducts = venue.requested.filter(pair => !exchange.products.includes(pair.split(':').slice(1).join(':')))
      for (const market of venue.requested.filter(pair => !venue.missingProducts.includes(pair))) {
        exchange.link(market).catch(error => venue.errors.push(`${market}: ${error.message}`))
      }
    } catch (error) {
      venue.errors.push(`catalog: ${error.message}`)
    }
  }
  await new Promise(resolve => setTimeout(resolve, duration))
  for (const exchange of instances) {
    for (const api of exchange.apis) {
      try { api.close() } catch (_) { /* probe cleanup */ }
    }
  }
  receipt.finishedAt = new Date().toISOString()
  fs.writeFileSync(output, JSON.stringify(receipt, null, 2) + '\n')
  console.log(JSON.stringify({ output, summary: Object.fromEntries(Object.entries(receipt.venues).map(([id, venue]) =>
    [id, { requested: venue.requested.length, missing: venue.missingProducts.length,
      active: Object.keys(venue.trades).length, errors: venue.errors.length }])) }))
  process.exit(0)
}

main().catch(error => { console.error(error); process.exit(1) })
