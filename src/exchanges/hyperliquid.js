const Exchange = require('../exchange')
const { readProducts, saveProducts } = require('../services/catalog')
const axios = require('axios')

class Hyperliquid extends Exchange {
  constructor() {
    super()
    this.id = 'HYPERLIQUID'

    this.endpoints = {
      PRODUCTS: 'https://api.hyperliquid.xyz/info'
    }
  }

  async getUrl() {
    return 'wss://api.hyperliquid.xyz/ws'
  }

  // Custom getProducts implementation for POST API
  async getProducts(forceRefreshProducts = false) {
    let formatedProducts

    // Load from cache if not forcing refresh
    if (!forceRefreshProducts) {
      try {
        formatedProducts = await readProducts(this.id)
      } catch (error) {
        console.error(`[${this.id}/getProducts] failed to read products`, error)
      }
    }

    // Fetch new products if no cache available
    if (!formatedProducts) {
      try {
        console.log(`[${this.id}] fetching products via POST API`)

        const response = await axios.post(
          this.endpoints.PRODUCTS,
          { type: 'meta' },
          {
            headers: { 'Content-Type': 'application/json' }
          }
        )

        formatedProducts = this.formatProducts(response.data) || []

        // Save to cache
        await saveProducts(this.id, formatedProducts)
        console.log(
          `[${this.id}] saved ${
            formatedProducts.products?.length || 0
          } products`
        )
      } catch (error) {
        console.error(
          `[${this.id}/getProducts] failed to fetch products`,
          error.message
        )
        throw error
      }
    }

    // Set products to instance
    if (formatedProducts && formatedProducts.products) {
      this.products = formatedProducts.products
    }

    return this.products
  }

  formatProducts(response) {
    const products = []

    if (response && response.universe && response.universe.length) {
      for (const product of response.universe) {
        products.push(product.name)
      }
    }

    console.log(`[${this.id}] formatted ${products.length} products`)
    return { products }
  }

  /**
   * Sub
   * @param {WebSocket} api
   * @param {string} pair
   */
  async subscribe(api, pair) {
    // The base class marks a market connected immediately. Hyperliquid sends an
    // explicit subscriptionResponse, so wait for that before publishing health.
    if (api._pending.indexOf(pair) === -1) return false
    api.send(
      JSON.stringify({
        method: 'subscribe',
        subscription: {
          type: 'trades',
          coin: pair
        }
      })
    )

    return true
  }

  /**
   * Sub
   * @param {WebSocket} api
   * @param {string} pair
   */
  async unsubscribe(api, pair) {
    if (!(await super.unsubscribe.apply(this, arguments))) {
      return
    }

    api.send(
      JSON.stringify({
        method: 'unsubscribe',
        subscription: {
          type: 'trades',
          coin: pair
        }
      })
    )

    return true
  }

  onMessage(event, api) {
    const json = JSON.parse(event.data)

    if (json.channel === 'subscriptionResponse') {
      const { method, subscription } = json.data || {}
      if (method === 'subscribe' && subscription?.type === 'trades') {
        super.subscribe(api, subscription.coin)
      }
      return
    }

    if (json.channel === 'trades' && Array.isArray(json.data)) {
      return this.emitTrades(
        api.id,
        json.data
          .filter(trade => api._connected.indexOf(trade.coin) !== -1)
          .map(trade => this.formatTrade(trade))
      )
    }
  }

  formatTrade(trade) {
    if (!Number.isSafeInteger(trade.time) || !Number.isSafeInteger(trade.tid) ||
      !['B', 'A'].includes(trade.side) || !(+trade.px > 0) || !(+trade.sz > 0)) {
      throw new Error('Hyperliquid trade lacks a safe native time or tid')
    }
    return {
      exchange: this.id,
      pair: trade.coin,
      // Hyperliquid defines (block time, coin, tid) as globally unique.
      id: `${trade.time}:${trade.coin}:${trade.tid}`,
      timestamp: trade.time,
      price: +trade.px,
      size: +trade.sz,
      nativeQuantity: trade.sz,
      nativeUnit: 'base',
      count: 1,
      side: trade.side === 'B' ? 'buy' : 'sell'
    }
  }

  async getMissingTrades(range) {
    const response = await axios.post(this.endpoints.PRODUCTS, {
      type: 'recentTrades', coin: range.pair
    })
    const page = response.data
    if (!Array.isArray(page) || !page.length || !page.every(trade => Number.isSafeInteger(trade.time))) {
      throw new Error('Hyperliquid recent trades unavailable')
    }
    // recentTrades has no cursor and returns only ten fills. A strict earlier
    // boundary is required: equality can conceal other fills in that block.
    if (Math.min(...page.map(trade => trade.time)) >= range.from) {
      throw new Error('Hyperliquid recent trades do not cover the full recovery interval')
    }
    const trades = page
      .filter(trade => trade.time >= range.from && trade.time <= range.to)
      .map(trade => this.formatTrade(trade))
    if (trades.length) this.emitTrades(null, trades)
    range.from = range.to
    return trades.length
  }

  onApiCreated(api) {
    this.startKeepAlive(api, { method: 'ping' }, 30000)
  }

  onApiRemoved(api) {
    this.stopKeepAlive(api)
  }
}

module.exports = Hyperliquid
