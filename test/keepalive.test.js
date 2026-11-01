const test = require('node:test')
const assert = require('node:assert/strict')
const config = require('../src/config')
const Bybit = require('../src/exchanges/bybit')

const OPEN = 1

function fakeApi() {
  return { id: 'test-' + Math.random(), url: 'wss://example', readyState: OPEN, sent: [],
    send(m) { this.sent.push(m) }, _lastFrameAt: Date.now() }
}

async function run(feedFrames) {
  const saved = config.keepAliveSilenceThreshold
  config.keepAliveSilenceThreshold = 60
  const exchange = new Bybit()
  const reconnects = []
  exchange.reconnectApi = (api, reason) => reconnects.push(reason)
  const api = fakeApi()
  const feeder = feedFrames ? setInterval(() => { api._lastFrameAt = Date.now() }, 10) : null
  try {
    exchange.startKeepAlive(api, { op: 'ping' }, 20)
    await new Promise(resolve => setTimeout(resolve, 200))
  } finally {
    clearInterval(feeder)
    exchange.stopKeepAlive(api)
    config.keepAliveSilenceThreshold = saved
  }
  return { api, reconnects }
}

test('a socket that receives nothing, not even pongs, is reconnected once', async () => {
  const { reconnects } = await run(false)
  assert.equal(reconnects.length, 1)
  assert.match(reconnects[0], /no frame for/)
})

test('a quiet market that still answers pings is left alone', async () => {
  const { api, reconnects } = await run(true)
  assert.equal(reconnects.length, 0)
  assert.ok(api.sent.length >= 5)
})
