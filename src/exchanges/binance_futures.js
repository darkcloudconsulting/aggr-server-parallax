const Exchange = require('../exchange')
const { sleep, getHms } = require('../helper')
const axios = require('axios')
const WebSocket = require('websocket').w3cwebsocket

class BinanceFutures extends Exchange {
  constructor() {
    super()

    this.id = 'BINANCE_FUTURES'
    this.lastSubscriptionId = 0
    this.subscriptions = {}

    this.maxConnectionsPerApi = 100
    this.endpoints = {
      PRODUCTS: [
        'https://fapi.binance.com/fapi/v1/exchangeInfo',
        'https://dapi.binance.com/dapi/v1/exchangeInfo'
      ]
    }

    this.url = pair => {
      if (this.dapi[pair]) {
        return 'wss://dstream.binance.com/ws'
      }

      return 'wss://fstream.binance.com/market/ws'
    }
  }

  isDapiApi(api) {
    return api.url.includes('dstream.binance.com')
  }

  formatProducts(response) {
    const products = []
    const specs = {}
    const dapi = {}

    for (const data of response) {
      const type = ['fapi', 'dapi'][response.indexOf(data)]

      for (const product of data.symbols) {
        if (
          (product.contractStatus && product.contractStatus !== 'TRADING') ||
          (product.status && product.status !== 'TRADING')
        ) {
          continue
        }

        const symbol = product.symbol.toLowerCase()

        if (type === 'dapi') {
          dapi[symbol] = true
        }

        if (product.contractSize) {
          specs[symbol] = product.contractSize
        }

        products.push(symbol)
      }
    }

    return {
      products,
      specs,
      dapi
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

    this.subscriptions[pair] = ++this.lastSubscriptionId

    const params = this.dapi[pair]
      ? [pair + '@aggTrade', pair + '@forceOrder']
      : [pair + '@aggTrade']

    api.send(
      JSON.stringify({
        method: 'SUBSCRIBE',
        params,
        id: this.subscriptions[pair]
      })
    )

    if (!this.dapi[pair]) {
      this.subscribeLiquidations(api, pair)
    }

    // this websocket api has a limit of about 5 messages per second.
    await sleep(500 * this.apis.length)
  }

  /**
   * Unsub
   * @param {WebSocket} api
   * @param {string} pair
   */
  async unsubscribe(api, pair) {
    if (!(await super.unsubscribe.apply(this, arguments))) {
      delete this.subscriptions[pair]

      if (!this.dapi[pair]) {
        this.unsubscribeLiquidations(api, pair)
      }

      return
    }

    const params = this.dapi[pair]
      ? [pair + '@aggTrade', pair + '@forceOrder']
      : [pair + '@aggTrade']

    api.send(
      JSON.stringify({
        method: 'UNSUBSCRIBE',
        params,
        id: this.subscriptions[pair]
      })
    )

    delete this.subscriptions[pair]

    if (!this.dapi[pair]) {
      this.unsubscribeLiquidations(api, pair)
    }

    // this websocket api has a limit of about 5 messages per second.
    await sleep(500 * this.apis.length)
  }

  onMessage(event, api) {
    const json = JSON.parse(event.data)

    if (!json) {
      return
    }

    // Binance SUBSCRIBE / UNSUBSCRIBE ack
    if (json.result === null && typeof json.id !== 'undefined') {
      return true
    }

    if (
      json.e === 'aggTrade' &&
      (!json.X || json.X === 'MARKET' || json.X === 'RPI')
    ) {
      return this.emitTrades(api.id, [
        this.formatTrade(json, json.s.toLowerCase())
      ])
    }

    if (json.e === 'forceOrder') {
      return this.emitLiquidations(api.id, [this.formatLiquidation(json)])
    }
  }

  getSize(qty, price, symbol) {
    let size = +qty

    if (typeof this.specs[symbol] === 'number') {
      size = (size * this.specs[symbol]) / price
    }

    return size
  }

  /**
   *
   * @param {} trade
   * @param {*} symbol
   * @return {Trade}
   */
  formatTrade(trade, symbol) {
    return {
      exchange: this.id,
      pair: symbol,
      id: trade.t !== undefined ? trade.t : trade.a,
      count: trade.l !== undefined && trade.f !== undefined ? trade.l - trade.f + 1 : 1,
      nativeQuantity: trade.q,
      nativeUnit: this.dapi && this.dapi[symbol] ? 'contracts' : 'base',
      timestamp: trade.T,
      price: +trade.p,
      size: this.getSize(trade.q, trade.p, symbol),
      side: trade.m ? 'sell' : 'buy'
    }
  }

  formatLiquidation(trade) {
    const symbol = trade.o.s.toLowerCase()

    return {
      exchange: this.id,
      pair: symbol,
      timestamp: trade.o.T,
      price: +trade.o.p,
      size: this.getSize(trade.o.q, trade.o.p, symbol),
      side: trade.o.S === 'BUY' ? 'buy' : 'sell',
      liquidation: true
    }
  }

  async getMissingTrades(range) {
    const url = this.dapi[range.pair]
      ? 'https://dapi.binance.com/dapi/v1/aggTrades'
      : 'https://fapi.binance.com/fapi/v1/aggTrades'
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
        const page = (await axios.get(url, { params })).data
        if (!page.length) break
        const trades = page.filter(trade => trade.T > range.from && trade.T < range.to)
          .map(trade => this.formatTrade(trade, range.pair))
        if (trades.length) this.emitTrades(null, trades)
        recovered += trades.length
        const last = page[page.length - 1]
        if (page.length < 1000 || last.T > end) break
        const next = Number(last.a) + 1
        if (!Number.isSafeInteger(next) || next === fromId) throw new Error('Binance futures aggregate ID did not advance')
        fromId = next
        await this.waitBeforeContinueRecovery()
      }
      range.from = end
    }
    console.log(`[${this.id}.recoverMissingTrades] +${recovered} ${range.pair} (${getHms(range.to - range.from)} remaining)`)
    return recovered
  }

  openLiquidationApi(api) {
    if (this.isDapiApi(api)) {
      return
    }

    if (
      api._liquidationApi &&
      (
        api._liquidationApi.readyState === WebSocket.OPEN ||
        api._liquidationApi.readyState === WebSocket.CONNECTING
      )
    ) {
      return
    }

    api._liquidationApiClosing = false
    api._liquidationApi = new WebSocket('wss://fstream.binance.com/market/ws')

    api._liquidationApi.onopen = () => {
      for (const pair of api._connected) {
        this.subscribeLiquidations(api, pair)
      }
    }

    api._liquidationApi.onmessage = event => this.onMessage(event, api)

    api._liquidationApi.onclose = () => {
      api._liquidationApi = null

      for (const pair of api._connected || []) {
        delete this.subscriptions[pair + '@forceOrder']
      }

      if (api._liquidationApiClosing) {
        return
      }

      if (api.readyState === WebSocket.OPEN) {
        console.log(
          `[${this.id}] liquidation api closed unexpectedly, reopen now`
        )

        this.openLiquidationApi(api)
      }
    }

    api._liquidationApi.onerror = event => {
      console.error(
        `[${this.id}] liquidation api errored`,
        event.message || ''
      )
    }
  }

  subscribeLiquidations(api, pair) {
    if (this.dapi[pair]) {
      return
    }

    if (
      !api._liquidationApi ||
      api._liquidationApi.readyState !== WebSocket.OPEN
    ) {
      return
    }

    const param = pair + '@forceOrder'

    if (this.subscriptions[param]) {
      return
    }

    this.subscriptions[param] = ++this.lastSubscriptionId

    api._liquidationApi.send(
      JSON.stringify({
        method: 'SUBSCRIBE',
        params: [param],
        id: this.subscriptions[param]
      })
    )
  }

  unsubscribeLiquidations(api, pair) {
    if (this.dapi[pair]) {
      return
    }

    const param = pair + '@forceOrder'

    if (
      !this.subscriptions[param] ||
      !api._liquidationApi ||
      api._liquidationApi.readyState !== WebSocket.OPEN
    ) {
      delete this.subscriptions[param]
      return
    }

    api._liquidationApi.send(
      JSON.stringify({
        method: 'UNSUBSCRIBE',
        params: [param],
        id: this.subscriptions[param]
      })
    )

    delete this.subscriptions[param]
  }

  onApiCreated(api) {
    api._liquidationApiClosing = false
    this.openLiquidationApi(api)
  }

  onApiRemoved(api) {
    api._liquidationApiClosing = true

    if (
      api._liquidationApi &&
      (
        api._liquidationApi.readyState === WebSocket.OPEN ||
        api._liquidationApi.readyState === WebSocket.CONNECTING
      )
    ) {
      api._liquidationApi.close()
    }
  }
}

module.exports = BinanceFutures
