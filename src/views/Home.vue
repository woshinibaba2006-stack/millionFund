<script setup lang="ts">
// [WHY] 首页 - 展示自选基金列表、市场概览和快捷入口
// [WHAT] 支持下拉刷新、左滑删除、点击跳转搜索添加、设置提醒

import { ref, onMounted, watch, computed, onUnmounted, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useFundStore } from '@/stores/fund'
import { useHoldingStore } from '@/stores/holding'
import { fetchMarketIndicesFast, fetchGlobalIndices, type MarketIndexSimple, type GlobalIndex, fetchTopHoldings, type HoldingStock, fetchIntradayData, type IntradayPoint } from '@/api/fundFast'
import { fetchFinanceNews, type NewsItem, getTradingSession, type TradingSession } from '@/api/tiantianApi'
import { showConfirmDialog, showToast } from 'vant'
import FundCard from '@/components/FundCard.vue'
import FundGridItem from '@/components/FundGridItem.vue'
import upIcon from '@/assets/up.png'
import upSIcon from '@/assets/upS.png'
import downIcon from '@/assets/down.png'
import downSIcon from '@/assets/downS.png'

const router = useRouter()
const fundStore = useFundStore()
const holdingStore = useHoldingStore()

const topHoldingsModal = ref<{ open: boolean; fund: any; stocks: HoldingStock[]; loading: boolean }>({
  open: false,
  fund: null,
  stocks: [],
  loading: false
})

async function openTopHoldings(fund: any, event: Event) {
  event.stopPropagation()
  topHoldingsModal.value = { open: true, fund, stocks: [], loading: true }
  try {
    const stocks = await fetchTopHoldings(fund.code)
    topHoldingsModal.value.stocks = stocks
  } catch (err) {
    console.error('获取重仓股失败:', err)
  } finally {
    topHoldingsModal.value.loading = false
  }
}

function closeTopHoldings() {
  topHoldingsModal.value.open = false
}

// 分时估值弹窗管理
const intradayModal = ref<{ open: boolean; fund: any; data: IntradayPoint[]; loading: boolean }>({
  open: false,
  fund: null,
  data: [],
  loading: false
})
const intradayCanvasRef = ref<HTMLCanvasElement | null>(null)

