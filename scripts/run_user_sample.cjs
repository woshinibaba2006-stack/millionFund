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
+17.695.42
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

// Reuse simplified online parser from scripts/online_parse_sample.cjs
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
        return []
    }
}

function normalizeSignedNumber(s) {
    if (!s) return ''
    let str = String(s).trim()
    let sign = ''
    const mSign = str.match(/^([+-]+)/)
    if (mSign) { sign = mSign[1].slice(-1);
        str = str.slice(mSign[0].length) }
    str = str.replace(/[^0-9.]/g, '')
    const parts = str.split('.')
    if (parts.length > 1) { const frac = parts.pop() || ''; const intPart = parts.join('') || '0';
        str = intPart + (frac ? '.' + frac : '') }
    str = str.replace(/^0+(\d)/, '$1')
    return (sign || '') + str
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
    for (const nameItem of nameLines) {
        if (nameItem.text.includes('App') || nameItem.text.includes('理财通') || nameItem.text.includes('筛选') || nameItem.text.includes('排序') || nameItem.text.includes('持有金额')) continue
        let bestAmount = 0,
            bestProfit = 0,
            bestDist = Infinity
        for (const amtItem of amountLines) {
            const dist = amtItem.idx - nameItem.idx
            if (dist > 0 && dist <= 4) {
                if (dist < bestDist) { bestDist = dist;
                    bestAmount = amtItem.amount }
            }
            if (bestDist !== Infinity && dist > bestDist && dist <= bestDist + 2) bestProfit = amtItem.amount
        }
        if (bestAmount > 0) result.push(`${nameItem.text} ${bestAmount} ${bestProfit > 0 ? bestProfit : ''}`.trim())
    }
    if (result.length === 0) return lines.filter(l => l.length > 2)
    return result
}

function searchFundByName(ocrName, fundList) {
    if (!ocrName || ocrName.length < 2) return null
    const cleanOcrName = ocrName.toLowerCase().replace(/[()（）\s]/g, '')
    let best = null;
    let bestScore = 0
    for (const f of fundList) {
        const clean = (f.name || '').toLowerCase().replace(/[()（）\s]/g, '')
        if (clean === cleanOcrName) return f
        const score = calculateSimilarity(cleanOcrName, clean)
        if (score > 0.75 && score > bestScore) { bestScore = score;
            best = f }
    }
    return best
}

function calculateSimilarity(a, b) { if (!a || !b) return 0; if (a.includes(b) || b.includes(a)) return Math.min(a.length, b.length) / Math.max(a.length, b.length); const s1 = new Set(a),
        s2 = new Set(b); let common = 0; for (const c of s1)
        if (s2.has(c)) common++;
    const union = s1.size + s2.size - common; return union > 0 ? common / union : 0 }

