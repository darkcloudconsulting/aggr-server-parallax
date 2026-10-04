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
