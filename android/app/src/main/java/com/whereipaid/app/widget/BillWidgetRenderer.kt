package com.whereipaid.app.widget

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.net.Uri
import android.os.Build
import android.view.View
import android.widget.RemoteViews
import com.whereipaid.app.MainActivity
import com.whereipaid.app.R
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

/**
 * 三档起始尺寸。只决定「拖进桌面时多大、先用哪套布局」，内容仍按实际高度开。
 * 注意没有 `internal`：它在 public 的 *Provider 子类里被 override，
 * 类型若比属性窄，Kotlin 会直接报 "exposes its internal type"。
 */
enum class WidgetTier { COMPACT, STANDARD, LARGE }

/**
 * 小组件画面渲染（RemoteViews）。
 *
 * ★★ 最重要的一条（踩过坑，写在这里防止再犯）★★
 * 布局**不是在 App 进程里 inflate 的，而是在桌面进程里 inflate 的**。
 * 桌面有一份严格的 View 类白名单，裸 `<View>`、`<Space>`、自定义 View 都会被
 * `LayoutInflater.failNotAllowed` 拒绝，抛
 * `InflateException: Class not allowed to be inflated android.view.View`。
 * **这个异常发生在桌面进程，本文件里的 try/catch 抓不到**，用户看到的就是
 * 桌面自己画的「载入窗口小部件时出现问题」。
 * 所以：布局里只用 LinearLayout / TextView / ImageView；要撑条就用 ImageView 加
 * weight，或者干脆用 TextView 的 weight；ProgressBar 这种「白名单边缘 + 依赖主题
 * 属性」的控件也不用 —— 预算进度和柱图都改成 Canvas 画位图再贴到 ImageView 上。
 *
 * 另外两条：
 *  1. 日期一律用**本机当前时间**现算，不信快照里的时间戳（跨零点/改时区都会错）。
 *  2. 金额单位统一「分」，格式化只在这里做，避免和网页侧口径打架。
 */
internal object BillWidgetRenderer {

    fun build(
        context: Context,
        snap: Snapshot?,
        tier: WidgetTier,
        minWidthDp: Int,
        minHeightDp: Int,
    ): RemoteViews {
        val app = context.applicationContext
        // 迷你档被拉高了就按标准档渲染（用户显然想要更多信息）
        return if (tier == WidgetTier.COMPACT && minHeightDp < 96) {
            buildCompact(app, snap, minWidthDp)
        } else {
            buildFull(app, snap, minWidthDp, minHeightDp)
        }
    }

    /** 兜底画面：数据构建抛异常时也要回传一个合法布局，否则桌面会一直显示错误占位图 */
    fun placeholder(context: Context, tier: WidgetTier): RemoteViews {
        val app = context.applicationContext
        return build(app, null, tier, 250, if (tier == WidgetTier.COMPACT) 40 else 110)
    }

    // ------------------------------------------------------------
    // 迷你 2×1
    // ------------------------------------------------------------
    private fun buildCompact(app: Context, snap: Snapshot?, minWidthDp: Int): RemoteViews {
        val res = app.resources
        val v = RemoteViews(app.packageName, R.layout.widget_bill_compact)
        v.setOnClickPendingIntent(R.id.wc_root, routeIntent(app, null))
        v.setOnClickPendingIntent(R.id.wc_btn_add, routeIntent(app, "add"))

        // 窄到 110dp 时先丢图标，再丢文字标签；金额永远在
        v.setViewVisibility(R.id.wc_icon, if (minWidthDp >= 135) View.VISIBLE else View.GONE)
        v.setViewVisibility(R.id.wc_label, if (minWidthDp >= 170) View.VISIBLE else View.GONE)
        v.setViewVisibility(R.id.wc_add_text, if (minWidthDp >= 200) View.VISIBLE else View.GONE)

        if (snap == null) {
            v.setTextViewText(R.id.wc_amount, res.getString(R.string.widget_placeholder))
            return v
        }
        val today = snap.days.firstOrNull { it.key == todayKey() }
        if (today == null && snap.at < startOfToday()) {
            // 快照是昨天之前推的，今天这一格压根不存在 —— 显示 ¥0.00 是骗人
            v.setTextViewText(R.id.wc_amount, res.getString(R.string.widget_placeholder))
        } else {
            v.setTextViewText(R.id.wc_amount, money(today?.expense ?: 0L, snap.symbol))
        }
        return v
    }

