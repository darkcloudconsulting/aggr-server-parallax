const Exchange = require('../exchange')
const axios = require('axios')

class Bitstamp extends Exchange {
  constructor() {
    super()

    this.id = 'BITSTAMP'

    this.endpoints = {
      PRODUCTS: 'https://www.bitstamp.net/api/v2/trading-pairs-info'
    }

    this.url = () => {
      return 'wss://ws.bitstamp.net'
    }
  }

  formatProducts(data) {
    return data.map(a => a.url_symbol)
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

    api.send(
      JSON.stringify({
        event: 'bts:subscribe',
        data: {
          channel: 'live_trades_' + pair
        }
      })
    )
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

    api.send(
      JSON.stringify({
        event: 'bts:unsubscribe',
        data: {
          channel: 'live_trades_' + pair
        }
      })
    )
  }

  onMessage(event, api) {
    // channel:"live_trades_btcusd"
    const json = JSON.parse(event.data)

    if (!json || !json.data || !json.data.amount) {
      return
    }

    const trade = json.data

    return this.emitTrades(api.id, [
      {
        exchange: this.id,
        pair: json.channel.split('_').pop(),
        id: trade.id,
        nativeQuantity: trade.amount,
        nativeUnit: 'base',
        timestamp: +new Date(trade.microtimestamp / 1000),
        price: trade.price,
        size: trade.amount,
        side: trade.type === 0 ? 'buy' : 'sell'
      }
    ])
  }

  async getMissingTrades(range) {
    const response = await axios.get(`https://www.bitstamp.net/api/v2/transactions/${range.pair}/`, {
      params: { time: 'day', limit: 1000 }
    })
    if (!Array.isArray(response.data)) throw new Error('Bitstamp transactions response invalid')
    const page = response.data
    const trades = page.filter(trade => +trade.date * 1000 >= range.from - 1000 && +trade.date * 1000 < range.to)
      .map(trade => ({ exchange: this.id, pair: range.pair, id: trade.tid,
        nativeQuantity: trade.amount, nativeUnit: 'base', timestamp: +trade.date * 1000,
        timestampPrecision: 's', price: +trade.price, size: +trade.amount,
        side: String(trade.type) === '0' ? 'buy' : 'sell' }))
    if (trades.length) this.emitTrades(null, trades)
    if (range.from < Date.now() - 24 * 3600000 ||
      (page.length >= 1000 && Math.min(...page.map(trade => +trade.date * 1000)) > range.from + 1000)) {
      throw new Error('Bitstamp recent transactions do not cover the full recovery interval')
    }
    range.from = range.to
    return trades.length
  }
}

module.exports = Bitstamp