function parseHoldingTextOnline(text) {
    const rawLines = text.split('\n').map(l => l.trim()).filter(Boolean)
    const lines = rawLines.map(l => l.replace(/[\t\r]+/g, ' ').replace(/\s+/g, ' ')).filter(Boolean)
    const processed = preprocessLines(lines)
    const fundList = loadFundList()
    const headerPattern = /持\s?有\s?金额|持仓\s?收益|昨日\s?收益|资产\s?明细|排序|筛选|持有金额/i
    const uiNoisePattern = /腾讯|理财通|资产明细|筛选|排序|按\s?持仓\s?收益|App|网页|返回|更多|展开|我的持仓/i
    const holdings = []
    for (let i = 0; i < processed.length; i++) {
        const line = processed[i]
        if (headerPattern.test(line)) continue
        const pLine = /(?:(\d{6})\s*)?([\u4e00-\u9fa5A-Za-z0-9·()（）]+?)\s+([0-9,]+(?:\.\d+)?)(?:\s+([+\-]?[0-9,]+(?:\.\d+)?))?$/
        const mLine = line.match(pLine)
        if (mLine) {
            const codeDirect = mLine[1] || ''
            let nameDirect = mLine[2] || ''
            const amountDirect = parseAmount(mLine[3])
            const profitDirect = mLine[4] ? parseAmount(normalizeSignedNumber(mLine[4])) : 0
            let code = codeDirect
            if (!code) { const f = searchFundByName(nameDirect, fundList); if (f) { code = f.code;
                    nameDirect = f.name } }
            if (amountDirect >= 100 && !uiNoisePattern.test(nameDirect)) { const obj = { code: code || '', name: nameDirect || '', amount: amountDirect, profit: profitDirect };
                obj.ocrName = nameDirect;
                holdings.push(obj); continue }
        }
        const nums = line.match(/[-+]?[0-9,]+(?:\.\d+)?/g)
        if (nums && nums.length > 0) {
            let amount = parseAmount(nums[0])
            let profit = nums.length >= 2 ? parseAmount(normalizeSignedNumber(nums[1])) : 0
            let nameCandidate = '',
                codeCandidate = ''
            for (let j = i - 1; j >= Math.max(0, i - 3); j--) { const cand = processed[j]; if (!cand) continue; const codeMatch = cand.match(/(\d{6})/); if (codeMatch && isValidFundCode(codeMatch[1])) { codeCandidate = codeMatch[1];
                    nameCandidate = cand.replace(codeMatch[0], '').trim(); break }; if (/[\u4e00-\u9fa5]{2,}/.test(cand) && cand.length > 2) { nameCandidate = cand; break } }
            if (nameCandidate && uiNoisePattern.test(nameCandidate)) continue
            let code = codeCandidate;
            let finalName = nameCandidate
            if (!code && finalName) { const f = searchFundByName(finalName, fundList); if (f) { code = f.code;
                    finalName = f.name } }
            if ((!profit || profit === 0) && (finalName || nameCandidate)) {
                const rawIdx = rawLines.findIndex(r => (finalName && r.includes(finalName)) || (nameCandidate && r.includes(nameCandidate)) || r.includes(line.split(' ')[0]))
                if (rawIdx >= 0) {
                    for (let k = rawIdx + 1; k <= Math.min(rawIdx + 6, rawLines.length - 1); k++) {
                        const nxtRaw = rawLines[k]
                        if (!nxtRaw) continue
                        const signMatchRaw = nxtRaw.match(/[+-]\s*[0-9,]+(?:\.\d+)*/)
                        if (signMatchRaw) { profit = parseAmount(normalizeSignedNumber(signMatchRaw[0])); break }
                        const numsRaw = nxtRaw.match(/[-+]?[0-9,]+(?:\.\d+)?/g)
                        if (numsRaw && numsRaw.length === 1 && /^[-+]/.test(nxtRaw.trim())) { profit = parseAmount(normalizeSignedNumber(numsRaw[0])); break }
                    }
                }
            }
            if (amount >= 100 && (code || finalName)) { const obj = { code: code || '', name: finalName || '', amount, profit };
                obj.ocrName = nameCandidate || finalName || line.split(' ')[0];
                holdings.push(obj) }
        }
        // Final-pass: fill missing profit by scanning original raw lines for signed numbers near the name
        for (const h of holdings) {
            if ((!h.profit || h.profit === 0) && h.name) {
                let rawIdx = rawLines.findIndex(r => r.includes(h.name))
                console.log('DEBUG: trying fill profit for', h.name)
                console.log('DEBUG: rawLines sample:', rawLines.slice(0, 15))
                if (rawIdx < 0) {
                    const compact = h.name.replace(/\s+/g, '')
                    rawIdx = rawLines.findIndex(r => r.replace(/\s+/g, '').includes(compact))
                }
                console.log('DEBUG: matched rawIdx=', rawIdx)
                if (rawIdx < 0) {
                    const firstChars = h.name.replace(/\s+/g, '').slice(0, 6)
                    rawIdx = rawLines.findIndex(r => r.includes(firstChars))
                }
                if (rawIdx >= 0) {
                    for (let k = rawIdx + 1; k <= Math.min(rawIdx + 6, rawLines.length - 1); k++) {
                        const nxtRaw = rawLines[k]
                        console.log('DEBUG: checking raw line', k, nxtRaw)
                        if (!nxtRaw) continue
                        const signMatchRaw = nxtRaw.match(/[+-]\s*[0-9,]+(?:\.\d+)*/)
                        console.log('DEBUG: signMatchRaw=', signMatchRaw)
                        if (signMatchRaw) { h.profit = parseAmount(normalizeSignedNumber(signMatchRaw[0])); break }
                        const numsRaw = nxtRaw.match(/[-+]?[0-9,]+(?:\.\d+)?/g)
                        console.log('DEBUG: numsRaw=', numsRaw)
                        if (numsRaw && numsRaw.length === 1 && /^[-+]/.test(nxtRaw.trim())) { h.profit = parseAmount(normalizeSignedNumber(numsRaw[0])); break }
                    }
                }
                if ((!h.profit || h.profit === 0) && h.amount) {
                    const amtStr = h.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                    const amtIdx = rawLines.findIndex(r => r.includes(amtStr) || r.replace(/[,\s]/g, '').includes(String(h.amount).replace(/\.?0+$/, '')))
                    if (amtIdx >= 0) {
                        console.log('DEBUG: amtIdx for', h.name, amtIdx)
                        for (let k = amtIdx + 1; k <= Math.min(amtIdx + 6, rawLines.length - 1); k++) {
                            const nxt = rawLines[k]
                            console.log('DEBUG: amt-scan raw', k, nxt)
                            if (!nxt) continue
                            const nums = nxt.match(/[-+]?[0-9,]+(?:\.\d+)?/g)
                            if (!nums) continue
                            for (const n of nums) {
                                const v = parseAmount(normalizeSignedNumber(n))
                                console.log('DEBUG: candidate', n, '->', v)
                                if (v > 0 && v < h.amount) { h.profit = v; break }
                            }
                            if (h.profit && h.profit > 0) break
                        }
                    }
                }
            }
        }
    }
    // final match names
    for (const h of holdings) {
        if (!h.code && h.name) { const f = searchFundByName(h.name, loadFundList()); if (f) { h.code = f.code;
                h.name = f.name } }
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

// Local parser (simplified) reuse from ocr_parse_sample.cjs
function parseHoldingTextLocal(text) {
    let cleanText = text.replace(/[\u0000-\u0008\u000B-\u000C\u000E-\u001F\u007F-\u009F]/g, ' ')
    cleanText = cleanText.replace(/\[[^\]]*\]/g, ' ')
    while (/([\u4e00-\u9fa5])\s+([\u4e00-\u9fa5])/.test(cleanText)) {
        cleanText = cleanText.replace(/([\u4e00-\u9fa5])\s+([\u4e00-\u9fa5])/g, '$1$2')
    }
    cleanText = cleanText.replace(/[^\u4e00-\u9fa5\d,\.\+\-\s\n\(\)\/\w]+/g, ' ')
    const rawLines = cleanText.split('\n').map(l => l.trim()).filter(Boolean)
    const lines = rawLines.map(l => l.replace(/[\t\r]+/g, ' ').replace(/\s+/g, ' ')).filter(Boolean)
    const fundList = loadFundList()
    const headerPatternLocal = /持\s?有\s?金额|持仓\s?收益|昨日\s?收益|资产\s?明细/i
    const uiNoisePatternLocal = /腾讯|理财通|资产明细|筛选|排序|按\s?持仓\s?收益|返回|更多|展开/i
    const holdings = []
    for (let i = 0; i < lines.length; i++) {
        let line = lines[i]
        if (headerPatternLocal.test(line) || uiNoisePatternLocal.test(line)) {
            while (headerPatternLocal.test(line)) line = line.replace(headerPatternLocal, '').trim()
            while (uiNoisePatternLocal.test(line)) line = line.replace(uiNoisePatternLocal, '').trim()
        }
        if (!line) continue
        if (/[\u4e00-\u9fa5]{2,}/.test(line) && line.length > 2) {
            const nameLine = line
            let foundAmount = 0,
                foundProfit = 0,
                foundCode = ''
            for (let j = i; j <= Math.min(i + 3, lines.length - 1); j++) {
                const candidate = lines[j]
                const skipInlineNums = (j === i) && /ETF|指数|QD|QDII|QDIDA|发起式/i.test(candidate)
                const nums = skipInlineNums ? null : candidate.match(/[+\-]?[0-9,]+(?:\.\d+)?/g)
                const codeMatch = candidate.match(/(\d{6})/)
                if (codeMatch && isValidFundCode(codeMatch[1])) foundCode = codeMatch[1]
                if (nums && nums.length > 0) {
                    if (nums.length >= 2) { foundAmount = parseAmount(nums[0]);
                        foundProfit = parseAmount(normalizeSignedNumber(nums[1])) } else { if (foundAmount === 0) foundAmount = parseAmount(nums[0]);
                        else if (foundProfit === 0) foundProfit = parseAmount(normalizeSignedNumber(nums[0])) }
                }
                if (foundAmount > 0) break
            }
            if (foundAmount === 0) {
                if (!/ETF|指数|QD|QDII|QDIDA|发起式/i.test(nameLine)) {
                    const inline = nameLine.match(/[+\-]?[0-9,]+(?:\.\d+)?/g)
                    if (inline && inline.length > 0) { foundAmount = parseAmount(inline[0]); if (inline.length >= 2) foundProfit = parseAmount(normalizeSignedNumber(inline[1])) }
                }
            }
            let finalName = nameLine;
            let finalCode = foundCode
            if (!finalCode) { const f = searchFundByName(finalName, fundList); if (f) { finalCode = f.code;
                    finalName = f.name } }
            if (foundAmount >= 100 && !uiNoisePatternLocal.test(finalName)) holdings.push({ code: finalCode || '', name: finalName || '', amount: foundAmount, profit: foundProfit || 0 })
        }
    }
    const dedup = new Map()
    for (const h of holdings) { const key = h.code ? `c:${h.code}` : `n:${(h.name||'').toLowerCase().replace(/\s+/g,'').replace(/[()（）]/g,'')}`; const ex = dedup.get(key); if (!ex) dedup.set(key, {...h });
        else { ex.amount = Math.max(ex.amount || 0, h.amount);
            ex.profit = (ex.profit || 0) + (h.profit || 0); if (!ex.code && h.code) ex.code = h.code } }
    return Array.from(dedup.values())
}

const online = parseHoldingTextOnline(text)
const local = parseHoldingTextLocal(text)
console.log('\n=== Online parser result ===')
console.log(JSON.stringify(online, null, 2))
console.log('\n=== Local parser result ===')
console.log(JSON.stringify(local, null, 2))