    // ------------------------------------------------------------
    // 标准 4×2 / 大号 4×3+
    // ------------------------------------------------------------
    private fun buildFull(app: Context, snap: Snapshot?, minWidthDp: Int, minHeightDp: Int): RemoteViews {
        val res = app.resources
        val v = RemoteViews(app.packageName, R.layout.widget_bill)

        // 高度预算（详见 widget_bill.xml 头部注释）：
        //   固定部分 ≈ 102dp（padding 18 + 头部 26 + 小标题 14 + 金额 29 + 副标题 15）
        //   周期/预算 ≈ +48、柱图 ≈ +46、最近三笔 ≈ +50
        // 所以 4×2（110dp）只放固定部分；4×3（180dp）能多一个周期；4×4 才有柱图和清单。
        val showPeriod = minHeightDp >= 150 && minWidthDp >= 160
        val showChart = minHeightDp >= 215 && minWidthDp >= 220
        val showRecent = minHeightDp >= 250 && minWidthDp >= 170
        val showAddText = minWidthDp >= 200

        v.setOnClickPendingIntent(R.id.w_root, routeIntent(app, null))
        v.setOnClickPendingIntent(R.id.w_btn_refresh, refreshIntent(app))
        v.setOnClickPendingIntent(R.id.w_btn_add, routeIntent(app, "add"))
        v.setViewVisibility(R.id.w_add_text, if (showAddText) View.VISIBLE else View.GONE)

        if (snap == null) {
            v.setTextViewText(R.id.w_today, res.getString(R.string.widget_placeholder))
            v.setTextViewText(R.id.w_today_sub, res.getString(R.string.widget_empty))
            v.setViewVisibility(R.id.w_period_row, View.GONE)
            v.setViewVisibility(R.id.w_recent, View.GONE)
            v.setViewVisibility(R.id.w_chart, View.GONE)
            return v
        }

        val todayKey = todayKey()
        val today = snap.days.firstOrNull { it.key == todayKey }
        val yesterday = snap.days.firstOrNull { it.key == dayKey(-1) }
        val monthPrefix = todayKey.substring(0, 7)
        val monthSum = snap.days.filter { it.key.startsWith(monthPrefix) }.sumOf { it.expense }

        val staleToday = today == null && snap.at < startOfToday()
        if (staleToday) {
            v.setTextViewText(R.id.w_today, res.getString(R.string.widget_placeholder))
            v.setTextViewText(R.id.w_today_sub, res.getString(R.string.widget_not_synced))
        } else {
            v.setTextViewText(R.id.w_today, money(today?.expense ?: 0L, snap.symbol))
            v.setTextViewText(
                R.id.w_today_sub,
                subLine(res, snap.symbol, today, yesterday, monthSum, minWidthDp >= 170)
            )
        }

        // 周期 + 预算：只在「当前时间确实落在这一期内」才显示。
        // 快照里的周期是推送那一刻算的，过了周期末它就是上一期的数，
        // 显示出来比不显示更糟（用户会以为刚省下的钱又花掉了）。
        val now = System.currentTimeMillis()
        val periodLive = snap.periodLabel.isNotBlank() &&
            snap.periodEnd > 0 && now in snap.periodStart..snap.periodEnd
        if (showPeriod && periodLive) {
            v.setViewVisibility(R.id.w_period_row, View.VISIBLE)
            v.setTextViewText(R.id.w_period_label, snap.periodLabel)
            v.setTextViewText(R.id.w_period_amount, money(snap.periodExpense, snap.symbol))
            if (snap.budget > 0) {
                val pct = (snap.periodExpense * 100.0 / snap.budget).toFloat().coerceIn(0f, 100f)
                val bmp = drawProgress(app, pct)
                if (bmp != null) {
                    v.setViewVisibility(R.id.w_progress, View.VISIBLE)
                    v.setImageViewBitmap(R.id.w_progress, bmp)
                } else {
                    v.setViewVisibility(R.id.w_progress, View.GONE)
                }
                v.setTextViewText(
                    R.id.w_budget_hint,
                    "预算 ${money(snap.budget, snap.symbol)} · 已用 ${pct.toInt()}%"
                )
            } else {
                v.setViewVisibility(R.id.w_progress, View.GONE)
                v.setTextViewText(R.id.w_budget_hint, res.getString(R.string.widget_no_budget))
            }
        } else {
            v.setViewVisibility(R.id.w_period_row, View.GONE)
        }

        if (showRecent && snap.recent.isNotEmpty()) {
            v.setViewVisibility(R.id.w_recent, View.VISIBLE)
            val rowIds = intArrayOf(R.id.w_r1_row, R.id.w_r2_row, R.id.w_r3_row)
            val iconIds = intArrayOf(R.id.w_r1_icon, R.id.w_r2_icon, R.id.w_r3_icon)
            val titleIds = intArrayOf(R.id.w_r1_title, R.id.w_r2_title, R.id.w_r3_title)
            val amountIds = intArrayOf(R.id.w_r1_amount, R.id.w_r2_amount, R.id.w_r3_amount)
            for (i in rowIds.indices) {
                val item = snap.recent.getOrNull(i)
                if (item == null) {
                    v.setViewVisibility(rowIds[i], View.GONE)
                    continue
                }
                v.setViewVisibility(rowIds[i], View.VISIBLE)
                v.setTextViewText(iconIds[i], item.icon)
                v.setTextViewText(
                    titleIds[i],
                    if (item.dayLabel.isBlank()) item.title else "${item.dayLabel} ${item.title}"
                )
                v.setTextViewText(amountIds[i], "-${stripSymbol(money(item.amount, snap.symbol))}")
            }
        } else {
            v.setViewVisibility(R.id.w_recent, View.GONE)
        }

        val chart = if (showChart) draw7Day(app, snap, todayKey) else null
        if (chart != null) {
            v.setViewVisibility(R.id.w_chart, View.VISIBLE)
            v.setImageViewBitmap(R.id.w_chart, chart)
        } else {
            v.setViewVisibility(R.id.w_chart, View.GONE)
        }

        return v
    }

