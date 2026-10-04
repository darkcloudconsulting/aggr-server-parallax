const test = require('node:test')
const assert = require('node:assert/strict')
const { binance, bybit, okx, hyperliquid, lineProtocol } =
  require('../scripts/collect-open-interest')

const NOW = 1791116400000

test('open interest normalizes base and quote units for four perpetual venues', () => {
  const b = binance('BTC', { symbol: 'BTCUSDT', openInterest: '2', time: NOW - 1000 },
    { symbol: 'BTCUSDT', markPrice: '80000', time: NOW - 500 }, NOW)
  const y = bybit('BTC', { retCode: 0, result: { category: 'linear', list: [
    { symbol: 'BTCUSDT', openInterest: '6', openInterestValue: '480000',
      singleOpenInterest: '3', singleOpenInterestValue: '240000', markPrice: '80000' }
  ] } }, NOW)
  const o = okx('BTC', { code: '0', data: [
    { instId: 'BTC-USDT-SWAP', oiCcy: '4', oiUsd: '320000', ts: NOW - 1000 }
  ] }, { code: '0', data: [
    { instId: 'BTC-USDT-SWAP', markPx: '80000', ts: NOW - 500 }
  ] }, NOW)
  const h = hyperliquid('BTC', [{ universe: [{ name: 'BTC' }] },
    [{ openInterest: '5', markPx: '80000' }]], NOW)
  assert.deepEqual([b, y, o, h].map(x => x.base), [2, 3, 4, 5])
  assert.deepEqual([b, y, o, h].map(x => x.notional_usd),
    [160000, 240000, 320000, 400000])
  assert.deepEqual([b, y, o, h].map(x => x.market),
    ['BINANCE_FUTURES:btcusdt', 'BYBIT:BTCUSDT',
      'OKEX:BTC-USDT-SWAP', 'HYPERLIQUID:BTC'])
  const lines = lineProtocol([b, y, o, h], NOW).trim().split('\n')
  assert.equal(lines.length, 5)
  assert.match(lines.at(-1), /notional_usd=1120000,venues=4i/)
})

test('open interest rejects stale values, wrong markets and incomplete sums', () => {
  assert.throws(() => binance('BTC',
    { symbol: 'BTCUSDT', openInterest: '2', time: NOW - 300000 },
    { symbol: 'BTCUSDT', markPrice: '80000', time: NOW }, NOW), /stale/)
  assert.throws(() => bybit('BTC', { retCode: 0, result: { category: 'linear',
    list: [{ symbol: 'ETHUSDT', openInterest: '6',
      singleOpenInterest: '3', singleOpenInterestValue: '240000',
      openInterestValue: '480000', markPrice: '80000' }] } }, NOW), /mismatch/)
  assert.throws(() => lineProtocol([binance('BTC',
    { symbol: 'BTCUSDT', openInterest: '2', time: NOW },
    { symbol: 'BTCUSDT', markPrice: '80000', time: NOW }, NOW)], NOW),
  /incomplete/)
})
