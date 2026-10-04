const Exchange = require('../exchange')
const axios = require('axios')
const { getHms } = require('../helper')

const SPOT_PAIR_REGEX = /-SPOT$/
const TRADE_TOPIC_REGEX = /^publicTrade\./
const SPOT_WS = 'wss://stream.bybit.com/v5/public/spot'
const LINEAR_WS = 'wss://stream.bybit.com/v5/public/linear'
const INVERSE_WS = 'wss://stream.bybit.com/v5/public/inverse'
const RECENT_TRADE_REST = 'https://api.bybit.com/v5/market/recent-trade'

class Bybit extends Exchange {
  constructor() {
    super()

    this.id = 'BYBIT'

    this.endpoints = {
      PRODUCTS: [
        'https://api.bybit.com/v5/market/instruments-info?category=spot', // BTCUSDT -> BTCUSDT-SPOT
        ...['BTC', 'ETH', 'SOL'].map(base =>
          `https://api.bybit.com/v5/market/instruments-info?category=linear&baseCoin=${base}&limit=1000`),
        ...['BTC', 'ETH', 'SOL'].map(base =>
          `https://api.bybit.com/v5/market/instruments-info?category=inverse&baseCoin=${base}&limit=1000`)
      ]
    }

    this.url = pair => {
      if (this.types[pair] === 'spot') {
        return SPOT_WS
      }

      if (this.types[pair] === 'linear') {
        return LINEAR_WS
      }

      return INVERSE_WS
    }
  }

  formatProducts(response) {
    const products = []
    const types = {}

    for (let i = 0; i < response.length; i++) {
      const data = response[i]
      const type = i === 0 ? 'spot' : i <= 3 ? 'linear' : 'inverse'

      for (const product of data.result.list) {
        if (product.status !== 'Trading') continue
        if (type === 'inverse' && !product.contractType.startsWith('Inverse')) continue
        if (type === 'linear' && !product.contractType.startsWith('Linear')) continue
        const symbol = `${product.symbol}${type === 'spot' ? '-SPOT' : ''}`

        if (!types[symbol]) products.push(symbol)
        types[symbol] = type
      }
    }

    return {
      products,
      types
    }
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

    const isSpot = this.types[pair] === 'spot'
    const realPair = isSpot ? pair.replace(SPOT_PAIR_REGEX, '') : pair
    const topics = [
      `publicTrade.${realPair}`,
    ]

    if (!isSpot) {
      topics.push(`allLiquidation.${realPair}`)
    }

    api.send(
      JSON.stringify({
        'op': 'subscribe',
        args: topics
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

    const isSpot = this.types[pair] === 'spot'
    const realPair = isSpot ? pair.replace(SPOT_PAIR_REGEX, '') : pair
    const topics = [
      `publicTrade.${realPair}`,
    ]

    if (!isSpot) {
      topics.push(`allLiquidation.${realPair}`)
    }

    api.send(
      JSON.stringify({
        'op': 'unsubscribe',
        args: topics
      })
    )
  }

  formatTrade(trade, isSpot) {
    let size = +trade.v
    let pair = trade.s

    if (!isSpot && this.types[trade.s] === 'inverse') {
      size /= trade.p
    } else if (isSpot) {
      pair += '-SPOT'
    }

    return {
      exchange: this.id,
      pair,
      id: trade.i,
      nativeQuantity: trade.v,
      nativeUnit: !isSpot && this.types[trade.s] === 'inverse' ? 'quote_contracts' : 'base',
      timestamp: +trade.T,
      price: +trade.p,
      size,
      side: trade.S === 'Buy' ? 'buy' : 'sell'
    }
  }

  formatLiquidation(liquidation) {
    let size = +liquidation.v

    if (this.types[liquidation.s] === 'inverse') {
      size /= liquidation.p
    }

    return {
      exchange: this.id,
      pair: liquidation.s,
      timestamp: +liquidation.T,
      size,
      price: +liquidation.p,
      side: liquidation.S === 'Buy' ? 'sell' : 'buy',
      liquidation: true
    }
  }

  onMessage(event, api) {
    const json = JSON.parse(event.data)

    if (!json.data || !json.topic) {
      return
    }

    if (TRADE_TOPIC_REGEX.test(json.topic)) {
      const isSpot = api.url === SPOT_WS

      return this.emitTrades(
        api.id,
        json.data.map(trade => this.formatTrade(trade, isSpot))
      )
    } else {
      return this.emitLiquidations(
        api.id,
        json.data.map(liquidation => this.formatLiquidation(liquidation))
      )
    }
  }

  async getMissingTrades(range, totalRecovered = 0) {
    const type = this.types[range.pair]
    const isSpot = type === 'spot'
    const limit = isSpot ? 60 : 1000
    const realPair = isSpot ? range.pair.replace(SPOT_PAIR_REGEX, '') : range.pair
    const endpoint = `${RECENT_TRADE_REST}?category=${this.types[range.pair]}&symbol=${realPair}&limit=${limit}`

    return axios
      .get(endpoint)
      .then(response => {
        if (response.data.result.list.length) {
          const trades = response.data.result.list
            .filter(trade => trade.time > range.from && trade.time <= range.to)
            .map(trade => this.formatTrade({
              i: trade.execId,
              T: trade.time,
              s: trade.symbol,
              p: trade.price,
              v: trade.size,
              S: trade.side,
            }, isSpot))

          if (trades.length) {
            this.emitTrades(null, trades)

            totalRecovered += trades.length
            range.to = trades[trades.length - 1].timestamp
          }

          const remainingMissingTime = range.to - range.from

          if (
            trades.length &&
            remainingMissingTime > 500
          ) {
            console.log(
              `[${this.id}.recoverMissingTrades] +${trades.length} ${
                range.pair
              } ... and should be more (${getHms(remainingMissingTime)} remaining)`
            )
          } else {
            console.log(
              `[${this.id}.recoverMissingTrades] +${trades.length} ${range.pair}`
            )
          }
        }

        return totalRecovered
      })
      .catch(err => {
        console.error(
          `[${this.id}] failed to get missing trades on ${range.pair}`,
          err.message
        )

        return totalRecovered
      })
  }

  onApiCreated(api) {
    this.startKeepAlive(api, { op: 'ping' }, 20000)
  }

  onApiRemoved(api) {
    this.stopKeepAlive(api)
  }
}

module.exports = Bybit
