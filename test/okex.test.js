const test = require('node:test')
const assert = require('node:assert/strict')
const Okex = require('../src/exchanges/okex')

test('OKX trades-all keeps individual trade identity and converts linear/inverse units', () => {
  const exchange = new Okex()
  exchange.types = { 'BTC-USDT': 'SPOT', 'BTC-USDT-SWAP': 'SWAP', 'BTC-USD-SWAP': 'SWAP' }
  exchange.specs = { 'BTC-USDT-SWAP': 0.01, 'BTC-USD-SWAP': 100 }
  exchange.inversed = { 'BTC-USD-SWAP': true }
  exchange.contractMetadata = {
    'BTC-USDT-SWAP': { currency: 'BTC' },
    'BTC-USD-SWAP': { currency: 'USD' }
  }
  const observed = []
  exchange.emitTrades = (_, trades) => observed.push(...trades)
  const api = { id: 'api-1' }
  for (const [instId, tradeId, sz] of [
    ['BTC-USDT', '1', '2'], ['BTC-USDT-SWAP', '2', '2'], ['BTC-USD-SWAP', '3', '2']
  ]) {
    exchange.onMessage({ data: JSON.stringify({ arg: { channel: 'trades-all', instId },
      data: [{ instId, tradeId, px: '100', sz, side: 'buy', ts: '1000' }] }) }, api)
  }
  assert.deepEqual(observed.map(trade => trade.id), ['1', '2', '3'])
  assert.deepEqual(observed.map(trade => trade.size), [2, 0.02, 2])
  assert.deepEqual(observed.map(trade => trade.count), [1, 1, 1])
  assert.deepEqual(observed.map(trade => trade.nativeUnit), ['base', 'contracts', 'contracts'])
})
