const fs = require('fs')

const text = `下 届 全 四
《 腾讯 理财 通 4
资产 明细 算 选 按 持仓 收益 排序
东方 人 工 智 能 主题 混合 C
持 有 金额 持仓 收益 昨日 收益
132,801.39 +18,093.89 0.00
银 华海 外 数字 经 济 量化 选 股 混合 发 起 式 (QDI)C
持 有 金额 持仓 收益 昨日 收益
105,645.42 +17,695.42 0.00
招商 中 证 半导体 产业 ETF 发 起 式 联 接 C
持 有 金额 持仓 收益 昨日 收益
62,166.10 +10,819.81 0.00
银 华中 小 盘 混 合
持 有 金额 持仓 收益 昨日 收益
51,610.38 +8,638.89 0.00
[TREKBERE(QDINAKTC
持 有 金额 持仓 收益 昨日 收益
43,490.67 +3,790.67 0.00
大 成 标 普 500 等 权重 指数 (QDIDA 人 民 币
持 有 金额 持仓 收益 昨日 收益
3,733.50 +63.50 0.00
IE [一 JJT-h 工 \| 二 工人 一 可 六 Fw OSS (AAINIIA
`;

function parseAmount(s) {
    if (!s) return 0
    const cleaned = s.replace(/[¥￥,\s+]/g, '')
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

function searchFundByName(ocrName, fundList) {
    if (!ocrName) return null
    const clean = ocrName.replace(/[()（）\s]/g, '').toLowerCase()
    for (const f of fundList) {
        const fn = (f.name || '').replace(/[()（）\s]/g, '').toLowerCase()
        if (fn === clean) return f
        if (fn.includes(clean) || clean.includes(fn)) return f
    }
    return null
}

function parseHoldingTextLocal(text, fundList) {
    let cleanText = text.replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    cleanText = cleanText.replace(/\[[^\]]*\]/g, ' ')
    cleanText = cleanText.replace(/([\u4e00-\u9fa5])\s+([\u4e00-\u9fa5])/g, '$1$2')
    cleanText = cleanText.replace(/[^\u4e00-\u9fa5\d,\.\+\-\s\(\)\/\w]+/g, ' ')
    const rawLines = cleanText.split('\n').map(l => l.trim()).filter(Boolean)
    const lines = rawLines.map(l => l.replace(/[\t\r]+/g, ' ').replace(/\s+/g, ' ')).filter(Boolean)

    const headerPatternLocal = /持\s?有\s?金额|持仓\s?收益|昨日\s?收益|资产\s?明细/i
    const uiNoisePatternLocal = /腾讯|理财通|资产明细|筛选|排序|按\s?持仓\s?收益|返回|更多|展开/i

    const holdings = []

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (headerPatternLocal.test(line) || uiNoisePatternLocal.test(line)) continue
        if (/[\u4e00-\u9fa5]{2,}/.test(line) && line.length > 2) {
            const nameLine = line
            let foundAmount = 0
            let foundProfit = 0
            let foundCode = ''
            for (let j = i; j <= Math.min(i + 3, lines.length - 1); j++) {
                const candidate = lines[j]
                const nums = candidate.match(/[+\-]?[0-9,]+(?:\.\d+)?/g)
                const codeMatch = candidate.match(/(\d{6})/)
                if (codeMatch && isValidFundCode(codeMatch[1])) foundCode = codeMatch[1]
                if (nums && nums.length > 0) {
                    if (nums.length >= 2) {
                        foundAmount = parseFloat(nums[0].replace(/[,\s]/g, ''))
                        foundProfit = parseFloat(nums[1].replace(/[,\s]/g, ''))
                    } else {
                        if (foundAmount === 0) foundAmount = parseFloat(nums[0].replace(/[,\s]/g, ''))
                        else if (foundProfit === 0) foundProfit = parseFloat(nums[0].replace(/[,\s]/g, ''))
                    }
                }
                if (foundAmount > 0) break
            }
            if (foundAmount === 0) {
                const inline = nameLine.match(/[+\-]?[0-9,]+(?:\.\d+)?/g)
                if (inline && inline.length > 0) {
                    foundAmount = parseFloat(inline[0].replace(/[,\s]/g, ''))
                    if (inline.length >= 2) foundProfit = parseFloat(inline[1].replace(/[,\s]/g, ''))
                }
            }

            let finalName = nameLine
            let finalCode = foundCode
            if (!finalCode) {
                const f = searchFundByName(finalName, fundList)
                if (f) { finalCode = f.code;
                    finalName = f.name }
            }

            if (foundAmount > 0 && !uiNoisePatternLocal.test(finalName)) {
                holdings.push({ code: finalCode || '', name: finalName || '', amount: foundAmount, profit: foundProfit || 0 })
            }
        }
    }

    // dedup
    const dedup = new Map()
    for (const h of holdings) {
        const key = h.code ? `c:${h.code}` : `n:${(h.name||'').toLowerCase().replace(/\s+/g,'').replace(/[()（）]/g,'')}`
        const ex = dedup.get(key)
        if (!ex) dedup.set(key, {...h })
        else {
            ex.amount = Math.max(ex.amount || 0, h.amount || 0)
            ex.profit = (ex.profit || 0) + (h.profit || 0)
            if (!ex.code && h.code) ex.code = h.code
        }
    }

    return Array.from(dedup.values())
}

const fundList = loadFundList()
const result = parseHoldingTextLocal(text, fundList)
console.log('Parsed holdings:')
console.log(JSON.stringify(result, null, 2))

console.log('\nProcessed lines:')
text.split('\n').map(l => l.trim()).filter(Boolean).forEach((l, i) => console.log(i + 1, l))