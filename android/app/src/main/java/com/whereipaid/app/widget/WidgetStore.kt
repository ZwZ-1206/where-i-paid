package com.whereipaid.app.widget

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject

/**
 * 桌面小组件的数据源。
 *
 * 数据流向只有一个方向：**网页 → 原生**。
 * 账目本身在 WebView 的 localStorage 里（origin 是 appassets 虚拟域名），
 * Kotlin 侧碰不到，也不该去碰（直接读 WebStorage 的 LevelDB 属于 Hack，
 * 系统一升级就崩）。所以网页侧（assets/js/widget.js）在每次数据变动后，
 * 把一份**聚合好的快照**交给这里，小组件只读快照。
 *
 * 快照为什么是「按天」而不是「一个数」：
 * 小组件会被系统每半小时重画一次，但只要用户今天没打开 App，JS 就不会推数。
 * 若快照只存「今日支出 = 88 元」，跨过零点后它还会显示昨天的 88 元。
 * 存成「近 92 天每天的合计」，原生侧用**本机当前日期**自己去取当天那一格，
 * 跨零点自动清零 —— 这是唯一不用后台就正确的做法。
 */
internal object WidgetStore {

    private const val PREFS = "jizhang_widget"
    private const val KEY_JSON = "snapshot"
    /** 92 天 × 每条约 30 字节 ≈ 3KB，安全上限给到 200KB */
    private const val MAX_JSON = 200_000

    fun prefs(context: Context): SharedPreferences =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** 存一份新快照。格式不对就拒绝，宁可显示旧的也不要显示错的。 */
    fun save(context: Context, raw: String?): Boolean {
        val text = raw ?: return false
        if (text.isBlank() || text.length > MAX_JSON) return false
        val ok = try {
            val o = JSONObject(text)
            o.optInt("v", 0) >= 1 && o.optJSONArray("days") != null
        } catch (e: Exception) {
            false
        }
        if (!ok) return false
        prefs(context).edit().putString(KEY_JSON, text).apply()
        return true
    }

    fun raw(context: Context): String? = prefs(context).getString(KEY_JSON, null)

    /** 老用户在装这个版本之前不会有任何快照，这时要显示「去记一笔」而不是 0 元 */
    fun hasSnapshot(context: Context): Boolean = !raw(context).isNullOrBlank()

    fun clear(context: Context) {
        prefs(context).edit().remove(KEY_JSON).apply()
    }

    /**
     * 解析快照。任何一处字段缺失都给默认值，绝不抛到外面去
     * —— 解析异常一旦逃逸，onUpdate 里崩的是 Launcher 的进程分支，
     * 表现就是「小组件白屏且再也刷不出来」。
     */
    fun parse(text: String?): Snapshot? {
        if (text.isNullOrBlank()) return null
        return try {
            val o = JSONObject(text)

            val days = ArrayList<Day>(92)
            val arr: JSONArray? = o.optJSONArray("days")
            if (arr != null) {
                for (i in 0 until arr.length()) {
                    val it = arr.optJSONObject(i) ?: continue
                    val key = it.optString("d", "")
                    if (key.length != 10) continue          // 只认 YYYY-MM-DD
                    days.add(
                        Day(
                            key = key,
                            expense = it.optLong("e", 0L),
                            count = it.optInt("c", 0),
                        )
                    )
                }
            }
            days.sortBy { it.key }

            val recent = ArrayList<Recent>(4)
            val ra = o.optJSONArray("recent")
            if (ra != null) {
                for (i in 0 until ra.length()) {
                    val it = ra.optJSONObject(i) ?: continue
                    recent.add(
                        Recent(
                            icon = it.optString("i", "💰"),
                            title = it.optString("t", ""),
                            dayLabel = it.optString("d", ""),
                            amount = it.optLong("a", 0L),
                        )
                    )
                }
            }

            val period = o.optJSONObject("period")
            val s = Snapshot(
                at = o.optLong("at", 0L),
                days = days,
                recent = recent,
                periodLabel = period?.optString("label", "") ?: "",
                periodStart = period?.optLong("start", 0L) ?: 0L,
                periodEnd = period?.optLong("end", 0L) ?: 0L,
                periodExpense = period?.optLong("expense", 0L) ?: 0L,
                budget = o.optJSONObject("budget")?.optLong("amount", 0L) ?: 0L,
                symbol = o.optString("sym", "¥").ifBlank { "¥" },
            )
            s
        } catch (e: Exception) {
            null
        }
    }
}

/** 某一天的支出合计。金额单位与网页侧一致：**分** */
internal data class Day(val key: String, val expense: Long, val count: Int)

/** 最近的一笔账（只带显示所需的最小字段） */
internal data class Recent(val icon: String, val title: String, val dayLabel: String, val amount: Long)

internal data class Snapshot(
    val at: Long,
    val days: List<Day>,
    val recent: List<Recent>,
    /** 当前记账周期的标签，例如「2026年10月」 */
    val periodLabel: String,
    val periodStart: Long,
    val periodEnd: Long,
    val periodExpense: Long,
    /** 周期预算（分）；0 表示没设预算 */
    val budget: Long,
    /** 当前账本的货币符号（外币账本由网页侧给，缺省 ¥） */
    val symbol: String,
)
