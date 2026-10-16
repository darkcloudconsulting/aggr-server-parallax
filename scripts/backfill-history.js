// Copy bar history from a restored database into the live one, then verify it.
//
// Used for the node 200 -> node 201 move (docs/NODE201_MOVE_2026-10-16.md):
// the new instance captures every bar from T0 itself, and
// everything before T0 comes from node 200's backup, restored next to the live
// database with `influxd restore -portable -db aggr_parallax -newdb <source>`.
// Open-interest snapshots are copied up to the switch time instead, because
// only node 200 received them while both instances ran.
//
// Usage (plan only unless --execute):
//   node scripts/backfill-history.js --url http://127.0.0.1:8086 \
//     --source aggr_parallax_hist --target aggr_parallax \
//     --t0 2026-10-17T00:00:00Z --switch 2026-10-17T04:30:00Z [--execute]
//
// With --execute, per retention policy and measurement:
//   1. DELETE target points before the cutoff (the new instance's partial
//      bars), measurement by measurement;
//   2. SELECT * INTO target.rp.measurement FROM source.rp.measurement
//      WHERE <one UTC day> GROUP BY *  (GROUP BY * keeps tags as tags);
//   3. compare count(*) per series and per field, source vs target, for
//      time < cutoff, and field types; exit 1 on any difference.
// Verification alone: --verify-only.

const args = Object.fromEntries(
  process.argv.slice(2).map((arg, i, all) =>
    arg.startsWith('--') ? [arg.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true] : null
  ).filter(Boolean)
)
const URL_ = args.url || 'http://127.0.0.1:8086'
const SOURCE = args.source || 'aggr_parallax_hist'
const TARGET = args.target || 'aggr_parallax'
const T0 = Date.parse(args.t0)
const SWITCH = args.switch ? Date.parse(args.switch) : T0
const EXECUTE = args.execute === true
const VERIFY_ONLY = args['verify-only'] === true
const DAY = 86400000

// T0 is the first instant from which the new instance's own bars are complete.
// A UTC midnight needs nothing else; any other cutoff must be followed by
// scripts/resample-range.js --from <t0>, which rebuilds the bars that straddle
// it from the 10s bars (the base timeframe, so T0 must be 10s-aligned).
if (!Number.isFinite(T0) || T0 % 10000) {
  console.error('--t0 must be on a 10 s boundary, e.g. 2026-10-16T14:32:00Z')
  process.exit(2)
}
if (!Number.isFinite(SWITCH) || SWITCH < T0) {
  console.error('--switch must be a time at or after --t0')
  process.exit(2)
}

const iso = (ms) => new Date(ms).toISOString()
const q = (s) => `"${s.replace(/"/g, '\\"')}"`

async function influx(query, { db, write = false } = {}) {
  const params = new URLSearchParams({ q: query, epoch: 'ms' })
  if (db) params.set('db', db)
  const res = await fetch(`${URL_}/query?${params}`, { method: write ? 'POST' : 'GET' })
  const body = await res.json()
  if (!res.ok || body.error) throw new Error(`${query}: ${body.error || res.status}`)
  for (const r of body.results || []) if (r.error) throw new Error(`${query}: ${r.error}`)
  return body.results
}

const rows = (result) => (result.series || []).flatMap((s) =>
  (s.values || []).map((v) => ({ name: s.name, tags: s.tags || {}, ...Object.fromEntries(s.columns.map((c, i) => [c, v[i]])) })))

async function retentionPolicies(db) {
  const [r] = await influx(`SHOW RETENTION POLICIES ON ${q(db)}`)
  return rows(r).map((p) => ({ name: p.name, duration: p.duration, shard: p.shardGroupDuration, isDefault: p.default }))
}

async function measurementsWithData(db, rp) {
  const [r] = await influx(`SELECT count(*) FROM ${q(db)}.${q(rp)}./.*/`)
  return (r.series || []).map((s) => s.name)
}

async function fieldTypes(db, rp, m) {
  const [r] = await influx(`SHOW FIELD KEYS ON ${q(db)} FROM ${q(rp)}.${q(m)}`)
  return Object.fromEntries(rows(r).map((f) => [f.fieldKey, f.fieldType]))
}

async function seriesCounts(db, rp, m, before) {
  const [r] = await influx(`SELECT count(*) FROM ${q(db)}.${q(rp)}.${q(m)} WHERE time < ${before}ms GROUP BY *`)
  const out = {}
  for (const row of rows(r)) {
    const key = JSON.stringify(Object.entries(row.tags).sort())
    for (const [k, v] of Object.entries(row)) if (k.startsWith('count_') && v) out[`${key} ${k}`] = v
  }
  return out
}

