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
    let cleaned = s.replace(/[¥￥,\s+]/g, '')
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
    // 保留换行符 (\n, \r) 不被替换
    let cleanText = text.replace(/[\u0000-\u0008\u000B-\u000C\u000E-\u001F\u007F-\u009F]/g, ' ')
    cleanText = cleanText.replace(/\[[^\]]*\]/g, ' ')
        // 多次合并中文间被分隔的空格（OCR 常把每个字分开）
    while (/([\u4e00-\u9fa5])\s+([\u4e00-\u9fa5])/.test(cleanText)) {
        cleanText = cleanText.replace(/([\u4e00-\u9fa5])\s+([\u4e00-\u9fa5])/g, '$1$2')
    }
    // 保留换行符，避免把多条记录合并为一行
    cleanText = cleanText.replace(/[^\u4e00-\u9fa5\d,\.\+\-\s\n\(\)\/\w]+/g, ' ')
    console.log('--- Cleaned text preview ---')
    console.log(cleanText.split('\n').slice(0, 8).map(l => JSON.stringify(l)).join('\n'))
    console.log('---------------------------')
    const rawLines = cleanText.split('\n').map(l => l.trim()).filter(Boolean)
    const lines = rawLines.map(l => l.replace(/[\t\r]+/g, ' ').replace(/\s+/g, ' ')).filter(Boolean)

    console.log('\n--- processed cleaned lines ---')
    lines.forEach((l, i) => console.log(i + 1, JSON.stringify(l)))
    console.log('-----------------------------')

    const headerPatternLocal = /持\s?有\s?金额|持仓\s?收益|昨日\s?收益|资产\s?明细/i
    const uiNoisePatternLocal = /腾讯|理财通|资产明细|筛选|排序|按\s?持仓\s?收益|返回|更多|展开/i

    const holdings = []

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
            // 去除表头或 UI 噪声的子串，但保留行中可能存在的基金名称
        let candidateLine = line
        if (headerPatternLocal.test(candidateLine) || uiNoisePatternLocal.test(candidateLine)) {
            // 全局移除所有表头或 UI 噪声子串
            while (headerPatternLocal.test(candidateLine)) candidateLine = candidateLine.replace(headerPatternLocal, '').trim()
            while (uiNoisePatternLocal.test(candidateLine)) candidateLine = candidateLine.replace(uiNoisePatternLocal, '').trim()
        }
        if (!candidateLine) continue
        if (/[\u4e00-\u9fa5]{2,}/.test(candidateLine) && candidateLine.length > 2) {
            const nameLine = candidateLine
            let foundAmount = 0
            let foundProfit = 0
            let foundCode = ''
            for (let j = i; j <= Math.min(i + 3, lines.length - 1); j++) {
                const candidate = lines[j]
                    // 如果当前候选行为名称行且包含基金类型关键词，跳过该行中的数字（避免把名称中的 '500' 误识为金额）
                const skipInlineNums = (j === i) && /ETF|指数|QD|QDII|QDIDA|发起式/i.test(candidate)
                const nums = skipInlineNums ? null : candidate.match(/[+\-]?[0-9,]+(?:\.\d+)?/g)
                const codeMatch = candidate.match(/(\d{6})/)
                if (codeMatch && isValidFundCode(codeMatch[1])) foundCode = codeMatch[1]
                if (nums && nums.length > 0) {
                    if (nums.length >= 2) {
                        foundAmount = parseAmount(nums[0])
                        foundProfit = parseAmount(nums[1])
                    } else {
                        if (foundAmount === 0) foundAmount = parseAmount(nums[0])
                        else if (foundProfit === 0) foundProfit = parseAmount(nums[0])
                    }
                }
                if (foundAmount > 0) break
            }
            if (foundAmount === 0) {
                // 如果名称中包含基金类型等关键字（如 ETF/指数/QD），则忽略名称内的数字
                if (!/ETF|指数|QD|QDII|QDIDA|发起式/i.test(nameLine)) {
                    const inline = nameLine.match(/[+\-]?[0-9,]+(?:\.\d+)?/g)
                    if (inline && inline.length > 0) {
                        foundAmount = parseAmount(inline[0])
                        if (inline.length >= 2) foundProfit = parseAmount(inline[1])
                    }
                }
            }

            let finalName = nameLine
            let finalCode = foundCode
            if (!finalCode) {
                const f = searchFundByName(finalName, fundList)
                if (f) { finalCode = f.code;
                    finalName = f.name }
            }

            // 要求金额有一定规模以避免把 UI 页头的序号或页面元素误判为持仓
            if (foundAmount >= 100 && !uiNoisePatternLocal.test(finalName)) {
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