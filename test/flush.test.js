const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const Journal = require('../src/storage/journal')
const config = require('../src/config')
config.collect = false
const InfluxStorage = require('../src/storage/influx')

test('failed Influx write and rollup retain the complete bucket for retry', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aggr-flush-'))
  const journal = new Journal(path.join(dir, 'events.sqlite'))
  const bucket = Math.floor((Date.now() - 60000) / 10000) * 10000
  const trade = (id, price) => ({ exchange: 'BINANCE', pair: 'btcusdt', id,
    timestamp: bucket + 1000, price, size: 1, side: 'buy' })
  journal.append([trade('a', 100)], 'live')
  const storage = new InfluxStorage()
  storage.baseRp = 'aggr_10s'
  const points = []
  let fail = true
  storage.writePoints = async rows => { points.push(...rows); if (fail) throw new Error('write failed') }
  storage.resample = async () => {}
  try {
    await assert.rejects(storage.flushJournal(journal), /write failed/)
    assert.equal(journal.health().pending, 1)
    journal.append([trade('b', 105)], 'recovery')
    fail = false
    await storage.flushJournal(journal)
    assert.equal(points.at(-1).fields.cbuy, 2)
    assert.equal(points.at(-1).fields.vbuy, 205)
    assert.equal(points.at(-1).fields.close, 105)
    assert.equal(journal.health().pending, 0)
  } finally {
    journal.db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('current bars reach Influx before a historical backlog and both settle', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aggr-flush-'))
  const journal = new Journal(path.join(dir, 'events.sqlite'))
  const now = Date.now()
  const old = Math.floor((now - 180000) / 10000) * 10000
  const recent = Math.floor((now - 50000) / 10000) * 10000
  journal.append([
    { exchange: 'BINANCE', pair: 'btcusdt', id: 'old', timestamp: old + 1000,
      price: 100, size: 1, side: 'buy' },
    { exchange: 'BINANCE', pair: 'btcusdt', id: 'recent', timestamp: recent + 1000,
      price: 101, size: 1, side: 'buy' }
  ], 'live')
  const storage = new InfluxStorage()
  storage.baseRp = 'aggr_10s'
  const written = []
  storage.writePoints = async rows => { written.push(rows.map(row => row.timestamp)) }
  storage.resample = async () => {}
  try {
    await storage.flushJournal(journal)
    assert.deepEqual(written, [[recent], [old]])
    assert.equal(journal.health().pending, 0)
  } finally {
    journal.db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('a failed recent rollup leaves both live and historical buckets for retry', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aggr-flush-'))
  const journal = new Journal(path.join(dir, 'events.sqlite'))
  const now = Date.now()
  for (const [id, age] of [['old', 180000], ['recent', 50000]]) {
    journal.append([{ exchange: 'BINANCE', pair: 'btcusdt', id,
      timestamp: Math.floor((now - age) / 10000) * 10000 + 1000,
      price: 100, size: 1, side: 'buy' }], 'live')
  }
  const storage = new InfluxStorage()
  storage.baseRp = 'aggr_10s'
  storage.writePoints = async () => {}
  let fail = true
  storage.resample = async () => {
    if (fail) throw new Error('rollup failed')
  }
  try {
    await assert.rejects(storage.flushJournal(journal), /rollup failed/)
    assert.equal(journal.health().pending, 2)
    fail = false
    await storage.flushJournal(journal)
    assert.equal(journal.health().pending, 0)
  } finally {
    journal.db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('journal prune waits for the start delay, never overlaps, never runs on exit', async () => {
  const storage = new InfluxStorage()
  let calls = 0
  let finish
  const journal = { pruneGradually: () => { calls++; return new Promise(resolve => { finish = resolve }) } }
  const start = 1_000_000_000
  const { parallaxJournalPruneStartDelay: delay, parallaxJournalPruneInterval: interval } = config
  storage.scheduleJournalPrune(journal, start)
  storage.scheduleJournalPrune(journal, start + delay - 1)
  assert.equal(calls, 0)
  storage.scheduleJournalPrune(journal, start + delay)
  storage.scheduleJournalPrune(journal, start + delay + interval + 1)
  assert.equal(calls, 1, 'a running prune is not started twice')
  finish(0)
  await storage.journalPruning
  storage.scheduleJournalPrune(journal, start + delay + interval - 1)
  assert.equal(calls, 1, 'next run is anchored to the previous start')
  storage.scheduleJournalPrune(journal, start + delay + interval)
  assert.equal(calls, 2)
  finish(0)
  await storage.journalPruning

  const exiting = new InfluxStorage()
  exiting.nextJournalPrune = 0
  exiting.writePoints = async () => {}
  exiting.resample = async () => {}
  const idle = { pendingRecent: () => [], pending: () => [], pruneGradually: () => { calls++; return Promise.resolve(0) } }
  await exiting.flushJournal(idle, true)
  assert.equal(calls, 2, 'no prune on the exit flush')
  await exiting.flushJournal(idle)
  assert.equal(calls, 3)
})
