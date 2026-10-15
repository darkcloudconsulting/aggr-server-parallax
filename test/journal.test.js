const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const Journal = require('../src/storage/journal')

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aggr-journal-'))
  const journal = new Journal(path.join(dir, 'events.sqlite'))
  return { journal, close() { journal.db.close(); fs.rmSync(dir, { recursive: true, force: true }) } }
}

function trade(id, offset, price, size = 1) {
  const bucket = Math.floor((Date.now() - 60000) / 10000) * 10000
  return { exchange: 'OKEX', pair: 'BTC-USDT', id,
    timestamp: bucket + offset, price, size, side: 'buy', count: 1 }
}

test('duplicate live/recovery identity is stored once and OHLC follows event time', () => {
  const f = fixture()
  try {
    const late = trade('late', 8000, 105)
    const early = trade('early', 1000, 100)
    assert.equal(f.journal.append([late], 'live').length, 1)
    assert.equal(f.journal.append([early, late], 'recovery').length, 1)
    const bar = f.journal.bar('OKEX:BTC-USDT', early.timestamp - 1000)
    assert.deepEqual([bar.open, bar.high, bar.low, bar.close, bar.cbuy, bar.vbuy],
      [100, 105, 100, 105, 2, 205])
    assert.equal(f.journal.health().pending, 1)
  } finally { f.close() }
})

test('failed write keeps a complete dirty bucket for retry after restart', async () => {
  const f = fixture()
  const first = trade('first', 1000, 100)
  f.journal.append([first], 'live')
  const location = f.journal.db.name
  f.journal.db.close()
  const restarted = new Journal(location)
  try {
    const second = trade('second', 2000, 101)
    restarted.append([second], 'recovery')
    assert.equal(restarted.pending().length, 1)
    assert.equal(restarted.bar('OKEX:BTC-USDT', first.timestamp - 1000).vbuy, 201)
    restarted.markWritten(restarted.pending())
    assert.equal(restarted.pending().length, 0)
  } finally {
    restarted.db.close()
    fs.rmSync(path.dirname(location), { recursive: true, force: true })
  }
})

test('invalid size and out-of-horizon recovery become explicit issues', () => {
  const f = fixture()
  try {
    assert.equal(f.journal.append([{ ...trade('bad', 1000, 100), size: -1 }], 'live').length, 0)
    assert.equal(f.journal.append([{ ...trade('old', 1000, 100), timestamp: Date.now() - 8 * 86400000 }], 'recovery').length, 0)
    assert.equal(f.journal.health().unresolved.length, 2)
  } finally { f.close() }
})

test('native recovery replaces an aggregated execution and inserts its missing members', () => {
  const f = fixture()
  try {
    const last = { ...trade('12', 1000, 100, 3), count: 3, nativeQuantity: '3' }
    f.journal.append([last], 'live')
    f.journal.markWritten(f.journal.pending())
    const individual = { ...last, size: 1, count: 1, nativeQuantity: '1' }
    f.journal.append([{ ...individual, id: '10' }, { ...individual, id: '11' }, individual], 'recovery')
    const bar = f.journal.bar('OKEX:BTC-USDT', last.timestamp - 1000)
    assert.equal(bar.cbuy, 3)
    assert.equal(bar.vbuy, 300)
    assert.equal(f.journal.pending().length, 1)
    assert.equal(f.journal.db.prepare('SELECT size FROM events WHERE native_id=?').get('12').size, 1)
  } finally { f.close() }
})

test('second-resolution recovery does not overwrite a precise live timestamp', () => {
  const f = fixture()
  try {
    const live = trade('same', 1456, 100)
    f.journal.append([live], 'live')
    f.journal.append([{ ...live, timestamp: live.timestamp - 456,
      timestampPrecision: 's' }, { ...live, id: 'new', timestamp: live.timestamp - 456,
      timestampPrecision: 's' }], 'recovery')
    const stored = f.journal.db.prepare('SELECT event_time FROM events WHERE native_id=?').get('same')
    assert.equal(stored.event_time, live.timestamp)
    assert.equal(f.journal.health().unresolved[0].reason, 'coarse_recovery_timestamp')
  } finally { f.close() }
})

test('a late execution keeps a bucket dirty after an older write completes', () => {
  const f = fixture()
  try {
    f.journal.append([trade('first', 1000, 100)], 'live')
    const writing = f.journal.pending()
    f.journal.append([trade('late', 2000, 101)], 'recovery')
    f.journal.markWritten(writing)
    assert.equal(f.journal.pending().length, 1)
    assert.equal(f.journal.bar('OKEX:BTC-USDT', writing[0].bucket).vbuy, 201)
  } finally { f.close() }
})

test('recent pending buckets are selected before history using the time index', () => {
  const f = fixture()
  try {
    const now = Date.now()
    const old = { ...trade('old', 1000, 100), timestamp: now - 180000 }
    const recent = { ...trade('recent', 1000, 101), timestamp: now - 50000 }
    const open = { ...trade('open', 1000, 102), timestamp: now - 10000 }
    f.journal.append([old, recent, open], 'live')
    const rows = f.journal.pendingRecent(256, now - 120000, now - 30000)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].bucket, Math.floor(recent.timestamp / 10000) * 10000)
    assert.equal(f.journal.pending(1)[0].bucket, Math.floor(old.timestamp / 10000) * 10000)
    const plan = f.journal.db.prepare(`EXPLAIN QUERY PLAN SELECT market, bucket, updated_at
      FROM dirty_buckets WHERE bucket < ? ORDER BY bucket, market LIMIT ?`)
      .all(now - 30000, 120)
    assert.ok(plan.some(row => row.detail.includes('dirty_buckets_by_time')))
  } finally { f.close() }
})

