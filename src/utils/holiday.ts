/**
 * 节假日工具函数
 * [WHY] 用于判断某个日期是否是法定节假日，支持缓存以减少API调用
 */

interface HolidayInfo {
  code: number
  type: {
    type: number // 0工作日、1周末、2节日、3调休放假、4补班
    name: string
  }
  holiday?: {
    holiday: boolean
    name: string
    wage: number
    date: string
    rest: number
  }
}

// 节假日缓存（内存缓存，避免频繁请求API）
const holidayCache = new Map<string, HolidayInfo>()

/**
 * 同步判断某个日期是否是节假日（使用缓存）
 * [WHY] 用于同步代码中，先检查缓存，如果没有缓存则使用硬编码判断
 * @param date 日期字符串，格式 '2026-06-19'
 * @returns boolean true表示是节假日，false表示不是
 */
export function isHolidaySync(date: string): boolean {
  // 先检查缓存
  if (holidayCache.has(date)) {
    const info = holidayCache.get(date)!
    // type: 2节日、3调休放假 表示节假日
    return info.type.type === 2 || info.type.type === 3
  }

  // 缓存中没有，使用硬编码判断（2026年节假日）
  const holidays2026 = [
    '2026-01-01', '2026-01-02', '2026-01-03', // 元旦
    '2026-02-15', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20', '2026-02-21', '2026-02-22', '2026-02-23', // 春节
    '2026-04-04', '2026-04-05', '2026-04-06', // 清明节
    '2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05', // 劳动节
    '2026-06-19', '2026-06-20', '2026-06-21', // 端午节
    '2026-09-25', '2026-09-26', '2026-09-27', // 中秋节
    '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07' // 国庆节
  ]

  const isHolidayResult = holidays2026.includes(date)

  // 异步更新缓存（不阻塞主线程）
  isHoliday(date).catch(err => {
    console.warn('[节假日缓存更新失败]', date, err)
  })

  return isHolidayResult
}

/**
 * 查询某个日期是否是节假日
 * @param date 日期字符串，格式 '2026-06-19'
 * @returns Promise<boolean> true表示是节假日，false表示不是
 */
export async function isHoliday(date: string): Promise<boolean> {
  // 先检查缓存
  if (holidayCache.has(date)) {
    const info = holidayCache.get(date)!
    // type: 2节日、3调休放假 表示节假日
    return info.type.type === 2 || info.type.type === 3
  }

  try {
    // 调用节假日API
    const response = await fetch(`https://holiday.ailcc.com/api/holiday/info/${date}`)
    const data: HolidayInfo = await response.json()

    // 存入缓存
    holidayCache.set(date, data)

    // type: 2节日、3调休放假 表示节假日
    return data.type.type === 2 || data.type.type === 3
  } catch (error) {
    console.error('[节假日查询失败]', date, error)
    // API调用失败时，返回false（保守处理）
    return false
  }
}

/**
 * 获取前一个工作日（跳过周末和节假日）
 * @param date 当前日期
 * @returns string 前一个工作日的日期字符串（同步版本，使用缓存）
 */
export function getPrevWorkdaySync(date: string): string {
  const dateObj = new Date(date)
  let prevDate = new Date(dateObj)
  prevDate.setDate(prevDate.getDate() - 1)

  let prevDateStr = prevDate.toISOString().split('T')[0]
  const dayOfWeek = prevDate.getDay()

  // 如果是周末，先跳到上周五
  if (dayOfWeek === 0) {
    // 周日 → 上周五（2天前）
    prevDate.setDate(prevDate.getDate() - 2)
    prevDateStr = prevDate.toISOString().split('T')[0]
  } else if (dayOfWeek === 6) {
    // 周六 → 昨天（周五）
    prevDate.setDate(prevDate.getDate() - 1)
    prevDateStr = prevDate.toISOString().split('T')[0]
  }

  // 检查是否是节假日，如果是则继续往前推
  let maxAttempts = 10 // 最多往前推10天，避免死循环
  while (maxAttempts > 0) {
    const isHolidayResult = isHolidaySync(prevDateStr)
    if (!isHolidayResult) {
      // 不是节假日，返回这个日期
      return prevDateStr
    }

    // 是节假日，继续往前推一天
    prevDate.setDate(prevDate.getDate() - 1)
    prevDateStr = prevDate.toISOString().split('T')[0]
    maxAttempts--
  }

  // 如果推了10天还是节假日，直接返回当前的前一天（兜底逻辑）
  console.warn('[获取前一个工作日失败]', date, '已往前推10天仍为节假日')
  return prevDateStr
}

/**
 * 获取前一个工作日（跳过周末和节假日）- 异步版本
 * @param date 当前日期
 * @returns Promise<string> 前一个工作日的日期字符串
 */
export async function getPrevWorkday(date: string): Promise<string> {
  const dateObj = new Date(date)
  let prevDate = new Date(dateObj)
  prevDate.setDate(prevDate.getDate() - 1)

  let prevDateStr = prevDate.toISOString().split('T')[0]
  const dayOfWeek = prevDate.getDay()

  // 如果是周末，先跳到上周五
  if (dayOfWeek === 0) {
    // 周日 → 上周五（2天前）
    prevDate.setDate(prevDate.getDate() - 2)
    prevDateStr = prevDate.toISOString().split('T')[0]
  } else if (dayOfWeek === 6) {
    // 周六 → 昨天（周五）
    prevDate.setDate(prevDate.getDate() - 1)
    prevDateStr = prevDate.toISOString().split('T')[0]
  }

  // 检查是否是节假日，如果是则继续往前推
  let maxAttempts = 10 // 最多往前推10天，避免死循环
  while (maxAttempts > 0) {
    const isHolidayResult = await isHoliday(prevDateStr)
    if (!isHolidayResult) {
      // 不是节假日，返回这个日期
      return prevDateStr
    }

    // 是节假日，继续往前推一天
    prevDate.setDate(prevDate.getDate() - 1)
    prevDateStr = prevDate.toISOString().split('T')[0]
    maxAttempts--
  }

  // 如果推了10天还是节假日，直接返回当前的前一天（兜底逻辑）
  console.warn('[获取前一个工作日失败]', date, '已往前推10天仍为节假日')
  return prevDateStr
}

/**
 * 清空节假日缓存
 */
export function clearHolidayCache(): void {
  holidayCache.clear()
}