    /** 「今天已记 3 笔 · 本月 ¥xxx」这种一行流：没记账时退到昨天，给个参照 */
    private fun subLine(
        res: android.content.res.Resources,
        symbol: String,
        today: Day?,
        yesterday: Day?,
        monthSum: Long,
        showMonth: Boolean,
    ): String {
        val tail = if (showMonth) " · 本月 ${money(monthSum, symbol)}" else ""
        val todayCents = today?.expense ?: 0L
        val y = yesterday?.expense ?: 0L
        return when {
            todayCents > 0 -> "今天已记 ${today?.count ?: 0} 笔$tail"
            y > 0 -> "昨天 ${money(y, symbol)}$tail"
            else -> res.getString(R.string.widget_today_none) + tail
        }
    }

    // ------------------------------------------------------------
    // 位图（RemoteViews 画不了自定义 View，但可以贴 Bitmap）
    // ------------------------------------------------------------

    /**
     * 预算进度条。密度封顶 2 —— Binder 传 RemoteViews 有体积上限，
     * 3 倍屏的满宽位图很容易顶到那条线。
     */
    private fun drawProgress(context: Context, pct: Float): Bitmap? {
        return try {
            val density = minOf(context.resources.displayMetrics.density, 2f)
            val w = (320 * density).toInt()
            val h = (6 * density).toInt()
            if (w <= 0 || h <= 0) return null
            val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
            val canvas = Canvas(bmp)
            val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
            val r = h / 2f
            paint.color = 0xFFEDEFF5.toInt()
            canvas.drawRoundRect(0f, 0f, w.toFloat(), h.toFloat(), r, r, paint)
            val fill = (w * pct / 100f).coerceIn(0f, w.toFloat())
            if (fill > 0f) {
                paint.color = 0xFF4F7CFF.toInt()
                canvas.drawRoundRect(0f, 0f, fill, h.toFloat(), r, r, paint)
            }
            bmp
        } catch (e: Exception) {
            null
        }
    }

