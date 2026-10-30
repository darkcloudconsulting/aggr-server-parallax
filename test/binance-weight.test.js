const test = require('node:test')
const assert = require('node:assert/strict')
const axios = require('axios')
const { RequestWeightBudget } = require('../src/binance-weight')
const BinanceFutures = require('../src/exchanges/binance_futures')

function clock(start) {
  const state = { t: start, slept: [] }
  state.now = () => state.t
  state.sleep = async ms => {
    state.slept.push(ms)
    state.t += ms
  }
  return state
}

const MINUTE = 60000 * 29_000_000

test('a request that fits under the cap goes out without waiting', async () => {
  const c = clock(MINUTE + 10000)
  const budget = new RequestWeightBudget({ label: 't', cap: 960, now: c.now, sleep: c.sleep })
  budget.record({ 'x-mbx-used-weight-1m': '940' })
  await budget.reserve(20)
  assert.deepEqual(c.slept, [])
})

test('a request over the cap waits for the next minute, then goes out on the reset', async () => {
  const c = clock(MINUTE + 10000)
  const budget = new RequestWeightBudget({ label: 't', cap: 960, now: c.now, sleep: c.sleep })
  budget.record({ 'x-mbx-used-weight-1m': '941' })
  let probes = 0
  await budget.reserve(20, async () => {
    probes++
    budget.record({ 'x-mbx-used-weight-1m': '7' })
  })
  assert.equal(c.slept.length, 1)
  assert.ok(c.now() >= MINUTE + 61000 && c.now() < MINUTE + 63000)
  assert.equal(probes, 1)
})

test('with no reading this minute the probe is asked first, and its reading decides', async () => {
  const c = clock(MINUTE + 30000)
  const budget = new RequestWeightBudget({ label: 't', cap: 960, now: c.now, sleep: c.sleep })
  let probes = 0
  await budget.reserve(20, async () => {
    probes++
    budget.record({ 'x-mbx-used-weight-1m': probes === 1 ? '1300' : '3' })
  })
  assert.equal(probes, 2)
  assert.equal(c.slept.length, 1)
})

test('a reading from the previous minute does not hold back this one', async () => {
  const c = clock(MINUTE + 59000)
  const budget = new RequestWeightBudget({ label: 't', cap: 960, now: c.now, sleep: c.sleep })
  budget.record({ 'x-mbx-used-weight-1m': '2000' })
  c.t += 2000
  await budget.reserve(20)
  assert.deepEqual(c.slept, [])
})

test('429 holds every request until Retry-After and at least the next minute, and may be retried', async () => {
  const c = clock(MINUTE + 50000)
  const budget = new RequestWeightBudget({ label: 't', cap: 960, now: c.now, sleep: c.sleep })
  const retry = budget.backOff({ response: { status: 429, headers: { 'retry-after': '3' } } })
  assert.equal(retry, true)
  assert.equal(budget.blockedUntil, MINUTE + 61000)
  await budget.reserve(20)
  assert.ok(c.now() >= MINUTE + 61000)
})

test('418 is never retried and holds requests for the whole ban', async () => {
  const c = clock(MINUTE)
  const budget = new RequestWeightBudget({ label: 't', cap: 960, now: c.now, sleep: c.sleep })
  assert.equal(budget.backOff({ response: { status: 418, headers: { 'retry-after': '120' } } }), false)
  assert.equal(budget.blockedUntil, MINUTE + 120000)
  assert.equal(budget.backOff(new Error('socket hang up')), false)
})

function futures(budget) {
  const exchange = new BinanceFutures()
  exchange.dapi = {}
  exchange.specs = {}
  exchange.recoveryBudget = () => budget
  return exchange
}

test('BinanceFutures retries a recovery page after a 429 and records the weight it sees', async () => {
  const c = clock(MINUTE + 20000)
  const budget = new RequestWeightBudget({ label: 't', cap: 960, now: c.now, sleep: c.sleep })
  const original = axios.get
  const urls = []
  let pages = 0
  axios.get = async url => {
    urls.push(url)
    if (url.endsWith('/fapi/v1/time')) return { data: {}, headers: { 'x-mbx-used-weight-1m': urls.length === 1 ? '300' : '5' } }
    if (++pages === 1) {
      const error = new Error('Request failed with status code 429')
      error.response = { status: 429, headers: {} }
      throw error
    }
    return { data: [{ a: 1 }], headers: { 'x-mbx-used-weight-1m': '45' } }
  }
  try {
    const page = await futures(budget).getRecoveryPage('https://fapi.binance.com/fapi/v1/aggTrades', { symbol: 'BTCUSDT' })
    assert.deepEqual(page, [{ a: 1 }])
    assert.equal(urls[0], 'https://fapi.binance.com/fapi/v1/time')
    assert.equal(pages, 2)
    assert.equal(budget.used, 45)
    assert.ok(c.now() >= MINUTE + 61000)
  } finally {
    axios.get = original
  }
})

test('BinanceFutures gives up a page after three 429s and never retries a 418', async () => {
  for (const [status, expected] of [[429, 3], [418, 1]]) {
    const c = clock(MINUTE)
    const budget = new RequestWeightBudget({ label: 't', cap: 960, now: c.now, sleep: c.sleep })
    const original = axios.get
    let pages = 0
    axios.get = async url => {
      if (url.endsWith('/v1/time')) return { data: {}, headers: { 'x-mbx-used-weight-1m': '10' } }
      pages++
      const error = new Error(`status ${status}`)
      error.response = { status, headers: { 'retry-after': '1' } }
      throw error
    }
    try {
      await assert.rejects(futures(budget).getRecoveryPage('https://dapi.binance.com/dapi/v1/aggTrades', {}))
      assert.equal(pages, expected)
    } finally {
      axios.get = original
    }
  }
})