function drawIntradayChartOnCanvas(canvas: HTMLCanvasElement, data: IntradayPoint[]) {
  if (!data || data.length === 0) return

  const ctx = canvas.getContext('2d')
  if (!ctx) return

  // 设置 canvas 尺寸
  const dpr = window.devicePixelRatio || 1
  const rect = canvas.getBoundingClientRect()
  canvas.width = rect.width * dpr
  canvas.height = rect.height * dpr
  ctx.scale(dpr, dpr)

  const width = rect.width
  const height = rect.height
  const padding = { top: 10, right: 10, bottom: 20, left: 45 }
  const chartWidth = width - padding.left - padding.right
  const chartHeight = height - padding.top - padding.bottom

  // 计算数据范围
  const values = data.map(d => d.value)
  const minVal = Math.min(...values)
  const maxVal = Math.max(...values)
  const startVal = data[0].value
  const endVal = data[data.length - 1].value
  const color = endVal >= startVal ? '#ff4d4f' : '#52c41a'

  // 清空画布
  ctx.clearRect(0, 0, width, height)

  // 绘制网格线
  ctx.strokeStyle = 'rgba(128,128,128,0.1)'
  ctx.lineWidth = 0.5
  for (let i = 0; i <= 4; i++) {
    const y = padding.top + (chartHeight / 4) * i
    ctx.beginPath()
    ctx.moveTo(padding.left, y)
    ctx.lineTo(width - padding.right, y)
    ctx.stroke()
  }

  // 绘制Y轴标签
  ctx.fillStyle = '#999'
  ctx.font = '10px sans-serif'
  ctx.textAlign = 'right'
  for (let i = 0; i <= 4; i++) {
    const val = maxVal - ((maxVal - minVal) / 4) * i
    const y = padding.top + (chartHeight / 4) * i
    ctx.fillText(val.toFixed(3), padding.left - 5, y + 3)
  }

  // 绘制X轴标签（时间）
  ctx.textAlign = 'center'
  const timeStep = Math.ceil(data.length / 5)
  for (let i = 0; i < data.length; i += timeStep) {
    const x = padding.left + (i / (data.length - 1)) * chartWidth
    ctx.fillText(data[i].time, x, height - 5)
  }

  // 绘制折线
  ctx.strokeStyle = color
  ctx.lineWidth = 1.5
  ctx.beginPath()
  data.forEach((point, index) => {
    const x = padding.left + (index / (data.length - 1)) * chartWidth
    const y = padding.top + ((maxVal - point.value) / (maxVal - minVal)) * chartHeight
    if (index === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  })
  ctx.stroke()

  // 绘制渐变填充
  const gradient = ctx.createLinearGradient(0, padding.top, 0, height - padding.bottom)
  gradient.addColorStop(0, color + '20')
  gradient.addColorStop(1, color + '00')
  ctx.fillStyle = gradient
  ctx.beginPath()
  data.forEach((point, index) => {
    const x = padding.left + (index / (data.length - 1)) * chartWidth
    const y = padding.top + ((maxVal - point.value) / (maxVal - minVal)) * chartHeight
    if (index === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  })
  ctx.lineTo(padding.left + chartWidth, height - padding.bottom)
  ctx.lineTo(padding.left, height - padding.bottom)
  ctx.closePath()
  ctx.fill()
}

async function openIntradayModal(fund: any, event: Event) {
  event.stopPropagation()
  // [WHY] 每次打开弹窗时清空旧数据，强制重新加载最新数据
  intradayModal.value = { open: true, fund, data: [], loading: true }
  try {
    // [WHY] 传入 forceRefresh=true 跳过缓存，确保获取最新分时数据
    const data = await fetchIntradayData(fund.code, true)
    if (data && data.length > 0) {
      intradayModal.value.data = data
    }
  } catch (err) {
    console.error('获取分时估值失败:', err)
  } finally {
    intradayModal.value.loading = false
  }
}

function closeIntradayModal() {
  intradayModal.value.open = false
}

// [WHY] 弹窗打开且数据就绪后绘制图表，需要多次尝试确保canvas已渲染
function tryDrawIntradayChart(attempts = 0) {
  if (!intradayCanvasRef.value || !intradayModal.value.data.length) {
    if (attempts < 10) {
      setTimeout(() => tryDrawIntradayChart(attempts + 1), 50)
    }
    return
  }
  drawIntradayChartOnCanvas(intradayCanvasRef.value, intradayModal.value.data)
}

// 监听弹窗打开，数据准备好后绘制图表
watch(() => intradayModal.value.open, (open) => {
  if (open && intradayModal.value.data.length > 0) {
    nextTick(() => tryDrawIntradayChart())
  }
})

// 监听数据变化，弹窗已打开时绘制图表
watch(() => intradayModal.value.data, (data) => {
  if (intradayModal.value.open && data.length > 0) {
    nextTick(() => tryDrawIntradayChart())
  }
}, { deep: true })

// 自动刷新开关状态
const autoRefreshEnabled = ref(false)
// 自动刷新定时器
let autoRefreshInterval: number | undefined
// 交易状态更新定时器
let tradingSessionInterval: number | undefined

// 监听自动刷新状态变化
watch(autoRefreshEnabled, (newValue) => {
  if (newValue) {
    // 启动自动刷新，每1分钟执行一次
    autoRefreshInterval = window.setInterval(refreshData, 60000)
    showToast('自动刷新已开启')
  } else {
    // 关闭自动刷新
    if (autoRefreshInterval) {
      clearInterval(autoRefreshInterval)
      autoRefreshInterval = undefined
    }
    showToast('自动刷新已关闭')
  }
})

// [WHAT] 大盘指数
const indices = ref<MarketIndexSimple[]>([])

// [WHAT] 交易状态
const tradingSession = ref<TradingSession>('closed')
// [WHAT] 当前时间，用于实时更新时分秒
const currentTime = ref(new Date())

// [WHAT] 交易状态文本和样式
const tradingStatus = computed(() => {
  const session = tradingSession.value
  const now = currentTime.value
  const hour = now.getHours()
  const minute = now.getMinutes()
  const second = now.getSeconds()
  const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}:${second.toString().padStart(2, '0')}`
  
  switch (session) {
    case 'morning':
      return { text: '交易中', subText: `上午盘 ${timeStr}`, class: 'trading', icon: 'live' }
    case 'noon_break':
      return { text: '午休中', subText: `13:00 开盘`, class: 'break', icon: 'pause' }
    case 'afternoon':
      return { text: '交易中', subText: `下午盘 ${timeStr}`, class: 'trading', icon: 'live' }
    default:
      return { text: '已收盘', subText: '09:30 开盘', class: 'closed', icon: 'clock' }
  }
})

// [WHAT] 全球指数
const globalIndices = ref<GlobalIndex[]>([])
const showGlobalIndices = ref(false)

// [WHAT] 合并后的指数列表（大盘指数 + 全球指数）
const combinedIndices = computed(() => {
  // 使用Set存储已添加的指数名称，确保去重
  const addedIndexNames = new Set(indices.value.map(idx => idx.name))
  
  // 先添加大盘指数
  const result: MarketIndexSimple[] = [...indices.value]
  
  // 从全球指数中添加额外的指数，避免重复
  globalIndices.value.forEach(gidx => {
    // 检查是否已经添加过同名指数
    if (!addedIndexNames.has(gidx.name)) {
      // 添加到已添加列表
      addedIndexNames.add(gidx.name)
      // 转换为 MarketIndexSimple 类型
      result.push({
        code: gidx.code,
        name: gidx.name,
        current: gidx.price,
        change: gidx.price * gidx.changePercent / 100,
        changePercent: gidx.changePercent
      })
    }
  })
  
  return result
})

// [WHAT] 计算当日盈亏总和（只计算当前筛选后显示的基金）
const totalTodayProfit = computed(() => {
  return sortedHoldings.value.reduce((total, fund) => {
    if (fund.todayProfit) {
      return total + (typeof fund.todayProfit === 'string' ? parseFloat(fund.todayProfit) : fund.todayProfit)
    }
    return total
  }, 0)
})

// [WHAT] 计算当日收益百分比（只计算当前筛选后显示的基金）
const totalTodayProfitPercent = computed(() => {
  const totalMarketValue = sortedHoldings.value.reduce((total, fund) => {
    return total + (fund.marketValue || 0)
  }, 0)
  
  if (totalMarketValue === 0) return 0
  
  return (totalTodayProfit.value / totalMarketValue) * 100
})

// [WHAT] 排序方向
const sortDirection = ref<'up' | 'down' | 'none'>('down')

// [WHAT] UI模式：simple=简洁 / full=全功能
const uiMode = ref<'simple' | 'full'>('simple')

// [WHAT] 当前筛选来源
const currentSourceFilter = ref<string>('')

// [WHAT] 排序函数
function sortFunds(funds: any[]) {
  if (sortDirection.value === 'up') {
    return [...funds].sort((a, b) => {
      const changeA = parseFloat(a.todayChange || '0')
      const changeB = parseFloat(b.todayChange || '0')
      return changeA - changeB
    })
  } else if (sortDirection.value === 'down') {
    return [...funds].sort((a, b) => {
      const changeA = parseFloat(a.todayChange || '0')
      const changeB = parseFloat(b.todayChange || '0')
      return changeB - changeA
    })
  }
  return [...funds]
}

// [WHAT] 正常账户基金（非观察），受来源筛选影响
const normalHoldings = computed(() => {
  let funds = holdingStore.holdings.filter(fund => fund.source !== 'observe')
  if (currentSourceFilter.value) {
    funds = funds.filter(fund => fund.source === currentSourceFilter.value)
  }
  return sortFunds(funds)
})

// [WHAT] 观察账户基金，始终显示，不受来源筛选影响
const observeHoldings = computed(() => {
  const funds = holdingStore.holdings.filter(fund => fund.source === 'observe')
  return sortFunds(funds)
})

// [WHAT] 排序持仓基金（兼容旧代码）
const sortedHoldings = computed(() => {
  return [...normalHoldings.value, ...observeHoldings.value]
})

// [WHAT] 沪深300实时涨跌幅
const hs300ChangePercent = computed(() => {
  const hs300 = indices.value.find(idx => idx.code === '000300')
  return hs300 ? hs300.changePercent : 0
})

// [WHAT] 排序持仓基金
function handleSort(direction: 'up' | 'down') {
  sortDirection.value = direction
}

// [WHAT] 按来源筛选基金
function filterBySource(source: string) {
  if (currentSourceFilter.value === source) {
    currentSourceFilter.value = ''
    showToast('已取消来源筛选')
  } else {
    currentSourceFilter.value = source
    const sourceName = source === 'ali' ? '支付宝' : source === 'TX' ? '腾讯' : source === 'JD' ? '京东' : source
    showToast(`已筛选 ${sourceName} 来源的基金`)
  }
}

// [WHAT] 重置排序
function resetSort() {
  sortDirection.value = 'none'
}

// [WHAT] 公告列表（默认 + 远程）
const defaultNotices = [
  '基金投资有风险，入市需谨慎',
  '交易时间：工作日 9:30-15:00'
]
const notices = ref<string[]>([...defaultNotices])

// [WHAT] 财经资讯
const newsList = ref<NewsItem[]>([])
const newsLoading = ref(false)
const showNewsDetail = ref(false)
const currentNews = ref<NewsItem | null>(null)

// [WHAT] 页面挂载时初始化数据
onMounted(async () => {
  fundStore.initWatchlist()
  // 初始化持仓数据
  holdingStore.initHoldings()
  // 加载大盘指数和全球指数
  loadIndices()
  loadGlobalIndices()
  // 初始化交易状态
  updateTradingSession()
  // 每秒更新交易状态，确保秒钟显示准确
  tradingSessionInterval = window.setInterval(updateTradingSession, 1000)
})

onUnmounted(() => {
  // 清除自动刷新定时器
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval)
  }
  // 清除交易状态更新定时器
  if (tradingSessionInterval) {
    clearInterval(tradingSessionInterval)
  }
})

// [WHAT] 更新交易状态
function updateTradingSession() {
  tradingSession.value = getTradingSession()
  // 更新当前时间，确保时分秒实时跳动
  currentTime.value = new Date()
}

// [WHAT] 刷新数据
async function refreshData() {
  try {
    // 刷新全球主要指数
    await Promise.all([
      loadIndices(),
      loadGlobalIndices()
    ])
    
    // 刷新持仓趋势中的基金数据
    await holdingStore.refreshEstimates()
    
    showToast('刷新成功')
  } catch {
    showToast('刷新失败，请重试')
  }
}

// [WHAT] 加载大盘指数
async function loadIndices() {
  try {
    indices.value = await fetchMarketIndicesFast()
  } catch {
    // 静默失败
  }
}

// [WHAT] 加载全球指数
async function loadGlobalIndices() {
  try {
    globalIndices.value = await fetchGlobalIndices()
  } catch {
    // 静默失败
  }
}

// [WHAT] 加载财经资讯
async function loadNews() {
  newsLoading.value = true
  try {
    newsList.value = await fetchFinanceNews(6)
  } catch {
    // 静默失败
  } finally {
    newsLoading.value = false
  }
}

// [WHAT] 监听数据变化，检查提醒条件
watch(
  () => fundStore.watchlist,
  (watchlist) => {
    for (const fund of watchlist) {
      if (fund.estimateValue && fund.estimateChange) {
        const value = parseFloat(fund.estimateValue)
        const change = parseFloat(fund.estimateChange)
        if (!isNaN(value) && !isNaN(change)) {
          // 提醒功能已移除
        }
      }
    }
  },
  { deep: true }
)

// [WHAT] 下拉刷新处理
async function onRefresh() {
  await Promise.all([
    fundStore.refreshEstimates(),
    loadIndices(),
    loadGlobalIndices(),
    loadNews()
  ])
  showToast('刷新成功')
}

// [WHAT] 删除自选基金
async function handleDelete(code: string) {
  try {
    await showConfirmDialog({
      title: '确认删除',
      message: '确定要从自选中删除该基金吗？'
    })
    fundStore.removeFund(code)
    showToast('已删除')
  } catch {
    // 用户取消
  }
}

// [WHAT] 跳转到搜索页
function goToSearch() {
  router.push('/search')
}

// [WHAT] 打开资讯详情
function openNews(news: NewsItem) {
  currentNews.value = news
  showNewsDetail.value = true
}

// [WHAT] 跳转到外部链接
function openNewsUrl() {
  if (currentNews.value?.url) {
    window.open(currentNews.value.url, '_blank')
  } else {
    showToast('暂无详情链接')
  }
}

// [WHAT] 跳转到基金详情页
function goToDetail(code: string) {
  router.push(`/detail/${code}`)
}

</script>

<template>
  <div class="home-page">
    <!-- 顶部搜索栏 -->
    <div class="top-header">
      <div class="header-left">
        <span class="app-title">AI 百万实盘</span>
      </div>
      <!-- 网页端：显示搜索框 -->
      <div class="search-bar web-only" @click="goToSearch">
        <van-icon name="search" size="16" />
        <span>搜索基金代码/名称</span>
      </div>
      <div class="header-right">
        <!-- 网页端：显示设置按钮 -->
        <div class="web-only">
          <div class="auto-refresh-label">
            <span>{{ autoRefreshEnabled ? '自动刷新开' : '自动刷新关' }}</span>
          </div>
          <van-switch v-model="autoRefreshEnabled" size="20" />
          <van-icon name="replay" size="22" @click="refreshData" />
          <van-icon name="setting-o" size="22" @click="router.push('/alerts')" />
        </div>
        <!-- 移动端：只显示自动刷新和刷新按钮 -->
        <div class="mobile-only">
          <div class="auto-refresh-label">
            <span>{{ autoRefreshEnabled ? '自动刷新开' : '自动刷新关' }}</span>
          </div>
          <van-switch v-model="autoRefreshEnabled" size="20" />
          <van-icon name="replay" size="22" @click="refreshData" />
        </div>
      </div>
    </div>
    
    <!-- 公告栏（已隐藏） -->
    <!-- <div class="notice-bar">
      <van-icon name="volume-o" class="notice-icon" />
      <van-swipe 
        class="notice-swipe" 
        vertical 
        :autoplay="3000" 
        :show-indicators="false"
        :touchable="false"
      >
        <van-swipe-item v-for="(notice, idx) in notices" :key="idx">
          {{ notice }}
        </van-swipe-item>
      </van-swipe>
    </div> -->

    <!-- 下拉刷新列表 -->
    <van-pull-refresh 
      v-model="fundStore.isRefreshing" 
      @refresh="onRefresh"
      class="fund-list-container"
    >

      
      <!-- 持仓趋势 -->
      <div class="market-overview" v-if="holdingStore.holdings.length > 0">
        <div class="overview-title">
          <div class="title-left">
            <span class="live-dot" :class="tradingStatus.class"></span>
            <span>持仓趋势</span>
            <!-- 网页端：按钮在第一行 -->
            <div class="sort-buttons web-only">
              <van-button 
                size="small" 
                icon="arrow-up" 
                @click="handleSort('up')"
                :type="sortDirection === 'up' ? 'primary' : 'default'"
              >
                升序
              </van-button>
              <van-button 
                size="small" 
                icon="arrow-down" 
                @click="handleSort('down')"
                :type="sortDirection === 'down' ? 'primary' : 'default'"
              >
                降序
              </van-button>
            </div>
            <div class="source-buttons web-only">
              <div class="ui-mode-toggle">
                <span 
                  class="ui-mode-btn" 
                  :class="{ active: uiMode === 'simple' }"
                  @click="uiMode = 'simple'"
                >简</span>
                <span 
                  class="ui-mode-btn" 
                  :class="{ active: uiMode === 'full' }"
                  @click="uiMode = 'full'"
                >全</span>
              </div>
              <van-button 
                size="small" 
                class="source-button"
                :class="{ active: currentSourceFilter === 'ali' }"
                @click="filterBySource('ali')"
              >
                <img src="@/assets/ali.jpg" class="source-icon" alt="支付宝" />
              </van-button>
              <van-button 
                size="small" 
                class="source-button"
                :class="{ active: currentSourceFilter === 'TX' }"
                @click="filterBySource('TX')"
              >
                <img src="@/assets/TX.jpg" class="source-icon" alt="腾讯" />
              </van-button>
              <van-button 
                size="small" 
                class="source-button"
                :class="{ active: currentSourceFilter === 'JD' }"
                @click="filterBySource('JD')"
              >
                <img src="@/assets/JD.jpg" class="source-icon" alt="京东" />
              </van-button>
              <div class="reference-ma-badge">
                <span class="reference-ma-label">参考均线</span>
                <span class="reference-ma-value" :class="hs300ChangePercent >= 0 ? 'up' : 'down'">
                  {{ hs300ChangePercent >= 0 ? '+' : '' }}{{ hs300ChangePercent.toFixed(2) }}%
                </span>
              </div>
            </div>
          </div>
          <div class="holding-stats">
            <div class="profit-section">
              <div class="profit-item" :class="totalTodayProfitPercent >= 0 ? 'up' : 'down'">
                <span class="profit-label">利润率</span>
                <span class="profit-percent" :class="totalTodayProfitPercent >= 0 ? 'up' : 'down'">
                  {{ totalTodayProfitPercent >= 0 ? '+' : '' }}{{ totalTodayProfitPercent.toFixed(2) }}%
                </span>
              </div>
              <div class="profit-divider"></div>
              <div class="profit-item" :class="totalTodayProfit >= 0 ? 'up' : 'down'">
                <span class="profit-label">今日盈亏</span>
                <span class="profit-value">{{ totalTodayProfit >= 0 ? '+' : '' }}{{ totalTodayProfit.toFixed(2) }}元</span>
              </div>
            </div>
            <div class="trading-status" :class="tradingStatus.class">
              <span class="status-text">{{ tradingStatus.text }}</span>
              <span class="status-time">{{ tradingStatus.subText }}</span>
            </div>
          </div>
        </div>
        <!-- 移动端：利润率和今日盈亏 -->
        <div class="profit-row mobile-only">
          <div class="profit-section">
            <div class="profit-item" :class="totalTodayProfitPercent >= 0 ? 'up' : 'down'">
              <span class="profit-label">利润率</span>
              <span class="profit-percent" :class="totalTodayProfitPercent >= 0 ? 'up' : 'down'">
                {{ totalTodayProfitPercent >= 0 ? '+' : '' }}{{ totalTodayProfitPercent.toFixed(2) }}%
              </span>
            </div>
            <div class="profit-divider"></div>
            <div class="profit-item" :class="totalTodayProfit >= 0 ? 'up' : 'down'">
              <span class="profit-label">今日盈亏</span>
              <span class="profit-value">{{ totalTodayProfit >= 0 ? '+' : '' }}{{ totalTodayProfit.toFixed(2) }}元</span>
            </div>
          </div>
        </div>
        <!-- 移动端：第二行按钮 -->
        <div class="overview-buttons mobile-only">
          <div class="sort-buttons">
            <div 
              class="sort-icon-button"
              :class="{ active: sortDirection === 'up' }"
              @click="handleSort('up')"
            >
              <img 
                :src="sortDirection === 'up' ? upSIcon : upIcon" 
                class="sort-icon" 
                alt="升序" 
              />
            </div>
            <div 
              class="sort-icon-button"
              :class="{ active: sortDirection === 'down' }"
              @click="handleSort('down')"
            >
              <img 
                :src="sortDirection === 'down' ? downSIcon : downIcon" 
                class="sort-icon" 
                alt="降序" 
              />
            </div>
          </div>
          <div class="source-buttons">
            <div class="ui-mode-toggle">
              <span 
                class="ui-mode-btn" 
                :class="{ active: uiMode === 'simple' }"
                @click="uiMode = 'simple'"
              >简</span>
              <span 
                class="ui-mode-btn" 
                :class="{ active: uiMode === 'full' }"
                @click="uiMode = 'full'"
              >全</span>
            </div>
            <van-button 
              size="small" 
              class="source-button"
              :class="{ active: currentSourceFilter === 'ali' }"
              @click="filterBySource('ali')"
            >
              <img src="@/assets/ali.jpg" class="source-icon" alt="支付宝" />
            </van-button>
            <van-button 
              size="small" 
              class="source-button"
              :class="{ active: currentSourceFilter === 'TX' }"
              @click="filterBySource('TX')"
            >
              <img src="@/assets/TX.jpg" class="source-icon" alt="腾讯" />
            </van-button>
            <van-button 
              size="small" 
              class="source-button"
              :class="{ active: currentSourceFilter === 'JD' }"
              @click="filterBySource('JD')"
            >
              <img src="@/assets/JD.jpg" class="source-icon" alt="京东" />
            </van-button>
            <div class="reference-ma-badge">
              <span class="reference-ma-label">参考均线</span>
              <span class="reference-ma-value" :class="hs300ChangePercent >= 0 ? 'up' : 'down'">
                {{ hs300ChangePercent >= 0 ? '+' : '' }}{{ hs300ChangePercent.toFixed(2) }}%
              </span>
            </div>
          </div>
        </div>
        <div class="index-grid">
          <FundGridItem
            v-for="fund in normalHoldings"
            :key="fund.code"
            :fund="fund"
            :ui-mode="uiMode"
            @click="router.push(`/detail/${fund.code}`)"
            @open-top-holdings="openTopHoldings(fund, $event)"
            @open-intraday-modal="openIntradayModal(fund, $event)"
          />
          <div v-if="observeHoldings.length > 0" class="observe-divider">
            <div class="observe-divider-line"></div>
            <span class="observe-divider-text">量化观察</span>
            <div class="observe-divider-line"></div>
          </div>
          <FundGridItem
            v-for="fund in observeHoldings"
            :key="fund.code"
            :fund="fund"
            :ui-mode="uiMode"
            @click="router.push(`/detail/${fund.code}`)"
            @open-top-holdings="openTopHoldings(fund, $event)"
            @open-intraday-modal="openIntradayModal(fund, $event)"
          />
        </div>
      </div>
            <!-- 大盘指数概览 - 交易终端风格 -->
      <div class="market-overview" v-if="combinedIndices.length > 0">
        <div class="overview-title">
          <div class="title-left">
            <span class="live-dot" :class="tradingStatus.class"></span>
            <span>全球主要指数</span>
          </div>
          <div class="trading-status" :class="tradingStatus.class">
            <span class="status-text">{{ tradingStatus.text }}</span>
            <span class="status-time">{{ tradingStatus.subText }}</span>
          </div>
        </div>
        <div class="index-grid market-index-grid">
          <div 
            v-for="index in combinedIndices" 
            :key="index.code" 
            class="index-item market-index-item"
            :class="[index.changePercent >= 0 ? 'up' : 'down']"
            @click="router.push('/market')"
          >
            <!-- 网页端布局 -->
            <div class="market-index-content web-only">
              <div class="market-index-left">
                <div class="market-index-name">{{ index.name }}</div>
                <div class="market-index-value">
                  <span class="market-index-value-num">{{ index.current.toFixed(2) }}</span>
                </div>
              </div>
              <div class="market-index-right">
                <div class="market-index-change">
                <van-icon :name="index.changePercent >= 0 ? 'arrow-up' : 'arrow-down'" size="14" />
                <span>{{ index.changePercent >= 0 ? '+' : '' }}{{ Math.abs(index.changePercent).toFixed(2) }}%</span>
              </div>
              </div>
            </div>
            <div class="market-index-bar web-only"></div>
            
            <!-- 移动端布局 -->
            <div class="mobile-market-layout mobile-only">
              <!-- 第一行：指数名称 -->
              <div class="mobile-market-row mobile-market-row-1">
                <div class="market-index-name">{{ index.name }}</div>
              </div>
              
              <!-- 第二行：涨跌幅度 -->
              <div class="mobile-market-row mobile-market-row-2">
                <div class="market-index-change">
                  <van-icon :name="index.changePercent >= 0 ? 'arrow-up' : 'arrow-down'" size="14" />
                  <span>{{ index.changePercent >= 0 ? '+' : '' }}{{ Math.abs(index.changePercent).toFixed(2) }}%</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <!-- 快捷入口 -->
      <div class="quick-actions" style="display: none;">
        <div class="action-item" @click="router.push('/search')">
          <div class="action-icon">
            <van-icon name="search" size="22" />
          </div>
          <span>搜索</span>
        </div>
        <div class="action-item" @click="router.push('/compare')">
          <div class="action-icon">
            <van-icon name="balance-o" size="22" />
          </div>
          <span>对比</span>
        </div>
        <div class="action-item" @click="router.push('/calculator')">
          <div class="action-icon">
            <van-icon name="gold-coin-o" size="22" />
          </div>
          <span>定投</span>
        </div>
        <div class="action-item" @click="router.push('/manager-rank')">
          <div class="action-icon">
            <van-icon name="friends-o" size="22" />
          </div>
          <span>经理</span>
        </div>
        <div class="action-item" @click="router.push('/backtest')">
          <div class="action-icon">
            <van-icon name="chart-trending-o" size="22" />
          </div>
          <span>回测</span>
        </div>
        <div class="action-item" @click="router.push('/report')">
          <div class="action-icon">
            <van-icon name="description-o" size="22" />
          </div>
          <span>报告</span>
        </div>
        <div class="action-item" @click="router.push('/calendar')">
          <div class="action-icon">
            <van-icon name="calendar-o" size="22" />
          </div>
          <span>日历</span>
        </div>
        <div class="action-item" @click="router.push('/alerts')">
          <div class="action-icon">
            <van-icon name="bell" size="22" />
          </div>
          <span>提醒</span>
        </div>
      </div>
      
      <!-- 财经资讯 -->
      <!-- <div class="news-section">
        <div class="section-header">
          <span class="section-title">财经资讯</span>
          <span class="view-more">更多 ></span>
        </div>
        <div class="news-list" v-if="!newsLoading && newsList.length > 0">
          <div 
            v-for="news in newsList" 
            :key="news.id" 
            class="news-item"
            @click="openNews(news)"
          >
            <div class="news-content">
              <div class="news-title">{{ news.title }}</div>
              <div class="news-meta">
                <span class="news-source">{{ news.source }}</span>
                <span class="news-time">{{ news.time }}</span>
              </div>
            </div>
          </div>
        </div>
        <van-loading v-else-if="newsLoading" class="news-loading" />
      </div> -->
      
      <!-- 自选基金标题 -->
      <div class="section-header" v-if="fundStore.watchlist.length > 0">
        <span class="section-title">自选基金</span>
        <span class="fund-count">{{ fundStore.watchlist.length }}只</span>
      </div>
      
      <!-- 有自选基金时显示列表 -->
      <template v-if="fundStore.watchlist.length > 0">
        <!-- 刷新时间提示 -->
        <div v-if="fundStore.lastRefreshTime" class="refresh-time">
          <span>最后刷新：{{ fundStore.lastRefreshTime }}</span>
        </div>
        
        <!-- 基金列表 -->
        <FundCard
          v-for="fund in fundStore.watchlist"
          :key="fund.code"
          :fund="fund"
          @delete="handleDelete"
          @click="goToDetail"
        />
      </template>

      <!-- 空状态 -->
      <van-empty
        v-else
        image="search"
        description="暂无自选基金"
        class="web-only"
      >
        <van-button round type="primary" @click="goToSearch">
          添加基金
        </van-button>
      </van-empty>
      
      <!-- 底部占位 -->
      <div class="bottom-spacer"></div>
    </van-pull-refresh>

    <!-- 资讯详情弹窗 -->
    <van-popup 
      v-model:show="showNewsDetail" 
      position="bottom" 
      round
      :style="{ height: '70%' }"
    >
      <div class="news-detail" v-if="currentNews">
        <div class="news-detail-header">
          <span>资讯详情</span>
          <van-icon name="cross" @click="showNewsDetail = false" />
        </div>
        <div class="news-detail-content">
          <h3 class="news-detail-title">{{ currentNews.title }}</h3>
          <div class="news-detail-meta">
            <span>{{ currentNews.source }}</span>
            <span>{{ currentNews.time }}</span>
          </div>
          <div class="news-detail-summary">
            {{ currentNews.summary || '暂无摘要内容' }}
          </div>
        </div>
        <div class="news-detail-footer" v-if="currentNews.url">
          <van-button block type="primary" @click="openNewsUrl">
            查看原文
          </van-button>
        </div>
        <div class="news-detail-footer" v-else>
          <van-button block plain @click="showNewsDetail = false">
            知道了
          </van-button>
        </div>
      </div>
    </van-popup>

    <!-- 前10大重仓股弹窗 -->
    <van-popup 
      v-model:show="topHoldingsModal.open" 
      position="center" 
      round 
      :style="{ width: '88%', maxWidth: '420px', background: 'var(--bg-secondary)' }"
    >
      <div class="top-holdings-popup">
        <div class="top-holdings-header">
          <div class="top-holdings-title-row">
            <span class="top-holdings-icon">📈</span>
            <span class="top-holdings-title">前10重仓股票</span>
          </div>
        </div>
        <div class="top-holdings-fund-info">
          <span class="top-holdings-fund-name">{{ topHoldingsModal.fund?.name }}</span>
          <span class="top-holdings-fund-code">#{{ topHoldingsModal.fund?.code }}</span>
        </div>
        <div class="top-holdings-grid" v-if="!topHoldingsModal.loading">
          <div 
            v-for="(stock, idx) in topHoldingsModal.stocks" 
            :key="stock.code || idx" 
            class="top-holdings-card"
          >
            <span class="thc-name">{{ stock.name }}</span>
            <div class="thc-bottom">
              <span 
                v-if="stock.change !== null" 
                class="thc-change" 
                :class="stock.change > 0 ? 'up' : stock.change < 0 ? 'down' : ''"
              >
                {{ stock.change > 0 ? '+' : '' }}{{ stock.change.toFixed(2) }}%
              </span>
              <span v-else class="thc-change">--</span>
              <span class="thc-weight">{{ stock.weight }}</span>
            </div>
          </div>
          <div v-if="topHoldingsModal.stocks.length === 0" class="top-holdings-empty">
            暂无重仓股数据
          </div>
        </div>
        <div class="top-holdings-loading" v-else>
          <van-loading size="24px">加载中...</van-loading>
        </div>
        <button class="top-holdings-close-btn" @click="topHoldingsModal.open = false">关闭</button>
      </div>
    </van-popup>

    <!-- 当日分时估值弹窗 -->
    <van-popup 
      v-model:show="intradayModal.open" 
      position="center" 
      round 
      :style="{ width: '92%', maxWidth: '480px', background: 'var(--bg-secondary)' }"
    >
      <div class="intraday-popup">
        <div class="intraday-popup-header">
          <div class="intraday-popup-title-row">
            <van-icon name="chart-trending-o" size="20" class="intraday-popup-icon" />
            <span class="intraday-popup-title">当日分时估值</span>
          </div>
        </div>
        <div class="intraday-popup-fund-info">
          <span class="intraday-popup-fund-name">{{ intradayModal.fund?.name }}</span>
          <span class="intraday-popup-fund-code">#{{ intradayModal.fund?.code }}</span>
        </div>
        <div class="intraday-popup-chart" v-if="!intradayModal.loading">
          <div v-if="intradayModal.data && intradayModal.data.length > 0" class="intraday-popup-chart-wrapper">
            <div class="intraday-popup-summary">
              <span class="intraday-popup-latest" :class="intradayModal.data[intradayModal.data.length - 1].growth >= 0 ? 'up' : 'down'">
                {{ intradayModal.data[intradayModal.data.length - 1].value }}
                ({{ intradayModal.data[intradayModal.data.length - 1].growth >= 0 ? '+' : '' }}{{ intradayModal.data[intradayModal.data.length - 1].growth }}%)
              </span>
              <span class="intraday-popup-time">{{ intradayModal.data[intradayModal.data.length - 1].time }}</span>
            </div>
            <canvas ref="intradayCanvasRef" class="intraday-popup-canvas"></canvas>
          </div>
          <div v-else class="intraday-popup-empty">
            暂无估值数据
          </div>
        </div>
        <div class="intraday-popup-loading" v-else>
          <van-loading size="24px">加载中...</van-loading>
        </div>
        <button class="intraday-popup-close-btn" @click="closeIntradayModal">关闭</button>
      </div>
    </van-popup>
  </div>
</template>

<style scoped>
.home-page {
  /* [WHY] 使用 100% 高度适配 flex 布局 */
  height: 100%;
  background: var(--bg-primary);
  transition: background-color 0.3s;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* 顶部搜索栏 - 交易终端风格 */
.top-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 16px;
  padding-top: calc(16px + env(safe-area-inset-top, 0px));
  background: linear-gradient(180deg, var(--bg-secondary) 0%, rgba(22, 27, 34, 0.95) 100%);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  position: sticky;
  top: 0;
  z-index: 100;
  border-bottom: 1px solid var(--border-color);
}

.header-left {
  flex-shrink: 0;
}

.app-title {
  font-size: 20px;
  font-weight: 700;
  background: linear-gradient(135deg, var(--color-primary) 0%, #ffca28 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  letter-spacing: -0.5px;
}

.search-bar {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  color: var(--text-muted);
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
}

.search-bar:active {
  background: var(--bg-active);
  border-color: var(--color-primary);
}

.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

.auto-refresh-label {
  font-size: 14px;
  color: var(--text-secondary);
  white-space: nowrap;
}

.header-right .van-icon {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-tertiary);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  transition: all 0.2s;
}

.header-right .van-icon:active {
  background: var(--bg-active);
  color: var(--color-primary);
}

/* 公告栏 */
.notice-bar {
  display: flex;
  align-items: center;
  padding: 8px 16px;
  background: var(--bg-secondary);
  font-size: 13px;
  color: var(--text-secondary);
  border-bottom: 1px solid var(--border-color);
}

.notice-icon {
  color: var(--text-secondary);
  margin-right: 8px;
  flex-shrink: 0;
}

.notice-swipe {
  flex: 1;
  height: 20px;
  line-height: 20px;
}

.fund-list-container {
  /* [WHY] 使用 flex: 1 自动撑满剩余空间 */
  flex: 1;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  /* [WHY] 下拉刷新需要这个属性 */
  overscroll-behavior-y: contain;
  /* [WHY] Android WebView 需要明确的触摸行为 */
  touch-action: pan-y;
}

/* 大盘指数概览 - 交易终端风格 */
.market-overview {
  padding: 16px;
  background: var(--bg-secondary);
  margin: 12px;
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-color);
  position: relative;
  overflow: hidden;
}

.overview-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 14px;
}

.title-left {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}

.update-status {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  font-weight: 500;
}

.update-status.updated {
  color: var(--color-down);
  background: rgba(67, 160, 79, 0.1);
}

.update-status.not-updated {
  color: var(--text-secondary);
  background: rgba(158, 158, 158, 0.1);
}

.sort-buttons {
  display: flex;
  gap: 8px;
  margin-left: 12px;
}

.source-buttons {
  display: flex;
  gap: 8px;
  margin-left: 12px;
  align-items: center;
}

.reference-ma-badge {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  background: rgba(59, 130, 246, 0.08);
  border: 1px solid rgba(59, 130, 246, 0.2);
  border-radius: 6px;
  margin-left: 8px;
}

.reference-ma-label {
  font-size: 12px;
  color: #3b82f6;
  font-weight: 500;
}

.reference-ma-value {
  font-size: 12px;
  font-weight: 700;
  font-family: var(--font-number);
}

.reference-ma-value.up {
  color: #3b82f6;
}

.reference-ma-value.down {
  color: #3b82f6;
}

.ui-mode-toggle {
  display: flex;
  align-items: center;
  background: var(--bg-primary, #f5f5f5);
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid var(--border-light, #e0e0e0);
  margin-right: 4px;
}

.ui-mode-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 24px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary, #999);
  cursor: pointer;
  transition: all 0.2s;
  user-select: none;
}

.ui-mode-btn:first-child {
  border-right: 1px solid var(--border-light, #e0e0e0);
}

.ui-mode-btn.active {
  background: linear-gradient(180deg, #0ea5e9, #22d3ee);
  color: #05263b;
  font-weight: 600;
}

.ui-mode-btn:hover:not(.active) {
  background: var(--bg-secondary, #eee);
}

.filter-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px;
  height: 24px;
  background: #f5f5f5;
  border-radius: 4px;
  margin-right: 4px;
}

.filter-label {
  font-size: 12px;
  color: #666;
  white-space: nowrap;
}

.source-button {
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  overflow: hidden;
}

.source-button.active {
  box-shadow: 0 0 0 2px #0ea5e9;
}

.all-button,
.qdii-button {
  padding: 0 8px;
  min-width: 40px;
  height: 24px;
  font-size: 11px;
}

.source-button:not(.all-button):not(.qdii-button) {
  padding: 0;
  min-width: 24px;
  height: 24px;
}

.source-icon {
  width: 20px;
  height: 20px;
  object-fit: contain;
  border-radius: 3px;
}

.sort-buttons .van-button {
  font-size: 11px;
  padding: 4px 8px;
  min-width: unset;
}

.sort-buttons .van-button--primary {
  background: linear-gradient(180deg, #0ea5e9, #22d3ee) !important;
  border-color: transparent !important;
  color: #05263b !important;
  font-weight: 600;
}

.live-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-muted);
  transition: all 0.3s;
}

.live-dot.trading {
  background: var(--color-down);
  animation: pulse 1.5s ease-in-out infinite;
  box-shadow: 0 0 8px var(--color-down);
}

.live-dot.break {
  background: var(--color-primary);
  animation: pulse 3s ease-in-out infinite;
  box-shadow: 0 0 6px var(--color-primary);
}

.live-dot.closed {
  background: var(--text-muted);
  animation: none;
}

@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(0.85); }
}

/* 交易状态标签 */
.trading-status {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
}

.status-text {
  font-size: 12px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 4px;
}

.trading-status.trading .status-text {
  background: rgba(81, 207, 102, 0.15);
  color: var(--color-down);
}

.trading-status.break .status-text {
  background: rgba(255, 193, 7, 0.15);
  color: var(--color-primary);
}

.trading-status.closed .status-text {
  background: var(--bg-tertiary);
  color: var(--text-secondary);
}

.status-time {
  font-size: 10px;
  color: var(--text-muted);
  font-family: var(--font-number);
}

.holding-stats {
  display: flex;
  align-items: center;
  gap: 12px;
}

.overview-buttons {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
}

@media (max-width: 767px) {
  /* 移动端：隐藏网页端按钮 */
  .title-left .web-only {
    display: none;
  }
  
  /* 移动端：显示第二行按钮 */
  .overview-buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 10px;
  }
  
  .overview-buttons .sort-buttons {
    display: flex;
    gap: 8px;
  }
  
  /* 移动端：小图标按钮样式 */
  .sort-icon-button {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: 50%;
    cursor: pointer;
    transition: all 0.2s;
  }
  
  .sort-icon-button.active {
    background: linear-gradient(180deg, #0ea5e9, #22d3ee);
    border-color: transparent;
  }
  
  .sort-icon-button:active {
    background: var(--bg-active);
  }
  
  .sort-icon {
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
    padding: 4px;
  }
  
  .overview-buttons .source-buttons {
    display: flex;
    gap: 8px;
  }
  
  /* 移动端：调整利润率和今日盈亏的样式 - 移到第二行 */
   
  /* 移动端 holding-stats 只显示交易状态 */
  .holding-stats .profit-section {
    display: none;
  }
  
  .holding-stats {
    margin-left: auto;
  }
  
  .profit-row {
    margin-top: 8px;
    margin-bottom: 8px;
  }
  
  .profit-row .profit-section {
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    gap: 4px;
  }
  
  .profit-row .profit-item {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 2px;
    flex: 1;
  }
  
  .profit-row .profit-divider {
    width: 1px;
    height: 16px;
    background: var(--border-color);
    flex-shrink: 0;
  }
  
  .profit-row .profit-label {
    font-size: 10px;
    color: var(--text-secondary);
  }
  
  .profit-row .profit-value,
  .profit-row .profit-percent {
    font-size: 11px;
    font-weight: 600;
    font-family: var(--font-number);
  }
}

@media (min-width: 768px) {
  /* 网页端：隐藏第二行按钮 */
  .overview-buttons {
    display: none;
  }
  
  /* 网页端：显示第一行按钮 */
  .title-left .web-only {
    display: flex;
  }
  
  .title-left .web-only.sort-buttons {
    display: flex;
    gap: 8px;
    margin-left: 12px;
  }
  
  .title-left .web-only.source-buttons {
    display: flex;
    gap: 8px;
    margin-left: 12px;
  }
}

.profit-section {
  display: flex;
  gap: 16px;
  align-items: baseline;
}

.profit-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  min-width: 70px;
}

.profit-divider {
  width: 1px;
  background: var(--border-color);
  align-self: stretch;
}

.profit-item.up .profit-value,
.profit-item.up .profit-percent {
  color: var(--color-up);
}

.profit-item.down .profit-value,
.profit-item.down .profit-percent {
  color: var(--color-down);
}

.profit-label {
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
}

.profit-value,
.profit-percent {
  font-size: 14px;
  font-weight: 600;
  font-family: var(--font-number);
  white-space: nowrap;
}

.view-more {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  font-weight: 500;
  color: var(--color-secondary);
  padding: 6px 10px;
  background: var(--color-secondary-bg);
  border-radius: var(--radius-md);
  transition: all 0.2s;
}

.view-more:active {
  background: var(--bg-active);
}

.index-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 6px;
}

.index-item {
  padding: 4px 4px;
  background: var(--bg-primary);
  border-radius: var(--radius-md);
  border: 1px solid var(--border-light);
  transition: all 0.2s;
  position: relative;
  overflow: hidden;
  cursor: pointer;
}

.index-item:active {
  transform: scale(0.98);
}

.index-item.up {
  border-color: rgba(255, 107, 107, 0.25);
  background: linear-gradient(135deg, var(--bg-primary) 0%, rgba(255, 107, 107, 0.05) 100%);
}

.index-item.down {
  border-color: rgba(81, 207, 102, 0.25);
  background: linear-gradient(135deg, var(--bg-primary) 0%, rgba(81, 207, 102, 0.05) 100%);
}

.index-name {
  font-size: 10px;
  color: var(--text-secondary);
  margin-bottom: 6px;
  display: block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
  height: 16px;
  line-height: 16px;
}

/* 基金名称内容容器 */
.fund-name-content {
  display: flex;
  align-items: center;
  width: 100%;
  height: 100%;
  gap: 6px;
}

/* 基金名称左侧（平台图标） */
.fund-name-left {
  flex-shrink: 0;
}

/* 基金名称中间（QDII标识） */
.fund-name-middle {
  flex-shrink: 0;
}

/* 基金名称右侧（基金名称） */
.fund-name-right {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: left;
}

/* 平台图标样式 */
.source-icon-small {
  width: 14px;
  height: 14px;
  border-radius: 2px;
  object-fit: contain;
}

/* QDII标签样式 */
.qdii-tag {
  display: inline-block;
  padding: 1px 4px;
  font-size: 9px;
  font-weight: 500;
  color: #ffffff;
  background-color: #9333ea;
  border-radius: 8px;
  vertical-align: middle;
}

/* 确保垂直居中对齐 */
.fund-name-left,
.fund-name-middle,
.fund-name-right {
  display: flex;
  align-items: center;
  height: 100%;
}

.index-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0;
  margin-bottom: 3px;
}

.index-left {
  flex: 0 0 40%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: stretch;
}

.index-right {
  flex: 0 0 60%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.fund-code {
  font-size: 12px;
  font-weight: 700;
  font-family: var(--font-number);
  letter-spacing: -0.2px;
  color: var(--color-primary);
  margin-bottom: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: center;
}

.fund-sectors {
  font-size: 9px;
  color: var(--text-muted);
  line-height: 1.2;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: center;
  width: 100%;
}

.index-change {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  font-size: 14px;
  font-weight: 700;
  font-family: var(--font-number);
  padding: 6px 10px;
  border-radius: 8px;
  width: 100%;
  text-align: center;
  margin-right: 11px;
}

.index-item.up .index-change {
  color: var(--color-up);
  background: rgba(255, 107, 107, 0.12);
}

.index-item.down .index-change {
  color: var(--color-down);
  background: rgba(81, 207, 102, 0.12);
}

/* 趋势预测 */
.index-trend {
  padding: 8px 10px;
}

.index-trend .trend-prediction {
  display: flex;
  align-items: stretch;
  gap: 0;
  width: 100%;
}

.index-trend .trend-column {
  flex: 0 0 25%;
  width: 25%;
  max-width: 25%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 0 4px;
}

.index-trend .trend-column-1 {
  flex: 0 0 25%;
  width: 25%;
  max-width: 25%;
  border-right: 1px solid var(--border-color);
  padding-right: 8px;
}

.index-trend .trend-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  width: 100%;
  text-align: center;
}

.index-trend .trend-item-vertical {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  width: 100%;
}

.index-trend .trend-label {
  font-size: 10px;
  color: var(--text-secondary);
  text-align: center;
  line-height: 1.2;
}

.index-trend .trend-value {
  font-size: 12px;
  font-weight: 600;
  text-align: center;
  line-height: 1.2;
}

.index-trend .trend-text {
  font-size: 11px;
  font-weight: 500;
  text-align: center;
  line-height: 1.2;
}

.index-trend .trend-text.up {
  color: var(--color-up);
}

.index-trend .trend-text.down {
  color: var(--color-down);
}

.index-trend .trend-value.up {
  color: var(--color-up);
}

.index-trend .trend-value.down {
  color: var(--color-down);
}

/* 底部进度条效果 */
.index-bar {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 2px;
}

.index-item.up .index-bar {
  background: linear-gradient(90deg, transparent 0%, var(--color-up) 50%, transparent 100%);
}

.index-item.down .index-bar {
  background: linear-gradient(90deg, transparent 0%, var(--color-down) 50%, transparent 100%);
}

/* 全球指数 */
.global-indices {
  padding: 12px;
  background: var(--bg-secondary);
  margin: 8px 12px;
  border-radius: 12px;
}

.global-indices .section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  cursor: pointer;
}

.global-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
  margin-top: 12px;
}

.global-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  background: var(--bg-primary);
  border-radius: 8px;
}

.global-name {
  font-size: 12px;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.region-tag {
  font-size: 10px;
  padding: 1px 4px;
  border-radius: 3px;
  font-weight: 500;
  flex-shrink: 0;
}

.region-tag.cn { background: #fee2e2; color: #dc2626; }
.region-tag.hk { background: #fef3c7; color: #d97706; }
.region-tag.us { background: #dbeafe; color: #2563eb; }
.region-tag.eu { background: #e0e7ff; color: #4f46e5; }
.region-tag.asia { background: #d1fae5; color: #059669; }

.global-price {
  font-size: 13px;
  font-weight: 600;
  margin: 0 8px;
}

.global-change {
  font-size: 12px;
  font-weight: 500;
  min-width: 55px;
  text-align: right;
}

.global-item.up .global-price,
.global-item.up .global-change {
  color: var(--color-up);
}

.global-item.down .global-price,
.global-item.down .global-change {
  color: var(--color-down);
}

.expand-hint {
  text-align: center;
  font-size: 12px;
  color: var(--text-secondary);
  padding: 10px 0 4px;
  cursor: pointer;
}

/* 快捷入口 - 交易终端风格 */
.quick-actions {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
  padding: 16px 12px;
  margin: 0 12px 12px;
  background: var(--bg-secondary);
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-color);
}

.action-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 12px 4px;
  cursor: pointer;
  border-radius: var(--radius-md);
  transition: all 0.2s;
}

.action-item:active {
  background: var(--bg-active);
  transform: scale(0.95);
}

.action-icon {
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, var(--bg-tertiary) 0%, var(--bg-elevated) 100%);
  border-radius: var(--radius-md);
  color: var(--color-primary);
  border: 1px solid var(--border-color);
  transition: all 0.2s;
}

.action-item:active .action-icon {
  border-color: var(--color-primary);
  box-shadow: 0 0 12px rgba(255, 193, 7, 0.2);
}

.action-item span {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
}

/* 自选基金标题 */
.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px 8px;
}

.section-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.fund-count {
  font-size: 12px;
  color: var(--text-secondary);
}

/* 财经资讯 - 交易终端风格 */
.news-section {
  margin: 0 12px 12px;
  background: var(--bg-secondary);
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-color);
  overflow: hidden;
}

.news-section .section-header {
  padding: 14px 16px;
  border-bottom: 1px solid var(--border-color);
  background: linear-gradient(90deg, var(--bg-secondary) 0%, var(--bg-tertiary) 100%);
}

.news-section .section-title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.news-section .section-title::before {
  content: '';
  display: inline-block;
  width: 3px;
  height: 16px;
  background: var(--color-primary);
  border-radius: 2px;
}

.news-list {
  padding: 0;
}

.news-item {
  padding: 14px 16px;
  border-bottom: 1px solid var(--border-light);
  cursor: pointer;
  transition: all 0.2s;
  position: relative;
}

.news-item::before {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 2px;
  height: 0;
  background: var(--color-secondary);
  transition: height 0.2s;
}

.news-item:active::before {
  height: 60%;
}

.news-item:last-child {
  border-bottom: none;
}

.news-item:active {
  background: var(--bg-hover);
}

.news-content {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.news-title {
  font-size: 14px;
  color: var(--text-primary);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.news-meta {
  display: flex;
  gap: 12px;
  font-size: 12px;
  color: var(--text-secondary);
}

.news-source {
  color: var(--color-primary);
}

.news-loading {
  padding: 24px;
  display: flex;
  justify-content: center;
}

/* 全球主要指数样式 */
.market-index-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 6px;
}

.market-index-item {
  padding: 8px 6px;
  background: var(--bg-primary);
  border-radius: var(--radius-md);
  border: 1px solid var(--border-light);
  transition: all 0.2s;
  position: relative;
  overflow: hidden;
  cursor: pointer;
}

.market-index-item:active {
  transform: scale(0.98);
}

.market-index-item.up {
  border-color: rgba(255, 107, 107, 0.25);
  background: linear-gradient(135deg, var(--bg-primary) 0%, rgba(255, 107, 107, 0.05) 100%);
}

.market-index-item.down {
  border-color: rgba(81, 207, 102, 0.25);
  background: linear-gradient(135deg, var(--bg-primary) 0%, rgba(81, 207, 102, 0.05) 100%);
}

.market-index-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 6px;
}

.market-index-left {
  flex: 0 0 40%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.market-index-right {
  flex: 0 0 60%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.market-index-name {
  font-size: 10px;
  color: var(--text-secondary);
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
  height: 14px;
  line-height: 14px;
  margin-bottom: 2px;
}

.market-index-value {
  text-align: center;
}

.market-index-value-num {
  font-size: 13px;
  font-weight: 600;
  font-family: var(--font-number);
  color: var(--text-primary);
}

.market-index-change {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 14px;
  font-weight: 700;
  font-family: var(--font-number);
  text-align: center;
  padding: 4px 8px;
  border-radius: 6px;
  width: 100%;
  justify-content: center;
}

.market-index-item.up .market-index-change {
  color: var(--color-up);
}

.market-index-item.down .market-index-change {
  color: var(--color-down);
}

.market-index-bar {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 2px;
  margin-top: 4px;
}

.market-index-item.up .market-index-bar {
  background: linear-gradient(90deg, transparent 0%, var(--color-up) 50%, transparent 100%);
}

.market-index-item.down .market-index-bar {
  background: linear-gradient(90deg, transparent 0%, var(--color-down) 50%, transparent 100%);
}

/* 底部占位 */
.bottom-spacer {
  height: calc(60px + env(safe-area-inset-bottom, 0px));
}

.refresh-time {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 12px;
  font-size: 12px;
  color: var(--text-secondary);
  padding: 8px 0;
  background: var(--bg-primary);
}

.alert-badge {
  padding: 2px 8px;
  background: var(--color-primary);
  color: #fff;
  border-radius: 10px;
  font-size: 10px;
}

/* 提醒设置弹窗 */
.alert-dialog {
  padding: 16px;
  background: var(--bg-secondary);
}

.dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 16px;
  font-weight: 500;
  margin-bottom: 12px;
  color: var(--text-primary);
}

.dialog-fund {
  font-size: 14px;
  color: var(--text-secondary);
  padding: 12px 0;
  border-bottom: 1px solid var(--border-color);
  margin-bottom: 12px;
}

.dialog-footer {
  padding-top: 16px;
}

/* 资讯详情弹窗 */
.news-detail {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg-secondary);
}

.news-detail-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

.news-detail-content {
  flex: 1;
  padding: 16px;
  overflow-y: auto;
}

.news-detail-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
  line-height: 1.5;
  margin: 0 0 12px;
}

.news-detail-meta {
  display: flex;
  gap: 16px;
  font-size: 13px;
  color: var(--text-secondary);
  margin-bottom: 16px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border-color);
}

.news-detail-summary {
  font-size: 15px;
  line-height: 1.8;
  color: var(--text-primary);
}

.news-detail-footer {
  padding: 16px;
  border-top: 1px solid var(--border-color);
  flex-shrink: 0;
}

/* 移动端和网页端控制 */
@media (max-width: 767px) {
  /* 移动端：隐藏搜索框 */
  .search-bar {
    display: none;
  }
  
  /* 移动端：持仓趋势每行3个 */
  .index-grid {
    grid-template-columns: repeat(3, 1fr);
    gap: 0px;
    margin-top: 10px;
  }
  
  /* 移动端：item内部布局 */
  .mobile-item-layout {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 0px;
  }
  
  .mobile-item-row {
    display: flex;
    align-items: center;
    width: 100%;
  }
  
  /* 第一行：图标 + 基金名称 */
  .mobile-item-row-1 {
    min-height: 14px;
    padding: 0px 0;
  }
  
  .mobile-item-row-1 .fund-name-content {
    gap: 3px;
  }
  
  .mobile-item-row-1 .source-icon-small {
    width: 10px;
    height: 10px;
  }
  
  .mobile-item-row-1 .qdii-tag {
    font-size: 7px;
    padding: 1px 2px;
  }
  
  .mobile-item-row-1 .fund-name-right {
    font-size: 10px;
    line-height: 1.2;
  }
  
  /* 第二行：基金代码 和 行业板块 */
  .mobile-item-row-2 {
    justify-content: space-between;
    gap: 3px;
    min-height: 12px;
    padding: 0px 0;
  }
  
  .mobile-item-row-2 .fund-code {
    font-size: 9px;
    font-weight: 600;
    flex-shrink: 0;
  }
  
  .mobile-item-row-2 .fund-sectors {
    font-size: 8px;
    color: var(--text-secondary);
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  
  /* 第三行：涨跌幅模块 */
  .mobile-item-row-3 {
    justify-content: center;
    min-height: 14px;
    padding: 0px 0;
  }
  
  .mobile-item-row-3 .index-change {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 3px;
    font-size: 11px;
    font-weight: 600;
    margin-right: 0;
  }
  
  /* 第四行：趋势预测 */
  .mobile-item-row-4 {
    justify-content: space-between;
    min-height: 12px;
    padding: 0px 4px;
  }
  
  .mobile-item-row-4 .trend-prediction {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    gap: 4px;
  }
  
  .mobile-item-row-4 .trend-item {
    display: flex;
    align-items: center;
    gap: 2px;
    flex: 1;
  }
  
  .mobile-item-row-4 .trend-item-vertical {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    flex: 1;
  }
  
  .mobile-item-row-4 .trend-label {
    font-size: 8px;
    color: var(--text-secondary);
    flex-shrink: 0;
  }
  
  .mobile-item-row-4 .trend-value {
    font-size: 8px;
    font-weight: 600;
  }
  
  .mobile-item-row-4 .trend-value.up {
    color: var(--up-color);
  }
  
  .mobile-item-row-4 .trend-value.down {
    color: var(--down-color);
  }
  
  .mobile-item-row-4 .trend-text {
    font-size: 8px;
    font-weight: 500;
  }
  
  .mobile-item-row-4 .trend-text.up {
    color: var(--up-color);
  }
  
  .mobile-item-row-4 .trend-text.down {
    color: var(--down-color);
  }
  
  /* 移动端：全球主要指数布局 */
  .market-index-grid {
    grid-template-columns: repeat(3, 1fr);
    gap: 0px;
  }
  
  .mobile-market-layout {
    display: flex;
    flex-direction: column;
    gap: 0px;
    padding: 0px;
  }
  
  .mobile-market-row {
    display: flex;
    align-items: center;
    width: 100%;
  }
  
  /* 第一行：指数名称 */
  .mobile-market-row-1 {
    min-height: 16px;
    padding: 0px 0;
  }
  
  .mobile-market-row-1 .market-index-name {
    font-size: 10px;
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    width: 100%;
  }
  
  /* 第二行：涨跌幅度 */
  .mobile-market-row-2 {
    justify-content: center;
    min-height: 18px;
    padding: 0px 0;
  }
  
  .mobile-market-row-2 .market-index-change {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 3px;
    font-size: 11px;
    font-weight: 600;
  }
  
  /* 移动端：隐藏快捷入口和自选基金 */
  .quick-actions {
    display: none;
  }
  
  .section-header {
    display: none;
  }
  
  .refresh-time {
    display: none;
  }
  
  /* 移动端：标题和按钮在一行 */
  .top-header {
    flex-direction: row;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    padding-top: calc(8px + env(safe-area-inset-top, 0px));
  }
  
  .header-left {
    flex-shrink: 0;
  }
  
  .app-title {
    font-size: 16px;
  }
  
  .header-right {
    flex: 1;
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 8px;
  }
  
  .mobile-only {
    display: flex;
    align-items: center;
    gap: 0px;
  }
  
  .auto-refresh-label {
    font-size: 11px;
  }
}

@media (min-width: 768px) {
  .mobile-only {
    display: none !important;
  }
  
  /* 网页端：隐藏利润行 */
  .profit-row {
    display: none;
  }
  
  /* 网页端：显示网页端元素 */
  .web-only {
    display: block;
  }
  
  /* 网页端：确保按钮水平排列 */
  .web-only.web-only {
    display: flex;
    align-items: center;
    gap: 12px;
  }
}

@media (max-width: 767px) {
  .web-only {
    display: none !important;
  }
}

/* ========== 前10大重仓股 ========== */
.index-holdings {
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  margin-top: 2px;
  width: 100%;
}

.top-holdings-label {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  font-size: 11px;
  font-weight: 600;
  font-family: var(--font-number);
  padding: 3px 8px;
  border-radius: 6px;
  width: 100%;
  color: #05263b;
  background: linear-gradient(180deg, #0ea5e9, #22d3ee);
}

.top-holdings-arrow {
  color: #05263b;
}

/* ========== 当日分时估值 ========== */
.intraday-section {
  margin-top: 2px;
  overflow: hidden;
  width: 100%;
}

.intraday-arrow {
  color: #05263b;
  transition: transform 0.2s;
}

.intraday-label {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  font-size: 11px;
  font-weight: 600;
  font-family: var(--font-number);
  color: #05263b;
  background: linear-gradient(180deg, #0ea5e9, #22d3ee);
  border-radius: 6px;
  padding: 3px 8px;
  width: 100%;
  text-align: center;
}

.intraday-label-mobile {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  font-size: 11px;
  font-weight: 600;
  font-family: var(--font-number);
  color: #05263b;
  background: linear-gradient(180deg, #0ea5e9, #22d3ee);
  border-radius: 6px;
  padding: 3px 8px;
  text-align: center;
  width: 100%;
}

.intraday-time {
  font-size: 10px;
  color: #999;
}

.intraday-content {
  padding: 0 12px 8px;
}

.intraday-loading {
  display: flex;
  justify-content: center;
  padding: 20px 0;
}

.intraday-chart-wrapper {
  background: var(--bg-primary, rgba(0,0,0,0.02));
  border-radius: 8px;
  padding: 8px;
}

.intraday-summary {
  display: flex;
  justify-content: center;
  margin-bottom: 4px;
}

.intraday-latest {
  font-size: 13px;
  font-weight: 600;
}

.intraday-canvas {
  width: 100%;
  height: 140px;
}

.intraday-empty {
  text-align: center;
  padding: 20px 0;
  font-size: 12px;
  color: #999;
}

.mobile-item-row-5 {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 0;
  margin-top: 2px;
  cursor: pointer;
}

.top-holdings-popup {
  padding: 20px;
}

.top-holdings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.top-holdings-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.top-holdings-icon {
  font-size: 18px;
}

.top-holdings-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.top-holdings-fund-info {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 16px;
}

.top-holdings-fund-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.top-holdings-fund-code {
  font-size: 12px;
  color: var(--text-secondary);
}

.top-holdings-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 6px;
  max-height: 55vh;
  overflow-y: auto;
  overflow-x: hidden;
}

.top-holdings-card {
  background: var(--bg-primary);
  border-radius: 8px;
  padding: 8px 10px;
  border: 1px solid var(--border-light);
  overflow: hidden;
}

.thc-name {
  font-size: 12px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
  display: block;
  margin-bottom: 4px;
}

.thc-bottom {
  display: flex;
  align-items: center;
  gap: 6px;
}

.thc-change {
  font-size: 12px;
  font-weight: 600;
  padding: 1px 5px;
  border-radius: 3px;
  color: var(--text-secondary);
}

.thc-change.up {
  color: var(--color-up);
  background: rgba(255, 107, 107, 0.12);
}

.thc-change.down {
  color: var(--color-down);
  background: rgba(81, 207, 102, 0.12);
}

.thc-weight {
  font-size: 11px;
  color: var(--text-secondary);
}

.top-holdings-close-btn {
  width: 100%;
  height: 40px;
  margin-top: 16px;
  border: none;
  border-radius: 10px;
  background: linear-gradient(180deg, #0ea5e9, #22d3ee);
  color: #05263b;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.2s;
}

.top-holdings-close-btn:hover {
  opacity: 0.9;
}

.top-holdings-close-btn:active {
  opacity: 0.8;
}

.top-holdings-empty {
  text-align: center;
  padding: 30px 0;
  color: #999;
  font-size: 14px;
}

.top-holdings-loading {
  display: flex;
  justify-content: center;
  padding: 30px 0;
}

/* ========== 当日分时估值弹窗 ========== */
.intraday-popup {
  padding: 20px;
}

.intraday-popup-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.intraday-popup-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.intraday-popup-icon {
  color: var(--color-primary);
}

.intraday-popup-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.intraday-popup-fund-info {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 16px;
}

.intraday-popup-fund-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.intraday-popup-fund-code {
  font-size: 12px;
  color: var(--text-secondary);
}

.intraday-popup-chart {
  min-height: 200px;
}

.intraday-popup-chart-wrapper {
  background: var(--bg-primary, rgba(0,0,0,0.02));
  border-radius: 10px;
  padding: 12px;
}

.intraday-popup-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.intraday-popup-latest {
  font-size: 15px;
  font-weight: 600;
}

.intraday-popup-time {
  font-size: 12px;
  color: #999;
}

.intraday-popup-canvas {
  width: 100%;
  height: 220px;
}

.intraday-popup-empty {
  text-align: center;
  padding: 40px 0;
  color: #999;
  font-size: 14px;
}

.intraday-popup-loading {
  display: flex;
  justify-content: center;
  padding: 40px 0;
}

.intraday-popup-close-btn {
  width: 100%;
  height: 40px;
  margin-top: 16px;
  border: none;
  border-radius: 10px;
  background: linear-gradient(180deg, #0ea5e9, #22d3ee);
  color: #05263b;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.2s;
}

.intraday-popup-close-btn:hover {
  opacity: 0.9;
}

.intraday-popup-close-btn:active {
  opacity: 0.8;
}

/* ========== 观察基金分割线 ========== */
.observe-divider {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 8px;
  margin: 4px 0;
  grid-column: 1 / -1;
}

.observe-divider-line {
  flex: 1;
  height: 1px;
  background: repeating-linear-gradient(
    to right,
    var(--border-color) 0px,
    var(--border-color) 4px,
    transparent 4px,
    transparent 8px
  );
}

.observe-divider-text {
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
  font-weight: 500;
}

@media (max-width: 767px) {
  .observe-divider {
    padding: 8px 4px;
    margin: 2px 0;
  }
  
  .observe-divider-text {
    font-size: 11px;
  }
}

/* ========== 添加后涨幅 ========== */
.added-gain-section {
  margin-top: 2px;
  overflow: hidden;
  width: 100%;
}

.added-gain-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  font-size: 11px;
  font-weight: 600;
  font-family: var(--font-number);
  padding: 3px 8px;
  border-radius: 6px;
  width: 100%;
}

.added-gain-badge.up {
  color: var(--color-up);
  background: rgba(255, 107, 107, 0.12);
}

.added-gain-badge.down {
  color: var(--color-down);
  background: rgba(81, 207, 102, 0.12);
}

/* 移动端：去掉累计涨幅背景色，减小字体 */
@media (max-width: 767px) {
  .added-gain-badge.up,
  .added-gain-badge.down {
    background: transparent;
  }
  
  .mobile-added-gain {
    font-size: 10px;
    gap: 0;
  }
}
</style>