test('prune retains only old trades in pending or unresolved buckets', () => {
  const f = fixture()
  try {
    const flagged = trade('flagged', 1000, 100)
    const settled = { ...trade('settled', 1000, 101), timestamp: flagged.timestamp + 10000 }
    const pending = { ...trade('pending', 1000, 102), timestamp: flagged.timestamp + 20000 }
    f.journal.append([flagged, settled, pending], 'live')
    const rows = f.journal.pending()
    f.journal.markWritten(rows.filter(row => row.bucket !== pending.timestamp - 1000))
    f.journal.recordIssue('OKEX:BTC-USDT', flagged.timestamp - 1000, 'coarse_recovery_timestamp')
    f.journal.db.prepare('UPDATE events SET received_at=?').run(Date.now() - 8 * 86400000)

    f.journal.prune()
    assert.deepEqual(f.journal.db.prepare('SELECT native_id FROM events ORDER BY native_id').all(),
      [{ native_id: 'flagged' }, { native_id: 'pending' }])

    f.journal.resolveIssue('OKEX:BTC-USDT', flagged.timestamp - 1000, 'coarse_recovery_timestamp')
    f.journal.markWritten(f.journal.pending())
    f.journal.prune()
    assert.equal(f.journal.db.prepare('SELECT COUNT(*) AS count FROM events').get().count, 0)
  } finally { f.close() }
})

// Mixed journal: 30 executions over 10 buckets, two ages with tied received_at
// values so slices split ties, one bucket pending and one with an open marker.
function seedMixed(journal) {
  const base = Math.floor((Date.now() - 600000) / 10000) * 10000
  const trades = []
  for (let i = 0; i < 30; i++) {
    trades.push({ exchange: 'OKEX', pair: 'BTC-USDT', id: `t${String(i).padStart(2, '0')}`,
      timestamp: base + (i % 10) * 10000 + 1000 + i, price: 100 + i, size: 1, side: 'buy', count: 1 })
  }
  journal.append(trades, 'live')
  journal.markWritten(journal.pending().filter(row => row.bucket !== base + 30000))
  journal.recordIssue('OKEX:BTC-USDT', base + 70000, 'coarse_recovery_timestamp')
  journal.db.prepare('UPDATE events SET received_at=? WHERE native_id < ?').run(Date.now() - 9 * 86400000, 't12')
  journal.db.prepare('UPDATE events SET received_at=? WHERE native_id >= ? AND native_id < ?')
    .run(Date.now() - 8 * 86400000, 't12', 't25')
}

const remaining = journal => journal.db.prepare('SELECT native_id FROM events ORDER BY native_id')
  .all().map(row => row.native_id)

test('sliced prune removes exactly what the single-statement rule removed', () => {
  const reference = fixture()
  const sliced = fixture()
  try {
    seedMixed(reference.journal)
    seedMixed(sliced.journal)
    const cutoff = Date.now() - 7 * 86400000
    reference.journal.db.prepare(`DELETE FROM events WHERE received_at < ? AND NOT EXISTS
      (SELECT 1 FROM dirty_buckets d WHERE d.market=events.market AND d.bucket=events.bucket)
      AND NOT EXISTS
      (SELECT 1 FROM unresolved u WHERE u.market=events.market AND u.bucket=events.bucket)`).run(cutoff)
    for (const limit of [1, 3, 7, 1000]) {
      assert.ok(sliced.journal.prune(Date.now(), limit) >= 0)
      assert.deepEqual(remaining(sliced.journal), remaining(reference.journal), `limit ${limit}`)
    }
    assert.equal(remaining(reference.journal).length, 10)
  } finally { reference.close(); sliced.close() }
})

test('gradual prune yields to the event loop between slices', async () => {
  const f = fixture()
  try {
    seedMixed(f.journal)
    const before = remaining(f.journal).length
    let interleaved = 0
    const tick = setInterval(() => interleaved++, 0)
    const running = f.journal.pruneGradually(Date.now(), 2)
    assert.equal(remaining(f.journal).length, before - 2)
    const deleted = await running
    clearInterval(tick)
    assert.equal(deleted, 20)
    assert.equal(remaining(f.journal).length, before - 20)
    assert.ok(interleaved > 0, 'timers ran while the prune was in progress')
  } finally { f.close() }
})

test('prune plan walks the received_at index', () => {
  const f = fixture()
  try {
    f.journal.prune()
    const plan = f.journal.db.prepare(`EXPLAIN QUERY PLAN SELECT received_at, rowid FROM events
      WHERE received_at < 1 AND received_at >= 0 AND (received_at, rowid) > (0, 0)
      ORDER BY received_at, rowid LIMIT 1 OFFSET 1`).all().map(row => row.detail).join(' | ')
    assert.match(plan, /events_received/)
    assert.doesNotMatch(plan, /TEMP B-TREE/)
  } finally { f.close() }
})
