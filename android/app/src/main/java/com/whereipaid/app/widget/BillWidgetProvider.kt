package com.whereipaid.app.widget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * 花哪儿了 · 桌面小组件（基类）。
 *
 * 为什么是「一个基类 + 三个只有一行代码的子类」：
 * 一个 `appwidget-provider` 元信息在桌面里就是**一条入口**，而 MIUI / ColorOS /
 * OneUI 这类桌面大多不支持长按缩放。想让用户在添加时就能挑大小，只能注册多个
 * receiver —— 每个 receiver 有自己的 minWidth/minHeight 与 initialLayout。
 * 三个子类里唯一的区别就是 `tier`，其余逻辑全在基类，不会分叉。
 *
 * 刷新时机只有三处：
 *   1. 网页侧数据变动 → MainActivity.WidgetBridge.postSnapshot() → updateAll()
 *   2. 系统按 updatePeriodMillis（30 分钟）兜底一轮 → 这里
 *   3. 用户点了卡片右上角的刷新按钮
 *
 * 为什么还要 2：快照按天存，跨零点后「今日支出」要变 0，而此时网页还没跑起来。
 * 每半小时用**本机当前日期**重画一次，不用后台进程也能做对
 * （updatePeriodMillis 的下限就是 30 分钟，再密系统也不给）。
 */
open class BillWidgetProvider : AppWidgetProvider() {

    protected open val tier: WidgetTier get() = WidgetTier.STANDARD

    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray,
    ) {
        BillWidgetUpdater.update(context, appWidgetManager, appWidgetIds, tier)
    }

    /** 用户拉伸卡片后按新尺寸重挑版式 */
    override fun onAppWidgetOptionsChanged(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetId: Int,
        newOptions: android.os.Bundle,
    ) {
        BillWidgetUpdater.update(context, appWidgetManager, intArrayOf(appWidgetId), tier)
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == ACTION_REFRESH) {
            BillWidgetUpdater.updateAll(context)
            return
        }
        super.onReceive(context, intent)
    }

    companion object {
        const val ACTION_REFRESH = "com.whereipaid.app.widget.REFRESH"

        /** 网页推来新快照 / 点了刷新：把三个尺寸入口下的所有卡片都重画 */
        fun updateAll(context: Context) = BillWidgetUpdater.updateAll(context)
    }
}

/** 迷你 2×1（110×40dp）：一行，图标 + 今日金额 + 记一笔 */
class BillWidgetCompactProvider : BillWidgetProvider() {
    override val tier: WidgetTier get() = WidgetTier.COMPACT
}

/** 标准 4×2（250×110dp）：今日金额 + 本月 + 预算进度 */
class BillWidgetStandardProvider : BillWidgetProvider() {
    override val tier: WidgetTier get() = WidgetTier.STANDARD
}

/** 大号 4×3（250×180dp）：再多周期预算，拉高到 4×4 还有柱图与最近三笔 */
class BillWidgetLargeProvider : BillWidgetProvider() {
    override val tier: WidgetTier get() = WidgetTier.LARGE
}

internal object BillWidgetUpdater {

    private val PROVIDERS: List<Pair<Class<out BillWidgetProvider>, WidgetTier>> = listOf(
        BillWidgetCompactProvider::class.java to WidgetTier.COMPACT,
        BillWidgetStandardProvider::class.java to WidgetTier.STANDARD,
        BillWidgetLargeProvider::class.java to WidgetTier.LARGE,
    )

    fun update(
        context: Context,
        manager: AppWidgetManager,
        ids: IntArray,
        tier: WidgetTier,
    ) {
        val app = context.applicationContext
        // 快照只读一次：这是一次 SharedPreferences 读 + 一次 JSON 解析，比每个 id 各读一遍便宜
        val snap = try {
            WidgetStore.parse(WidgetStore.raw(app))
        } catch (e: Exception) {
            null
        }
        for (id in ids) {
            try {
                val options = manager.getAppWidgetOptions(id)
                val minW = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 250)
                val minH = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, defaultHeight(tier))
                manager.updateAppWidget(id, BillWidgetRenderer.build(app, snap, tier, minW, minH))
            } catch (e: Exception) {
                // 关键：构建失败也必须回传一个**合法**的 RemoteViews，
                // 否则这块卡片会一直停在桌面的「载入窗口小部件时出现问题」上，
                // 而且下一次数据到来之前都不会自愈。
                Log.w("Huanaer", "小组件重画失败，回退到占位画面", e)
                try {
                    manager.updateAppWidget(id, BillWidgetRenderer.placeholder(app, tier))
                } catch (e2: Exception) {
                    Log.w("Huanaer", "连占位画面都失败", e2)
                }
            }
        }
    }

    /** 桌面没给 options（刚绑定那一刻常见）时用的兜底高度 */
    private fun defaultHeight(tier: WidgetTier): Int = when (tier) {
        WidgetTier.COMPACT -> 40
        WidgetTier.STANDARD -> 110
        WidgetTier.LARGE -> 180
    }

    fun updateAll(context: Context) {
        val app = context.applicationContext
        val manager = AppWidgetManager.getInstance(app)
        for ((cls, tier) in PROVIDERS) {
            val ids = try {
                manager.getAppWidgetIds(ComponentName(app, cls))
            } catch (e: Exception) {
                continue
            }
            if (ids.isNotEmpty()) update(app, manager, ids, tier)
        }
    }
}