    /** 近 7 天柱图：只画柱子不画刻度，卡片上没人会去读坐标 */
    private fun draw7Day(context: Context, snap: Snapshot, todayKeyStr: String): Bitmap? {
        val days = (0..6).map { keyOf(System.currentTimeMillis() - (6 - it) * 86_400_000L) }
        val values = days.map { k -> snap.days.firstOrNull { it.key == k }?.expense ?: 0L }
        val max = values.maxOrNull() ?: 0L
        if (max <= 0L) return null      // 一周都没花钱，画一排空柱子没意义
        return try {
            val density = minOf(context.resources.displayMetrics.density, 2f)
            val w = (320 * density).toInt()
            val h = (38 * density).toInt()
            val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
            val canvas = Canvas(bmp)
            val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
            val slot = w / 7f
            val barW = slot * 0.52f
            val baseY = h - 2f * density
            val usableH = baseY - 4f * density
            values.forEachIndexed { i, value ->
                val ratio = (value.toFloat() / max.toFloat()).coerceIn(0f, 1f)
                val barH = maxOf(2f * density, usableH * ratio)
                val left = slot * i + (slot - barW) / 2f
                paint.color = if (days[i] == todayKeyStr) 0xFF4F7CFF.toInt() else 0xFFD6E0FF.toInt()
                canvas.drawRoundRect(left, baseY - barH, left + barW, baseY, barW / 2f, barW / 2f, paint)
            }
            bmp
        } catch (e: Exception) {
            null
        }
    }

    // ------------------------------------------------------------
    // 点击
    // ------------------------------------------------------------

    /** 回 App，可选带一个落地页。data 必须各不相同，否则 PendingIntent 会复用上一次的 extras */
    private fun routeIntent(context: Context, route: String?): PendingIntent {
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                Intent.FLAG_ACTIVITY_CLEAR_TOP or
                Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra(MainActivity.EXTRA_ROUTE, route ?: "")
        }
        intent.data = Uri.parse("jz://open/${route ?: "home"}")
        return PendingIntent.getActivity(context, 11, intent, pendingFlags())
    }

    /** 「刷新」：不唤醒网页（后台做不到），只用当前日期把缓存里的快照重画一遍 */
    private fun refreshIntent(context: Context): PendingIntent {
        val intent = Intent(context, BillWidgetProvider::class.java)
            .setAction(BillWidgetProvider.ACTION_REFRESH)
            .setPackage(context.packageName)
        return PendingIntent.getBroadcast(context, 12, intent, pendingFlags())
    }

    private fun pendingFlags(): Int {
        var f = PendingIntent.FLAG_UPDATE_CURRENT
        if (Build.VERSION.SDK_INT >= 23) f = f or PendingIntent.FLAG_IMMUTABLE
        return f
    }

    // ------------------------------------------------------------
    // 日期
    // ------------------------------------------------------------
    private fun keyOf(ms: Long): String =
        SimpleDateFormat("yyyy-MM-dd", Locale.CHINA).format(Date(ms))

    fun todayKey(): String = keyOf(System.currentTimeMillis())

    private fun dayKey(offsetDays: Int): String =
        keyOf(System.currentTimeMillis() + offsetDays * 86_400_000L)

    private fun startOfToday(): Long = Calendar.getInstance().apply {
        set(Calendar.HOUR_OF_DAY, 0)
        set(Calendar.MINUTE, 0)
        set(Calendar.SECOND, 0)
        set(Calendar.MILLISECOND, 0)
    }.timeInMillis

    // ------------------------------------------------------------
    // 金额格式
    // ------------------------------------------------------------
    /** 分 → ¥xxx；大额降级成「万」，小额保留两位 —— 小组件就这么点地方 */
    fun money(cents: Long, symbol: String = "¥"): String {
        val abs = kotlin.math.abs(cents)
        val sign = if (cents < 0) "-" else ""
        return when {
            abs >= 1_000_000L -> "$sign$symbol${String.format(Locale.CHINA, "%.2f万", abs / 1_000_000.0)}"
            abs >= 100_000L -> "$sign$symbol${String.format(Locale.CHINA, "%,.0f", abs / 100.0)}"
            else -> "$sign$symbol${String.format(Locale.CHINA, "%.2f", abs / 100.0)}"
        }
    }

    private fun stripSymbol(text: String): String {
        for (i in text.indices) {
            val c = text[i]
            if (c.isDigit() || c == '.') return text.substring(i)
        }
        return text
    }
}
