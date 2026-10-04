const Exchange = require('../exchange')
const { sleep } = require('../helper')
const axios = require('axios')

const SPOT_PAIR_REGEX = /-SPOT$/

class Bitget extends Exchange {
  constructor() {
    super()

    this.id = 'BITGET'
    this.maxConnectionsPerApi = 50

    this.endpoints = {
      PRODUCTS: [
        'https://api.bitget.com/api/v3/market/instruments?category=SPOT',
        'https://api.bitget.com/api/v3/market/instruments?category=USDT-FUTURES',
        'https://api.bitget.com/api/v3/market/instruments?category=COIN-FUTURES',
        'https://api.bitget.com/api/v3/market/instruments?category=USDC-FUTURES'
      ]
    }

    // UTA websocket public channels (publicTrade + liquidation)
    this.url = () => 'wss://ws.bitget.com/v3/ws/public'
  }

  formatProducts(responses) {
    const types = {}

    const categories = ['spot', 'usdt-futures', 'coin-futures', 'usdc-futures']

    for (let i = 0; i < responses.length; i++) {
      const response = responses[i]
      const type = categories[i]

      for (const product of response.data) {
        const symbol = this.formatRemoteToLocalPair(product.symbol, type)

        types[symbol] = type
      }
    }

    const products = Object.keys(types)

    return {
      products,
      types
    }
  }

  getLiquidationArgs() {
    return ['usdt-futures', 'coin-futures', 'usdc-futures'].map(instType => ({
      instType,
      topic: 'liquidation'
    }))
  }

  formatRemoteToLocalPair(pair, type) {
    return type === 'spot'
      ? `${pair}-SPOT`
      : type === 'coin-futures'
        ? pair.replace(/_CM$/, '')
        : pair
  }

  formatLocalToRemotePair(pair, type) {
    return type === 'spot'
      ? pair.replace(SPOT_PAIR_REGEX, '')
      : type === 'coin-futures'
        ? `${pair}_CM`
        : pair
  }

  hasConnectedFuturesPairs(api) {
    return api._connected.some(pair => this.types[pair] && this.types[pair] !== 'spot')
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

    const type = this.types[pair].toLowerCase()
    const isSpot = type === 'spot'
    const wsSymbol = this.formatLocalToRemotePair(pair, type)

    api.send(
      JSON.stringify({
        op: 'subscribe',
        args: [
          {
            instType: type,
            topic: 'publicTrade',
            symbol: wsSymbol
          }
        ]
      })
    )

    if (!isSpot && !api._liquidationSubscribed) {
      const payload = {
        op: 'subscribe',
        args: this.getLiquidationArgs()
      }
      api.send(
        JSON.stringify(payload)
      )

      api._liquidationSubscribed = true
    }

    // this websocket api have a limit of about 10 messages per second.
    await sleep(150)
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

    const type = this.types[pair].toLowerCase()
    const wsSymbol = this.formatLocalToRemotePair(pair, type)

    api.send(
      JSON.stringify({
        op: 'unsubscribe',
        args: [
          {
            instType: type,
            topic: 'publicTrade',
            symbol: wsSymbol
          }
        ]
      })
    )

    if (api._liquidationSubscribed && !this.hasConnectedFuturesPairs(api)) {
      api.send(
        JSON.stringify({
          op: 'unsubscribe',
          args: this.getLiquidationArgs()
        })
      )

      api._liquidationSubscribed = false
    }

    // this websocket api have a limit of about 10 messages per second.
    await sleep(150)
  }

  formatTrade(trade, pair, instType) {
    // UTA publicTrade format: { p, v, S, T }
    const price = trade.p !== undefined ? trade.p : trade.px !== undefined ? trade.px : trade.price
    let size = trade.v !== undefined ? trade.v : trade.sz !== undefined ? trade.sz : trade.size
    const side = trade.S !== undefined ? trade.S : trade.side
    const timestamp = trade.T !== undefined ? trade.T : trade.ts
    const numericPrice = +price

    // UTA coin-futures publicTrade uses quote-value contracts; convert to base size.
    if (instType === 'coin-futures' && numericPrice > 0) {
      size = +size / numericPrice
    }

    return {
      exchange: this.id,
      pair,
      id: trade.i !== undefined ? trade.i : trade.tradeId !== undefined ? trade.tradeId : trade.id,
      nativeQuantity: trade.v !== undefined ? trade.v : trade.sz,
      nativeUnit: instType === 'coin-futures' ? 'quote_contracts' : 'base',
      timestamp: +timestamp,
      price: numericPrice,
      size: +size,
      side: typeof side === 'string' ? side.toLowerCase() : side
    }
  }

  formatLiquidation(liquidation, pair) {
    const price = +liquidation.price
    // Liquidation amount unit is quote coin; convert to base size.
    const size = price > 0 ? +liquidation.amount / price : +liquidation.amount

    return {
      exchange: this.id,
      pair,
      timestamp: +liquidation.ts,
      price,
      size,
      side: liquidation.side === 'buy' ? 'sell' : 'buy',
      liquidation: true
    }
  }

  onMessage(event, api) {
    if (event.data === 'pong') {
      return
    }

    const json = JSON.parse(event.data)

    if (!json.arg || !json.data || !json.data.length) {
      return
    }

    if (json.arg.topic === 'publicTrade') {
      // Ignore historical trades sent after subscription.
      if (json.action !== 'update') {
        return
      }

      const wsInstType = json.arg.instType
      const wsSymbol = json.arg.symbol
      const pair = this.formatRemoteToLocalPair(wsSymbol, wsInstType)

      return this.emitTrades(
        api.id,
        json.data.map(trade => this.formatTrade(trade, pair, wsInstType))
      )
    }

    if (json.arg.topic === 'liquidation') {
      const wsInstType = json.arg.instType
      const liquidations = []

      for (const liquidation of json.data) {
        const pair = this.formatRemoteToLocalPair(liquidation.symbol, wsInstType)

        if (api._connected.indexOf(pair) === -1) {
          continue
        }

        liquidations.push(this.formatLiquidation(liquidation, pair))
      }

      if (liquidations.length) {
        return this.emitLiquidations(api.id, liquidations)
      }
    }
  }

  async getMissingTrades(range) {
    const type = this.types[range.pair]
    const symbol = this.formatLocalToRemotePair(range.pair, type)
    const response = await axios.get('https://api.bitget.com/api/v3/market/fills', {
      params: { category: type.toUpperCase(), symbol, limit: 100 }
    })
    if (response.data.code !== '00000' || !Array.isArray(response.data.data)) {
      throw new Error(`Bitget fills rejected: ${response.data.msg || response.data.code}`)
    }
    const page = response.data.data
    const trades = page.filter(trade => +trade.ts > range.from && +trade.ts < range.to)
      .map(trade => this.formatTrade({ i: trade.execId, p: trade.price,
        v: trade.size, S: trade.side, T: trade.ts }, range.pair, type))
    if (trades.length) this.emitTrades(null, trades)
    if (page.length === 100 && Math.min(...page.map(trade => +trade.ts)) > range.from) {
      throw new Error('Bitget recent fills do not cover the full recovery interval')
    }
    range.from = range.to
    return trades.length
  }

  onApiCreated(api) {
    api._liquidationSubscribed = false
    this.startKeepAlive(api, 'ping', 30000)
  }

  onApiRemoved(api) {
    this.stopKeepAlive(api)
  }
}

module.exports = Bitget
