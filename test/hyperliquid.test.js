const test = require('node:test')
const assert = require('node:assert/strict')
const axios = require('axios')
const Hyperliquid = require('../src/exchanges/hyperliquid')
const { parseMarket } = require('../src/services/catalog')

const fill = (time, tid, side = 'B') => ({ coin: 'BTC', time, tid, side,
  px: '80000', sz: '0.005' })

test('Hyperliquid marks a subscription connected only after the matching acknowledgement', async () => {
  const exchange = new Hyperliquid()
  const sent = []
  const api = { id: 'ws-1', _pending: ['BTC'], _connected: [], send: value => sent.push(JSON.parse(value)) }
  const connected = []
  exchange.on('connected', pair => connected.push(pair))
  await exchange.subscribe(api, 'BTC')
  assert.equal(sent[0].subscription.coin, 'BTC')
  assert.deepEqual(connected, [])
  exchange.onMessage({ data: JSON.stringify({ channel: 'subscriptionResponse', data: {
    method: 'subscribe', subscription: { type: 'trades', coin: 'ETH' }
  } }) }, api)
  assert.deepEqual(connected, [])
  exchange.onMessage({ data: JSON.stringify({ channel: 'subscriptionResponse', data: {
    method: 'subscribe', subscription: { type: 'trades', coin: 'BTC' }
  } }) }, api)
  assert.deepEqual(connected, ['BTC'])
})

test('Hyperliquid uses native trade identity, base size and USDT perp classification', () => {
  const exchange = new Hyperliquid()
  const trade = exchange.formatTrade(fill(1791112559579, 930656810436527, 'A'))
  assert.equal(trade.id, '1791112559579:BTC:930656810436527')
  assert.equal(trade.side, 'sell')
  assert.equal(trade.size, 0.005)
  assert.equal(trade.nativeQuantity, '0.005')
  assert.equal(trade.nativeUnit, 'base')
  assert.equal(trade.count, 1)
  const { base, quote, type, local } = parseMarket('HYPERLIQUID', 'BTC')
  assert.deepEqual({ base, quote, type, local },
    { base: 'BTC', quote: 'USDT', type: 'perp', local: 'BTCUSD' })
})

test('Hyperliquid recovers only a provably covered recent-trade range', async () => {
  const original = axios.post
  const exchange = new Hyperliquid()
  const observed = []
  exchange.emitTrades = (_, trades) => observed.push(...trades)
  const t = 1791112559000
  try {
    axios.post = async () => ({ data: [fill(t + 2, 3), fill(t + 1, 2), fill(t - 1, 1)] })
    const range = { pair: 'BTC', from: t, to: t + 3 }
    assert.equal(await exchange.getMissingTrades(range), 2)
    assert.equal(range.from, range.to)
    assert.deepEqual(observed.map(trade => trade.id), [`${t + 2}:BTC:3`, `${t + 1}:BTC:2`])
    axios.post = async () => ({ data: [fill(t + 2, 3), fill(t + 1, 2), fill(t, 1)] })
    await assert.rejects(exchange.getMissingTrades({ pair: 'BTC', from: t, to: t + 3 }),
      /do not cover/)
  } finally {
    axios.post = original
  }
})
