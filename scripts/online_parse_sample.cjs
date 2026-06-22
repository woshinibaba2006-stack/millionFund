const fs = require('fs')

const text = `00:45=
,腾讯理财通App
ll令48
腾讯理财通
资产明细
筛选了
按持仓收益排序、
东方人工智能主题混合C
持有金额
持仓收益
昨日收益
132,801.39
+18.093.89
0.00
银华海外数字经济量化选股混合发起式(QDI川)C
持有金额
持仓收益
昨日收益
105,645.42
+17,695.42
0.00
招商中证半导体产业ETF发起式联接C
持有金额
持仓收益
昨日收益
62,166.10
+10,819.81
0.00
银华中小盘混合
持有金额
持仓收益
昨日收益
51,610.38
+8638.89
0.00
广发全球精选股票(QD)人民币C
持有金额
持仓收益
昨日收益
43,490.67
+3,790.67
0.00
大成标普500等权重指数(QDI)A人民币
持有金额
持仓收益
昨日收益
3,733.50
+63.50
0.00
a几
`;

function parseAmount(s) {
    if (!s) return 0
    let cleaned = String(s).replace(/[¥￥,\s+]/g, '')
    const parts = cleaned.split('.')
    if (parts.length > 2) {
        const frac = parts.pop()
        cleaned = parts.join('') + '.' + frac
    }
    const n = parseFloat(cleaned)
    return isNaN(n) ? 0 : n
}

function isValidFundCode(code) {
    if (!/^[0-9]{6}$/.test(code)) return false
    if (/^20[0-9]{4}$/.test(code)) return false
    return true
}

function loadFundList() {
    try {
        const data = fs.readFileSync('fund-list.json', 'utf8')
        return JSON.parse(data)
    } catch (e) {
        console.error('无法读取 fund-list.json', e)
        return []
    }
}

function normalizeName(s) {
    if (!s) return ''
    return s.toLowerCase().replace(/[()（）\s]/g, '')
}

function calculateSimilarity(str1, str2) {
    if (!str1 || !str2) return 0
    if (str1.includes(str2) || str2.includes(str1)) return Math.min(str1.length, str2.length) / Math.max(str1.length, str2.length)
    const set1 = new Set(str1)
    const set2 = new Set(str2)
    let common = 0
    for (const c of set1)
        if (set2.has(c)) common++
            const union = set1.size + set2.size - common
    return union > 0 ? common / union : 0
}

function searchFundByName(ocrName, fundList) {
    if (!ocrName || ocrName.length < 2) return null
    const cleanOcrName = normalizeName(ocrName)
    let best = null
    let bestScore = 0
    for (const f of fundList) {
        const cleanFundName = normalizeName(f.name || '')
        if (cleanFundName === cleanOcrName) return f
        const score = calculateSimilarity(cleanOcrName, cleanFundName)
        const minFuzzyScore = 0.75
        const minNameLen = 4
        const chineseChars = (ocrName.match(/[\u4e00-\u9fa5]/g) || []).length
        const allowFuzzy = cleanOcrName.length >= minNameLen || chineseChars >= 3
        if (allowFuzzy && score > minFuzzyScore && score > bestScore) { bestScore = score;
            best = f }
    }
    return best
}

function preprocessLines(lines) {
    const result = []
    const nameLines = []
    const amountLines = []
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        const chineseMatch = line.match(/[\u4e00-\u9fa5]{3,}/)
        if (chineseMatch && line.length > 4) nameLines.push({ text: line, idx: i })
        const amountMatches = line.match(/[0-9,]+(?:\.\d+)?/g)
        if (amountMatches)
            for (const m of amountMatches) { const amount = parseAmount(m); if (amount >= 100) amountLines.push({ amount, idx: i }) }
    }
    console.log('preprocess: nameLines', nameLines.length, 'amountLines', amountLines.length)
        // debug lists
        // console.log('nameLines:', nameLines)
        // console.log('amountLines:', amountLines)
    for (const nameItem of nameLines) {
        if (nameItem.text.includes('App') || nameItem.text.includes('理财通') || nameItem.text.includes('筛选') || nameItem.text.includes('排序') || nameItem.text.includes('持有金额')) continue
        let bestAmount = 0,
            bestProfit = 0,
            bestDist = Infinity
        for (const amtItem of amountLines) {
            const dist = amtItem.idx - nameItem.idx
                // 金额应该在名称后面的 0-4 行内（考虑表头占位）
            if (dist > 0 && dist <= 4) {
                if (dist < bestDist) { bestDist = dist;
                    bestAmount = amtItem.amount }
            }
            if (bestDist !== Infinity && dist > bestDist && dist <= bestDist + 2) bestProfit = amtItem.amount
        }
        if (bestAmount > 0) result.push(`${nameItem.text} ${bestAmount} ${bestProfit > 0 ? bestProfit : ''}`.trim())
    }
    console.log('preprocess result count=', result.length)
    if (result.length === 0) return lines.filter(l => l.length > 2)
    return result
}