async function firstTime(db, rp, m) {
  const [r] = await influx(`SELECT * FROM ${q(db)}.${q(rp)}.${q(m)} ORDER BY time ASC LIMIT 1`)
  const [row] = rows(r)
  return row ? row.time : null
}

const cutoffOf = (m) => (m.startsWith('open_interest') ? SWITCH : T0)

async function main() {
  console.log(`source ${SOURCE}, target ${TARGET}, T0 ${iso(T0)}, switch ${iso(SWITCH)}, ${EXECUTE ? 'EXECUTE' : VERIFY_ONLY ? 'verify only' : 'plan only'}`)

  const sourceRps = await retentionPolicies(SOURCE)
  const targetRps = Object.fromEntries((await retentionPolicies(TARGET)).map((p) => [p.name, p]))
  let rpMismatch = false
  for (const p of sourceRps) {
    const t = targetRps[p.name]
    if (!t || t.duration !== p.duration || t.isDefault !== p.isDefault) {
      console.log(`RP MISMATCH ${p.name}: source ${p.duration} default=${p.isDefault}, target ${t ? `${t.duration} default=${t.isDefault}` : 'missing'}`)
      rpMismatch = true
    }
  }
  if (rpMismatch) {
    console.log('retention policies differ: create or alter them in the target first')
    process.exit(1)
  }
  console.log(`retention policies match (${sourceRps.length})`)

  const plan = []
  for (const p of sourceRps) {
    for (const m of await measurementsWithData(SOURCE, p.name)) {
      plan.push({ rp: p.name, m, cutoff: cutoffOf(m), first: await firstTime(SOURCE, p.name, m) })
    }
  }
  for (const s of plan) console.log(`  ${s.rp}.${s.m}: ${iso(s.first)} .. < ${iso(s.cutoff)}`)

  if (EXECUTE) {
    // DELETE has no retention-policy clause in InfluxQL 1.x: it removes the
    // measurement's points before the cutoff in every retention policy.
    const measurements = [...new Set(plan.map((s) => s.m))]
    for (const m of measurements) {
      await influx(`DELETE FROM ${q(m)} WHERE time < ${cutoffOf(m)}ms`, { db: TARGET, write: true })
      console.log(`deleted ${m} before ${iso(cutoffOf(m))} in ${TARGET}`)
    }
    for (const s of plan) {
      let written = 0
      for (let from = Math.floor(s.first / DAY) * DAY; from < s.cutoff; from += DAY) {
        const to = Math.min(from + DAY, s.cutoff)
        const [r] = await influx(
          `SELECT * INTO ${q(TARGET)}.${q(s.rp)}.${q(s.m)} FROM ${q(SOURCE)}.${q(s.rp)}.${q(s.m)} ` +
          `WHERE time >= ${from}ms AND time < ${to}ms GROUP BY *`, { db: TARGET, write: true })
        written += rows(r).reduce((n, row) => n + (row.written || 0), 0)
      }
      console.log(`copied ${s.rp}.${s.m}: ${written} points`)
    }
  }

  if (EXECUTE || VERIFY_ONLY) {
    let bad = 0
    for (const s of plan) {
      const [src, dst] = [await seriesCounts(SOURCE, s.rp, s.m, s.cutoff), await seriesCounts(TARGET, s.rp, s.m, s.cutoff)]
      const keys = new Set([...Object.keys(src), ...Object.keys(dst)])
      const diffs = [...keys].filter((k) => src[k] !== dst[k])
      const total = Object.values(src).reduce((a, b) => a + b, 0)
      const [ft, tt] = [await fieldTypes(SOURCE, s.rp, s.m), await fieldTypes(TARGET, s.rp, s.m)]
      const typeDiffs = Object.keys(ft).filter((f) => tt[f] !== ft[f]).map((f) => `${f}:${ft[f]}->${tt[f]}`)
      const ok = !diffs.length && !typeDiffs.length
      if (!ok) bad++
      console.log(`${ok ? 'OK  ' : 'DIFF'} ${s.rp}.${s.m}: ${keys.size} series×field cells, ${total} field values` +
        (diffs.length ? `, ${diffs.length} differ e.g. ${diffs.slice(0, 2).map((k) => `${k} ${src[k]}/${dst[k]}`).join('; ')}` : '') +
        (typeDiffs.length ? `, field types differ: ${typeDiffs.join(' ')}` : ''))
    }
    console.log(bad ? `VERIFY FAILED: ${bad} of ${plan.length}` : `VERIFY PASSED: ${plan.length} of ${plan.length}`)
    process.exit(bad ? 1 : 0)
  }
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
