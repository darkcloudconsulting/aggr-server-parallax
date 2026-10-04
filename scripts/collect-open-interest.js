/* global fetch, AbortSignal */
// A small, independent sampler for the Grafana feed dashboard. It never
// modifies the trade collector or its journal.
const ASSETS = ['BTC', 'ETH', 'SOL']
const VENUES = ['BINANCE_FUTURES', 'BYBIT', 'OKEX', 'HYPERLIQUID']
const FIVE_MINUTES = 300000
const MAX_SOURCE_AGE = 120000

function positive(value, field) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) throw new Error(`invalid ${field}`)
  return number
}

function recent(value, observedAt) {
  const time = Number(value)
  if (!Number.isSafeInteger(time) || time > observedAt + 30000 ||
      observedAt - time > MAX_SOURCE_AGE) throw new Error('stale open interest source time')
  return time
}

function record(venue, asset, market, base, notional, mark, sourceTime, observedAt) {
  return { venue, asset, market,
    base: positive(base, 'base open interest'),
    notional_usd: positive(notional, 'notional open interest'),
    mark_price: positive(mark, 'mark price'),
    source_time_ms: recent(sourceTime, observedAt) }
}

function binance(asset, oi, mark, observedAt) {
  const symbol = asset + 'USDT'
  if (oi.symbol !== symbol || mark.symbol !== symbol) throw new Error('Binance symbol mismatch')
  const base = positive(oi.openInterest, 'Binance open interest')
  const price = positive(mark.markPrice, 'Binance mark price')
  return record('BINANCE_FUTURES', asset, `BINANCE_FUTURES:${symbol.toLowerCase()}`,
    base, base * price, price, Math.min(oi.time, mark.time), observedAt)
}

function bybit(asset, response, observedAt) {
  const symbol = asset + 'USDT'
  const ticker = response.result?.list?.[0]
  if (response.retCode !== 0 || response.result.category !== 'linear' ||
      ticker?.symbol !== symbol) throw new Error('Bybit ticker mismatch')
  // Bybit distinguishes both-side and single-side OI. Other venues' reported
  // OI is one-sided, so use the single-side fields for a comparable sum.
  const base = positive(ticker.singleOpenInterest, 'Bybit single-side open interest')
  const price = positive(ticker.markPrice, 'Bybit mark price')
  const notional = positive(ticker.singleOpenInterestValue,
    'Bybit single-side open interest value')
  if (Math.abs(positive(ticker.openInterest, 'Bybit both-side open interest') /
      (2 * base) - 1) > 0.05) {
    throw new Error('Bybit single-side open interest disagrees with both-side value')
  }
  if (Math.abs(notional / (base * price) - 1) > 0.05) {
    throw new Error('Bybit open interest value disagrees with base and mark price')
  }
  return record('BYBIT', asset, `BYBIT:${symbol}`, base, notional,
    price, observedAt, observedAt)
}

function okx(asset, oiResponse, markResponse, observedAt) {
  const market = `${asset}-USDT-SWAP`
  const oi = oiResponse.data?.[0]
  const mark = markResponse.data?.[0]
  if (oiResponse.code !== '0' || markResponse.code !== '0' ||
      oi?.instId !== market || mark?.instId !== market) throw new Error('OKX symbol mismatch')
  const base = positive(oi.oiCcy, 'OKX base open interest')
  const price = positive(mark.markPx, 'OKX mark price')
  const notional = positive(oi.oiUsd, 'OKX USD open interest')
  if (Math.abs(notional / (base * price) - 1) > 0.05) {
    throw new Error('OKX USD open interest disagrees with base and mark price')
  }
  return record('OKEX', asset, `OKEX:${market}`, base, notional, price,
    Math.min(Number(oi.ts), Number(mark.ts)), observedAt)
}

