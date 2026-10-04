// Run against a disposable InfluxDB 1.x instance, for example port 8087.
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
process.argv.push('config=config.parallax.json')
const config = require('../src/config')
config.collect = false
const Influx = require('influx')
const InfluxStorage = require('../src/storage/influx')
const Journal = require('../src/storage/journal')

async function main() {
  const port = Number(process.env.PARALLAX_TEST_INFLUX_PORT || 8087)
  const database = `aggr_parallax_compat_${process.pid}`
  config.influxDatabase = database
  const storage = new InfluxStorage()
  storage.influx = new Influx.InfluxDB({ host: '127.0.0.1', port, database })
  await storage.influx.createDatabase(database)
  await storage.ensureRetentionPolicies()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aggr-influx-compat-'))
  const journal = new Journal(path.join(dir, 'events.sqlite'))
  const bucket = Math.floor((Date.now() - 120000) / 60000) * 60000 + 10000
  const market = 'BINANCE:btcusdt'
  const trade = (id, offset, price) => ({ exchange: 'BINANCE', pair: 'btcusdt',
    id, timestamp: bucket + offset, price, size: 2, side: 'buy' })
  try {
    journal.append([trade('a', 1000, 100)], 'live')
    await storage.flushJournal(journal)
    journal.append([trade('b', 2000, 105)], 'recovery')
    await storage.flushJournal(journal)
    const base = await storage.influx.query(`SELECT * FROM ${database}.aggr_10s.trades_10s WHERE market='${market}'`)
    const minute = await storage.influx.query(`SELECT * FROM ${database}.aggr_1m.trades_1m WHERE market='${market}'`)
    assert.equal(base.length, 1)
    assert.equal(base[0].cbuy, 2)
    assert.equal(base[0].vbuy, 410)
    assert.equal(base[0].open, 100)
    assert.equal(base[0].close, 105)
    assert.equal(minute.length, 1)
    assert.equal(minute[0].cbuy, 2)
    assert.equal(minute[0].vbuy, 410)
    assert.equal(journal.health().pending, 0)
    console.log(JSON.stringify({ version: (await storage.influx.query('SHOW DIAGNOSTICS'))[0]?.build || 'checked separately',
      database, base: base[0], minute: minute[0] }))
  } finally {
    journal.db.close()
    fs.rmSync(dir, { recursive: true, force: true })
    await storage.influx.dropDatabase(database)
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
