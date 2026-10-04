const Exchange = require('../exchange')
const { sleep, getHms } = require('../helper')
const axios = require('axios')

class Binance extends Exchange {
  constructor() {
    super()

    this.id = 'BINANCE'
    this.lastSubscriptionId = 0
    this.maxConnectionsPerApi = 16
    this.subscriptions = {}

    this.endpoints = {
      PRODUCTS: 'https://data-api.binance.vision/api/v3/exchangeInfo'
    }

    this.url = () => 'wss://data-stream.binance.vision:9443/ws'
  }

  formatProducts(data) {
    return data.symbols.map(a => a.symbol.toLowerCase())
  }

  /**
   * Sub
   * @param {WebSocket} api
   * @param {string} pair
   */
  async subscribe(api, pair) {
    if (!(await super.subscribe.apply(this, arguments))) {
      return
    }

    this.subscriptions[pair] = ++this.lastSubscriptionId

    // Use the same aggregate identity as the public recovery endpoint.
    const params = [pair + '@aggTrade']

    api.send(
      JSON.stringify({
        method: 'SUBSCRIBE',
        params,
        id: this.subscriptions[pair]
      })
    )

    // this websocket api have a limit of about 5 messages per second.
    await sleep(250 * this.apis.length)
  }

  /**
   * Unsub
   * @param {WebSocket} api
   * @param {string} pair
   */
  async unsubscribe(api, pair) {
    if (!(await super.unsubscribe.apply(this, arguments))) {
      return
    }

    const params = [pair + '@aggTrade']

    api.send(
      JSON.stringify({
        method: 'UNSUBSCRIBE',
        params,
        id: this.subscriptions[pair]
      })
    )

    delete this.subscriptions[pair]

    // this websocket api have a limit of about 5 messages per second.
    await sleep(250 * this.apis.length)
  }

  onMessage(event, api) {
    const json = JSON.parse(event.data)

    if (json.e === 'aggTrade') {
      return this.emitTrades(api.id, [
        this.formatTrade(json, json.s.toLowerCase())
      ])
    }
  }

  formatTrade(trade, symbol) {
    return {
      exchange: this.id,
      pair: symbol,
      id: trade.t !== undefined ? trade.t : trade.a,
      count: trade.l !== undefined && trade.f !== undefined ? trade.l - trade.f + 1 : 1,
      nativeQuantity: trade.q,
      nativeUnit: 'base',
      timestamp: trade.T,
      price: +trade.p,
      size: +trade.q,
      side: trade.m ? 'sell' : 'buy'
    }
  }

  async getMissingTrades(range) {
    let recovered = 0
    for (let start = range.from; start < range.to; start += 3599000) {
      const end = Math.min(range.to, start + 3599000)
      let fromId = null
      for (;;) {
        const params = { symbol: range.pair.toUpperCase(), limit: 1000 }
        if (fromId === null) {
          params.startTime = start
          params.endTime = end
        } else {
          params.fromId = fromId
        }
        const response = await axios.get('https://data-api.binance.vision/api/v3/aggTrades', { params })
        const page = response.data
        if (!page.length) break
        const trades = page.filter(trade => trade.T > range.from && trade.T < range.to)
          .map(trade => this.formatTrade(trade, range.pair))
        if (trades.length) this.emitTrades(null, trades)
        recovered += trades.length
        const last = page[page.length - 1]
        if (page.length < 1000 || last.T > end) break
        const next = Number(last.a) + 1
        if (!Number.isSafeInteger(next) || next === fromId) throw new Error('Binance aggregate ID did not advance')
        fromId = next
        await this.waitBeforeContinueRecovery()
      }
      range.from = end
    }
    console.log(`[${this.id}.recoverMissingTrades] +${recovered} ${range.pair} (${getHms(range.to - range.from)} remaining)`)
    return recovered
  }
}

module.exports = Binance
