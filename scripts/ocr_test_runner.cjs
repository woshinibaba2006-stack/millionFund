const cp = require('child_process')

const tests = [
    { name: 'local_sample', script: 'scripts/ocr_parse_sample.cjs' },
    { name: 'online_sample', script: 'scripts/online_parse_sample.cjs' }
]

function runScript(scriptPath) {
    try {
        const out = cp.execFileSync('node', [scriptPath], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 })
        return { ok: true, stdout: out }
    } catch (e) {
        return { ok: false, error: e.stderr || e.message }
    }
}

function extractJsonArray(stdout) {
    if (!stdout) return null
    const m = stdout.match(/\[\s*\{[\s\S]*?\}\s*\]/)
    if (!m) return null
    try {
        return JSON.parse(m[0])
    } catch (e) {
        return null
    }
}

function normalizeName(n) {
    return (n || '').toLowerCase().replace(/\s+/g, '').replace(/[()（）]/g, '')
}

function summarize(list) {
    if (!Array.isArray(list)) return { count: 0 }
    return {
        count: list.length,
        items: list.map(h => ({ code: h.code || '', name: h.name || '', amount: h.amount || 0, profit: h.profit || 0 }))
    }
}

const results = {}
for (const t of tests) {
    process.stdout.write(`Running ${t.name} -> ${t.script}...\n`)
    const r = runScript(t.script)
    if (!r.ok) {
        process.stdout.write(`  ERROR running ${t.script}: ${r.error}\n`)
        results[t.name] = { error: String(r.error) }
        continue
    }
    const json = extractJsonArray(r.stdout)
    results[t.name] = { raw: r.stdout, parsed: json }
    process.stdout.write(`  parsed: ${json ? json.length : 0} items\n`)
}

// Compare local vs online if both exist
const local = results['local_sample'] && results['local_sample'].parsed
const online = results['online_sample'] && results['online_sample'].parsed

function listNames(arr) {
    if (!Array.isArray(arr)) return []
    return arr.map(h => normalizeName(h.name || h.code || ''))
}

if (local || online) {
    process.stdout.write('\n=== Summary ===\n')
    if (local) {
        const s = summarize(local)
        process.stdout.write(`Local parser: ${s.count} entries\n`)
        s.items.forEach((it, i) => process.stdout.write(`  ${i+1}. ${it.name} (${it.code}) ${it.amount} profit:${it.profit}\n`))
    } else process.stdout.write('Local parser: no result\n')

    if (online) {
        const s = summarize(online)
        process.stdout.write(`Online parser: ${s.count} entries\n`)
        s.items.forEach((it, i) => process.stdout.write(`  ${i+1}. ${it.name} (${it.code}) ${it.amount} profit:${it.profit}\n`))
    } else process.stdout.write('Online parser: no result\n')

    if (local && online) {
        const lnames = new Set(listNames(local))
        const onames = new Set(listNames(online))
        const onlyLocal = [...lnames].filter(x => !onames.has(x))
        const onlyOnline = [...onames].filter(x => !lnames.has(x))
        process.stdout.write('\nDifferences:\n')
        process.stdout.write(`  Only local (${onlyLocal.length}): ${onlyLocal.join(', ') || 'none'}\n`)
        process.stdout.write(`  Only online (${onlyOnline.length}): ${onlyOnline.join(', ') || 'none'}\n`)
    }
}

process.exit(0)