const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const Database = require('better-sqlite3')

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000

class Journal {
  constructor(location, timeframe = 10000) {
    fs.mkdirSync(path.dirname(location), { recursive: true })
    this.db = new Database(location)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = FULL')
    this.db.pragma('busy_timeout = 5000')
    this.timeframe = timeframe
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        event_key TEXT PRIMARY KEY, market TEXT NOT NULL, bucket INTEGER NOT NULL,
        event_time INTEGER NOT NULL, received_at INTEGER NOT NULL,
        price REAL NOT NULL, size REAL NOT NULL, side TEXT NOT NULL,
        executions INTEGER NOT NULL, liquidation INTEGER NOT NULL,
        native_id TEXT, native_quantity TEXT, native_unit TEXT,
        source TEXT NOT NULL, weak_identity INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS events_bucket ON events(market, bucket, event_time, event_key);
      CREATE INDEX IF NOT EXISTS events_received ON events(received_at);
      CREATE TABLE IF NOT EXISTS dirty_buckets (
        market TEXT NOT NULL, bucket INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        PRIMARY KEY (market, bucket)
      );
      CREATE TABLE IF NOT EXISTS unresolved (
        market TEXT NOT NULL, bucket INTEGER NOT NULL, reason TEXT NOT NULL,
        first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL,
        PRIMARY KEY (market, bucket, reason)
      );
      CREATE TABLE IF NOT EXISTS feed_state (
        market TEXT PRIMARY KEY, last_trade INTEGER NOT NULL,
        last_received INTEGER NOT NULL, journal_events INTEGER NOT NULL,
        weak_events INTEGER NOT NULL
      );
    `)
    this.insert = this.db.prepare(`INSERT OR IGNORE INTO events VALUES
      (@event_key, @market, @bucket, @event_time, @received_at,
       @price, @size, @side, @executions, @liquidation,
       @native_id, @native_quantity, @native_unit, @source, @weak_identity)`)
    this.dirty = this.db.prepare(`INSERT INTO dirty_buckets VALUES (?, ?, ?)
      ON CONFLICT(market, bucket) DO UPDATE SET updated_at=excluded.updated_at`)
    this.issue = this.db.prepare(`INSERT INTO unresolved VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(market, bucket, reason) DO UPDATE SET last_seen=excluded.last_seen`)
    this.feedState = this.db.prepare(`INSERT INTO feed_state VALUES (?, ?, ?, 1, ?)
      ON CONFLICT(market) DO UPDATE SET
        last_trade=MAX(last_trade, excluded.last_trade),
        last_received=excluded.last_received,
        journal_events=journal_events+1,
        weak_events=weak_events+excluded.weak_events`)
    this.appendBatch = this.db.transaction((trades, source) => {
      const accepted = []
      const now = Date.now()
      for (const trade of trades) {
        const market = `${trade.exchange}:${trade.pair}`
        const bucket = Math.floor(Number(trade.timestamp) / this.timeframe) * this.timeframe
        const price = Number(trade.price)
        const size = Number(trade.size)
        const count = Number(trade.count || 1)
        if (!trade.exchange || !trade.pair || !Number.isFinite(bucket) ||
            bucket < now - SEVEN_DAYS || bucket > now + 60000 ||
            !Number.isFinite(price) || price <= 0 || !Number.isFinite(size) || size <= 0 ||
            !Number.isInteger(count) || count < 1 || !['buy', 'sell'].includes(trade.side)) {
          this.issue.run(market, Number.isFinite(bucket) ? bucket : 0, 'invalid_or_out_of_horizon', now, now)
          continue
        }
        const nativeId = trade.id == null ? null : String(trade.id)
        const weak = nativeId === null
        const identity = nativeId || crypto.createHash('sha256').update(JSON.stringify([
          trade.timestamp, price, size, trade.side, count, !!trade.liquidation
        ])).digest('hex')
        const eventKey = `${market}|${trade.liquidation ? 'liq' : 'trade'}|${identity}`
        const row = {
          event_key: eventKey, market, bucket, event_time: Number(trade.timestamp),
          received_at: now, price, size, side: trade.side, executions: count,
          liquidation: trade.liquidation ? 1 : 0, native_id: nativeId,
          native_quantity: trade.nativeQuantity == null ? null : String(trade.nativeQuantity),
          native_unit: trade.nativeUnit || null, source: source || 'recovery',
          weak_identity: weak ? 1 : 0
        }
        if (this.insert.run(row).changes) {
          this.dirty.run(market, bucket, now)
          this.feedState.run(market, Number(trade.timestamp), now, weak ? 1 : 0)
          accepted.push(trade)
        }
      }
      return accepted
    })
  }

  append(trades, source) {
    return this.appendBatch(trades, source)
  }

  pending(limit = 120, before = Date.now() - 30000) {
    return this.db.prepare(`SELECT market, bucket FROM dirty_buckets
      WHERE bucket < ? ORDER BY bucket, market LIMIT ?`).all(before, limit)
  }

  bar(market, bucket) {
    const events = this.db.prepare(`SELECT * FROM events WHERE market=? AND bucket=?
      ORDER BY event_time, event_key`).all(market, bucket)
    if (!events.length) return null
    const bar = { market, time: bucket, cbuy: 0, csell: 0, vbuy: 0, vsell: 0,
      lbuy: 0, lsell: 0, open: null, high: null, low: null, close: null }
    for (const event of events) {
      const notional = event.price * event.size
      if (event.liquidation) {
        bar[`l${event.side}`] += notional
      } else {
        bar[`c${event.side}`] += event.executions
        bar[`v${event.side}`] += notional
        bar.open ??= event.price
        bar.high = bar.high === null ? event.price : Math.max(bar.high, event.price)
        bar.low = bar.low === null ? event.price : Math.min(bar.low, event.price)
        bar.close = event.price
      }
    }
    return bar
  }

  markWritten(entries) {
    const remove = this.db.prepare('DELETE FROM dirty_buckets WHERE market=? AND bucket=?')
    this.db.transaction(() => { for (const entry of entries) remove.run(entry.market, entry.bucket) })()
  }

  recordIssue(market, bucket, reason) {
    const now = Date.now()
    this.issue.run(market, bucket, reason, now, now)
  }

  resolveIssue(market, bucket, reason) {
    this.db.prepare('DELETE FROM unresolved WHERE market=? AND bucket=? AND reason=?')
      .run(market, bucket, reason)
  }

  quality(market, limit = 100) {
    return this.db.prepare(`SELECT e.bucket AS time, COUNT(*) AS messages,
      SUM(e.executions) AS executions, SUM(e.weak_identity) AS weakIdentityEvents,
      MAX(CASE WHEN d.bucket IS NULL THEN 0 ELSE 1 END) AS pendingWrite,
      (SELECT COUNT(*) FROM unresolved u WHERE u.market=e.market AND u.bucket<=e.bucket) AS unresolvedGaps
      FROM events e LEFT JOIN dirty_buckets d ON d.market=e.market AND d.bucket=e.bucket
      WHERE e.market=? AND e.liquidation=0 GROUP BY e.bucket ORDER BY e.bucket DESC LIMIT ?`)
      .all(market, limit).map(row => ({
        ...row,
        finality: row.unresolvedGaps ? 'unresolved' : row.pendingWrite || row.time >= Date.now() - 30000
          ? 'provisional' : row.weakIdentityEvents ? 'identity_unverified' : 'writer_settled'
      }))
  }

  prune(now = Date.now()) {
    const cutoff = now - SEVEN_DAYS
    this.db.prepare(`DELETE FROM events WHERE received_at < ? AND NOT EXISTS
      (SELECT 1 FROM dirty_buckets d WHERE d.market=events.market AND d.bucket=events.bucket)`).run(cutoff)
  }

  health() {
    return {
      markets: this.db.prepare(`SELECT market, last_trade AS lastTrade,
        last_received AS lastReceived, weak_events AS weakIdentityEvents,
        journal_events AS journalEvents FROM feed_state`).all(),
      pending: this.db.prepare('SELECT COUNT(*) AS count FROM dirty_buckets').get().count,
      unresolved: this.db.prepare('SELECT market, bucket, reason, first_seen, last_seen FROM unresolved ORDER BY last_seen DESC LIMIT 1000').all()
    }
  }
}

module.exports = Journal