function hyperliquid(asset, response, observedAt) {
  const [meta, contexts] = response
  const index = meta?.universe?.findIndex(product => product.name === asset)
  if (index == null || index < 0) throw new Error('Hyperliquid perp missing')
  const context = contexts[index]
  const base = positive(context?.openInterest, 'Hyperliquid open interest')
  const price = positive(context?.markPx, 'Hyperliquid mark price')
  return record('HYPERLIQUID', asset, `HYPERLIQUID:${asset}`, base,
    base * price, price, observedAt, observedAt)
}

async function json(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(8000) })
  if (!response.ok) throw new Error(`${url} HTTP ${response.status}`)
  return response.json()
}

async function collectAsset(asset, observedAt = Date.now()) {
  const symbol = asset + 'USDT'
  const okxSymbol = `${asset}-USDT-SWAP`
  const [binanceOi, binanceMark, bybitTicker, okxOi, okxMark, hyperliquidMeta] =
    await Promise.all([
      json(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${symbol}`),
      json(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`),
      json(`https://api.bybit.com/v5/market/tickers?category=linear&symbol=${symbol}`),
      json(`https://www.okx.com/api/v5/public/open-interest?instType=SWAP&instId=${okxSymbol}`),
      json(`https://www.okx.com/api/v5/public/mark-price?instType=SWAP&instId=${okxSymbol}`),
      json('https://api.hyperliquid.xyz/info', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'metaAndAssetCtxs' })
      })
    ])
  return [
    binance(asset, binanceOi, binanceMark, observedAt),
    bybit(asset, bybitTicker, observedAt),
    okx(asset, okxOi, okxMark, observedAt),
    hyperliquid(asset, hyperliquidMeta, observedAt)
  ]
}

function lineProtocol(records, bucket) {
  const lines = []
  for (const asset of ASSETS) {
    const group = records.filter(row => row.asset === asset)
    if (!group.length) continue
    if (group.length !== VENUES.length ||
        VENUES.some(venue => !group.some(row => row.venue === venue))) {
      throw new Error(`incomplete ${asset} open interest coverage`)
    }
    for (const row of group) {
      lines.push(`open_interest,asset=${asset},venue=${row.venue},market=${row.market} ` +
        `base=${row.base},notional_usd=${row.notional_usd},mark_price=${row.mark_price},` +
        `source_time_ms=${row.source_time_ms}i ${bucket}`)
    }
    const total = group.reduce((sum, row) => sum + row.notional_usd, 0)
    lines.push(`open_interest_total,asset=${asset} ` +
      `notional_usd=${total},venues=${VENUES.length}i ${bucket}`)
  }
  return lines.join('\n') + '\n'
}

async function main() {
  const started = Date.now()
  const bucket = Math.floor(started / FIVE_MINUTES) * FIVE_MINUTES
  const results = await Promise.allSettled(ASSETS.map(asset => collectAsset(asset, started)))
  const records = results.flatMap(result => result.status === 'fulfilled' ? result.value : [])
  const failures = results.flatMap((result, index) => result.status === 'rejected'
    ? [`${ASSETS[index]}: ${result.reason.message}`] : [])
  if (records.length) {
    const body = lineProtocol(records, bucket)
    if (!process.argv.includes('--dry-run')) {
      const host = process.env.INFLUX_HOST || 'aggr-parallax-influx'
      const url = `http://${host}:8086/write?db=aggr_parallax&rp=aggr_5m&precision=ms`
      const response = await fetch(url, { method: 'POST', body,
        signal: AbortSignal.timeout(15000) })
      if (!response.ok) throw new Error(`Influx write HTTP ${response.status}: ${await response.text()}`)
    }
  }
  console.log(JSON.stringify({ bucket, assets: records.length / VENUES.length,
    markets: records.length, failures, dryRun: process.argv.includes('--dry-run') }))
  if (failures.length) process.exitCode = 1
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })

module.exports = { ASSETS, VENUES, binance, bybit, okx, hyperliquid, lineProtocol, collectAsset }