// parseSingleLine removed for simplified test harness

// Implement a simplified online parser following parseHoldingTextOnline
function parseHoldingTextOnline(text, fundList) {
    const rawLines = text.split('\n').map(l => l.trim()).filter(Boolean)
    const lines = rawLines.map(l => l.replace(/[\t\r]+/g, ' ').replace(/\s+/g, ' ')).filter(Boolean)
    const processed = preprocessLines(lines)
    console.log('--- processed lines ---')
    processed.forEach((l, i) => console.log(i + 1, JSON.stringify(l)))
    console.log('-----------------------')
    const headerPattern = /持\s?有\s?金额|持仓\s?收益|昨日\s?收益|资产\s?明细|排序|筛选|持有金额/i
    const uiNoisePattern = /腾讯|理财通|资产明细|筛选|排序|按\s?持仓\s?收益|App|网页|返回|更多|展开|我的持仓/i
    const holdings = []
    for (let i = 0; i < processed.length; i++) {
        const line = processed[i]
        if (headerPattern.test(line)) continue
            // 1) 尝试解析同一行中的 "名称 + 金额 (+ 盈亏)" 形式
        const pLine = /(?:(\d{6})\s*)?([\u4e00-\u9fa5A-Za-z0-9·()（）]+?)\s+([0-9,]+(?:\.\d+)?)(?:\s+([+\-]?[0-9,]+(?:\.\d+)?))?$/
        const mLine = line.match(pLine)
        if (mLine) {
            const codeDirect = mLine[1] || ''
            let nameDirect = mLine[2] || ''
            const amountDirect = parseAmount(mLine[3])
            const profitDirect = mLine[4] ? parseAmount(mLine[4]) : 0
            let code = codeDirect
            if (!code) {
                const f = searchFundByName(nameDirect, fundList)
                if (f) { code = f.code;
                    nameDirect = f.name }
            }
            if (amountDirect >= 100 && !uiNoisePattern.test(nameDirect)) {
                holdings.push({ code: code || '', name: nameDirect || '', amount: amountDirect, profit: profitDirect })
                continue
            }
        }
        // fallback: find amount in line and look upward for name/code
        const nums = line.match(/[-+]?[0-9,]+(?:\.\d+)?/g)
        if (nums && nums.length > 0) {
            const amount = parseAmount(nums[0])
            const profit = nums.length >= 2 ? parseAmount(nums[1]) : 0
            let nameCandidate = '',
                codeCandidate = ''
            for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
                const cand = processed[j]
                if (!cand || headerPattern.test(cand)) continue
                const codeMatch = cand.match(/(\d{6})/)
                if (codeMatch && isValidFundCode(codeMatch[1])) { codeCandidate = codeMatch[1];
                    nameCandidate = cand.replace(codeMatch[0], '').trim(); break }
                if (/[\u4e00-\u9fa5]{2,}/.test(cand) && cand.length > 2) { nameCandidate = cand; break }
            }
            if (nameCandidate && uiNoisePattern.test(nameCandidate)) continue
            let code = codeCandidate;
            let finalName = nameCandidate
            if (!code && finalName) {
                const f = searchFundByName(finalName, fundList)
                if (f) { code = f.code;
                    finalName = f.name }
            }
            if (amount >= 100 && (code || finalName)) holdings.push({ code: code || '', name: finalName || '', amount, profit })
        }
    }
    // dedup
    const map = new Map()
    for (const h of holdings) {
        const key = h.code ? `c:${h.code}` : `n:${(h.name||'').toLowerCase().replace(/\s+/g,'').replace(/[()（）]/g,'')}`
        const ex = map.get(key)
        if (!ex) map.set(key, {...h })
        else { ex.amount = Math.max(ex.amount || 0, h.amount);
            ex.profit = (ex.profit || 0) + (h.profit || 0); if (!ex.code && h.code) ex.code = h.code }
    }
    return Array.from(map.values())
}

const fundList = loadFundList()
const res = parseHoldingTextOnline(text, fundList)
console.log('Parsed (online) holdings:')
console.log(JSON.stringify(res, null, 2))