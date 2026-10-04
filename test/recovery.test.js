const test = require('node:test')
const assert = require('node:assert/strict')
const axios = require('axios')
const Binance = require('../src/exchanges/binance')
const BinanceFutures = require('../src/exchanges/binance_futures')
const Bybit = require('../src/exchanges/bybit')

for (const Exchange of [Binance, BinanceFutures]) {
  test(`${Exchange.name} continues a full page by aggregate ID at the same timestamp`, async () => {
    const original = axios.get
    const exchange = new Exchange()
    if (exchange.id === 'BINANCE_FUTURES') {
      exchange.dapi = {}
      exchange.specs = {}
    }
    exchange.waitBeforeContinueRecovery = async () => {}
    const received = []
    exchange.emitTrades = (_, trades) => received.push(...trades)
    const now = Date.now() - 10000
    const first = Array.from({ length: 1000 }, (_, a) => ({ a, f: a, l: a,
      T: now + 1, p: '100', q: '1', m: false }))
    const last = [{ a: 1000, f: 1000, l: 1000, T: now + 1, p: '101', q: '1', m: true }]
    const calls = []
    axios.get = async (_, { params }) => {
      calls.push(params)
      return { data: params.fromId === undefined ? first : last }
    }
    try {
      const count = await exchange.getMissingTrades({ pair: 'btcusdt', from: now, to: now + 1000 })
      assert.equal(count, 1001)
      assert.equal(received.length, 1001)
      assert.equal(calls[1].fromId, 1000)
      assert.equal(received[1000].side, 'sell')
    } finally {
      axios.get = original
    }
  })
}

test('Bybit REST and websocket retain the same native execution ID', () => {
  const exchange = new Bybit()
  exchange.types = { BTCUSDT: 'linear' }
  const ws = exchange.formatTrade({ i: 'native-1', T: 100, s: 'BTCUSDT',
    p: '100', v: '2', S: 'Buy' }, false)
  assert.equal(ws.id, 'native-1')
  assert.equal(ws.size, 2)
})
