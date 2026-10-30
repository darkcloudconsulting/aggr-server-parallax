/**
 * Binance counts request weight per public IP per calendar minute, and every client on
 * this site shares one IP: the Kafka publishers, the store's repair job and REST probe,
 * and this server. A publisher that is answered HTTP 429 stops polling for good.
 *
 * On 2026-10-30 at 00:19 UTC this server's trade recovery after a 30 s blackout fetched
 * about 56 aggTrades pages (20 weight each) in 27 s and took the IP from ~300 to 2,366
 * of 2,400; two publishers were answered 429 and Binance futures deep books were lost
 * for seven hours. Recovery is a bulk client, so it now takes only what is left below
 * a cap of the IP's total and waits for the next minute otherwise.
 */
const WEIGHT_HEADER = 'x-mbx-used-weight-1m'

class RequestWeightBudget {
  constructor({ label, cap, now = Date.now, sleep }) {
    this.label = label
    this.cap = cap
    this.now = now
    this.sleep = sleep
    this.minute = null
    this.used = 0
    this.blockedUntil = 0
  }

  currentMinute() {
    return Math.floor(this.now() / 60000)
  }

  hasReading() {
    return this.minute === this.currentMinute()
  }

  record(headers) {
    const used = Number(headers && headers[WEIGHT_HEADER])
    if (!Number.isFinite(used)) {
      return
    }
    const minute = this.currentMinute()
    if (this.minute !== minute) {
      this.minute = minute
      this.used = used
    } else {
      this.used = Math.max(this.used, used)
    }
  }

  /**
   * Wait until a request of `cost` fits under the cap. `probe` (a weight-1 request that
   * records its headers) is called when there is no reading for this minute yet, so the
   * first page of a minute does not go out blind into an IP others have already used.
   */
  async reserve(cost, probe) {
    for (;;) {
      if (this.now() < this.blockedUntil) {
        const wait = this.blockedUntil - this.now()
        console.log(`[${this.label}] backing off after a rate-limit answer: waiting ${Math.ceil(wait / 1000)}s`)
        await this.sleep(wait)
        continue
      }
      if (!this.hasReading() && probe) {
        await probe()
      }
      if (!this.hasReading() || this.used + cost <= this.cap) {
        return
      }
      const wait = (this.minute + 1) * 60000 - this.now() + 1000 + Math.floor(Math.random() * 2000)
      console.log(
        `[${this.label}] IP at ${this.used} of 2400 weight this minute (recovery stops at ${this.cap}): waiting ${Math.ceil(wait / 1000)}s for the next minute`
      )
      await this.sleep(wait)
    }
  }

  /**
   * After a 429 or 418, hold every request of this budget until Retry-After has passed,
   * and at least until the next minute. Returns true when the request may be retried:
   * a 418 means Binance has banned the IP for not backing off, so it is never retried.
   */
  backOff(error) {
    const status = error && error.response && error.response.status
    if (status !== 429 && status !== 418) {
      return false
    }
    const retryAfter = Number(error.response.headers && error.response.headers['retry-after'])
    const nextMinute = (this.currentMinute() + 1) * 60000 + 1000 - this.now()
    const wait = Math.max(Number.isFinite(retryAfter) ? retryAfter * 1000 : 0, status === 429 ? nextMinute : 0)
    this.blockedUntil = Math.max(this.blockedUntil, this.now() + wait)
    console.error(`[${this.label}] Binance answered HTTP ${status}${Number.isFinite(retryAfter) ? `, retry after ${retryAfter}s` : ''}`)
    return status === 429
  }
}

module.exports = { RequestWeightBudget, WEIGHT_HEADER }
