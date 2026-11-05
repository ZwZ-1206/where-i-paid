package com.whereipaid.app

import android.app.Activity
import android.app.DownloadManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.Settings
import android.util.Log
import android.widget.Toast
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File

/**
 * App 内更新的下载与安装。
 *
 * ## 这个文件为什么存在（v1.19.0 修的坑）
 *
 * 老实现把安装包下到 **App 私有外部目录**
 * （`/sdcard/Android/data/<包名>/files/Download/`），引发两个线上症状：
 *
 * 1. **文件管理器里找不到安装包** —— Android 11+ 起 `Android/data/<包名>/`
 *    对所有文件管理器（含系统「文件」App）不可见，scoped storage 的硬限制。
 * 2. **点完成通知无法跳转安装** —— 安装器是另一个 UID 的独立进程，读不了
 *    App 的私有外部目录；系统完成通知发出的 VIEW 意图指向一个它打不开的
 *    文件，于是静默失败。老代码注释里「系统通知本身就能点开安装」的假设
 *    只在文件落在安装器可读的位置时成立。
 *
 * 新实现四件事：
 *
 * 1. 下载目的地改成**公共 Downloads 目录**（文件管理器可见、安装器可读）。
 *    API 29+ 由系统服务代写，不需要存储权限；老系统靠清单里
 *    `WRITE_EXTERNAL_STORAGE` + `maxSdkVersion=28` 兜底。
 * 2. 下载完成后由 [CompleteReceiver] 接 `ACTION_DOWNLOAD_COMPLETE`，
 *    **先验货再安装**：DownloadManager 状态、已下字节数 == 总字节数、
 *    文件大小、文件头是 `PK\x03\x04`（APK 本质是 zip）——空壳、断流、
 *    把 404 页面存成 .apk 的情况在这一步就被拦下，不会推到安装器面前。
 * 3. 用 **FileProvider** 把文件包装成 `content://` 交给安装器
 *    （直接给 `file://` 在 Android 7+ 会抛 FileUriExposedException）。
 * 4. 检查「允许安装未知应用」授权（`canRequestPackageInstalls`，Android 8+），
 *    没授权就发一条通知引导用户去开，回来由 [resumePending] 补发安装通知。
 *
 * 另外：Android 13+ 没有 POST_NOTIFICATIONS 运行时授权时通知会被系统静默
 * 丢弃，所以 MainActivity 在下载前会先要这个权限，用户不给就退回浏览器下载。
 */
object UpdateInstaller {

    private const val TAG = "HuanaerUpdate"

    /** 只记我们自己发出的下载；别的来源的 DOWNLOAD_COMPLETE 一律无视 */
    private const val PREFS = "jz_update"
    private const val KEY_PENDING = "pending"    // JSON：{ 下载id: 文件名 }
    private const val KEY_NOTIFIED = "notified"  // 已经发过通知的下载 id

    const val CHANNEL_ID = "jz_update"

    // 通知 id 与 PendingIntent request code：三条通知各占一个，互不覆盖
    private const val NOTIFY_INSTALL = 0x4A5A01
    private const val NOTIFY_PERMISSION = 0x4A5A02
    private const val NOTIFY_FAILED = 0x4A5A03

    // ------------------------------------------------------------
    // 入口：开始下载（由 MainActivity 的桥调用）
    // ------------------------------------------------------------

    fun startDownload(activity: Activity, url: String) {
        try {
            val dm = activity.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
            val name = url.substringAfterLast('/')

            // 清掉老版本残留在私有目录里的同名包，免得用户在两个位置看到两份
            activity.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)
                ?.let { File(it, name).delete() }

            val req = DownloadManager.Request(Uri.parse(url))
                .setTitle("花哪儿了 $name")
                .setDescription("正在下载新版本，完成后点通知安装")
                // 只让系统显示「下载中」；完成的通知由本类发——那条才带得了
                // FileProvider 的 content:// 安装意图
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE)
                // 公共 Downloads 目录：文件管理器能看到，安装器也读得到
                .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name)
                .setMimeType("application/vnd.android.package-archive")

            val id = dm.enqueue(req)
            rememberDownload(activity, id, name)
            Toast.makeText(activity, "开始下载，完成后在通知栏点一下安装", Toast.LENGTH_LONG).show()
        } catch (e: Exception) {
            // 下载器不可用（极少数 ROM 会禁）→ 退回浏览器，不能让人卡在「点了没反应」
            Log.w(TAG, "应用内下载失败，改用浏览器", e)
            try {
                activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
            } catch (e2: Exception) {
                Log.w(TAG, "浏览器也打不开: $url", e2)
                Toast.makeText(activity, "打不开下载地址，请检查网络", Toast.LENGTH_LONG).show()
            }
        }
    }

    // ------------------------------------------------------------
    // 下载完成：验货 → 拉起安装
    // ------------------------------------------------------------

    /** 清单注册的接收器。系统广播，导出关闭；只认 SharedPreferences 里的下载 id。 */
    class CompleteReceiver : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action != DownloadManager.ACTION_DOWNLOAD_COMPLETE) return
            val id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L)
            if (id < 0) return
            processPending(context, id)
        }
    }

    /**
     * 处理一个下载 id。广播和 [resumePending] 都走这里，
     * 幂等（notified 去重 + 版本比较），重复调用不会刷通知。
     */
    fun processPending(context: Context, id: Long) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val name = pendingMap(prefs)[id.toString()] ?: return          // 不是我们下的
        if (notifiedSet(prefs).contains(id.toString())) return          // 已经处理过

        // 已经装过这个（或更高）版本：别再拿旧通知烦人
        if (!isNewer(name, currentVersion(context))) {
            forget(context, id)
            return
        }

        // ---- 验货：状态、字节数、文件本身 ----
        val dm = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
        var downloaded = false
        try {
            dm.query(DownloadManager.Query().setFilterById(id)).use { c ->
                if (c.moveToFirst()) {
                    val status = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
                    val total = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES))
                    val sofar = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR))
                    downloaded = status == DownloadManager.STATUS_SUCCESSFUL && total > 0 && sofar >= total
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "查询下载状态失败", e)
        }

        val file = apkFile(name)
        if (!downloaded || !verifyApk(file)) {
            // 断流 / 空壳 / 错误页存成了 .apk：明说，别把用户引到安装器面前
            Log.w(TAG, "安装包校验失败: ${file.absolutePath} exists=${file.exists()} size=${file.length()}")
            forget(context, id)
            postNotification(
                context, NOTIFY_FAILED,
                "更新没下完整",
                "安装包校验失败，重新打开 App 再试一次",
                openAppIntent(context, NOTIFY_FAILED)
            )
            return
        }

        // ---- 安装权限（Android 8+ 的「允许安装未知应用」）----
        if (!canInstall(context)) {
            // 故意不标记 notified：用户去授权回来，由 resumePending 补发安装通知
            postNotification(
                context, NOTIFY_PERMISSION,
                "需要允许安装未知应用",
                "点这里给「花哪儿了」开权限，回来后会弹出安装",
                unknownSourcesIntent(context, NOTIFY_PERMISSION)
            )
            return
        }

        postInstallNotification(context, file, name)
        markNotified(context, id)
    }

    /**
     * Activity onResume 时调用：把「验完货但卡在授权」的下载补发成安装通知。
     * 用户从系统设置授权回来时走到这里。
     */
    fun resumePending(activity: Activity) {
        val prefs = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        pendingMap(prefs).keys.forEach { k ->
            k.toLongOrNull()?.let { processPending(activity, it) }
        }
    }

    // ------------------------------------------------------------
    // 通知
    // ------------------------------------------------------------

    private fun postInstallNotification(context: Context, file: File, name: String) {
        val uri = try {
            FileProvider.getUriForFile(context, context.packageName + ".fileprovider", file)
        } catch (e: IllegalArgumentException) {
            Log.w(TAG, "FileProvider 不认这个路径: ${file.absolutePath}", e)
            return
        }
        val install = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        val pi = PendingIntent.getActivity(
            context, NOTIFY_INSTALL, install,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        postNotification(
            context, NOTIFY_INSTALL,
            "花哪儿了新版已下载",
            "点一下安装 $name",
            pi
        )
    }

    private fun postNotification(
        context: Context,
        id: Int,
        title: String,
        text: String,
        content: PendingIntent
    ) {
        ensureChannel(context)
        val n = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setAutoCancel(true)
            .setContentIntent(content)
            .build()
        try {
            NotificationManagerCompat.from(context).notify(id, n)
        } catch (e: SecurityException) {
            // Android 13+ 用户收回 POST_NOTIFICATIONS：通知发不出去，文件还在
            // Downloads 里能手动点开装，所以只记日志不炸
            Log.w(TAG, "通知发不出去（没有通知权限？）", e)
        }
    }

    private fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = context.getSystemService(NotificationManager::class.java) ?: return
        if (nm.getNotificationChannel(CHANNEL_ID) != null) return
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "应用更新", NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "新版本下载完成与安装提醒"
                setShowBadge(false)
            }
        )
    }

    // ------------------------------------------------------------
    // 工具
    // ------------------------------------------------------------

    /** Android 8+ 的「允许安装未知应用」授权；老系统恒为 true */
    fun canInstall(context: Context): Boolean =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.packageManager.canRequestPackageInstalls()
        } else true

    private fun unknownSourcesIntent(context: Context, requestCode: Int): PendingIntent {
        val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + context.packageName))
        } else {
            Intent(Settings.ACTION_SECURITY_SETTINGS)
        }
        return PendingIntent.getActivity(
            context, requestCode, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    private fun openAppIntent(context: Context, requestCode: Int): PendingIntent {
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        return PendingIntent.getActivity(
            context, requestCode, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    /** 公共 Downloads 目录下的安装包路径（与 setDestinationInExternalPublicDir 一致） */
    fun apkFile(name: String): File =
        File(File(Environment.getExternalStorageDirectory(), Environment.DIRECTORY_DOWNLOADS), name)

    /**
     * 安装包完整性：大小合理 + 文件头是 zip 魔数 `PK\x03\x04`。
     * 断流、空壳、把 404 页面存成 .apk 的情况全部拦得下。
     */
    fun verifyApk(f: File?): Boolean {
        if (f == null || !f.isFile || f.length() < 64 * 1024) return false
        return try {
            f.inputStream().use { ins ->
                val head = ByteArray(4)
                ins.read(head) == 4 &&
                    head[0] == 0x50.toByte() && head[1] == 0x4B.toByte() &&
                    head[2] == 0x03.toByte() && head[3] == 0x04.toByte()
            }
        } catch (e: Exception) {
            false
        }
    }

    private fun currentVersion(context: Context): String = try {
        context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: ""
    } catch (e: Exception) {
        ""
    }

    /** "whereipaid-v1.19.0.apk" → "1.19.0" 比 "1.18.15" 新？ */
    private fun isNewer(fileName: String, current: String): Boolean {
        val m = Regex("v(\\d+(?:\\.\\d+)*)").find(fileName) ?: return true
        fun parse(s: String) = s.split('.').map { it.trim().toIntOrNull() ?: 0 }
        val a = parse(m.groupValues[1])
        val b = parse(current)
        for (i in 0 until maxOf(a.size, b.size)) {
            val d = (a.getOrElse(i) { 0 }) - (b.getOrElse(i) { 0 })
            if (d != 0) return d > 0
        }
        return false
    }

    // ---- SharedPreferences：pending 映射 + notified 去重 ----

    private fun prefs(context: Context): SharedPreferences =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun pendingMap(prefs: SharedPreferences): Map<String, String> {
        val out = linkedMapOf<String, String>()
        try {
            val obj = JSONObject(prefs.getString(KEY_PENDING, "{}") ?: "{}")
            obj.keys().forEach { k -> obj.optString(k).takeIf { it.isNotEmpty() }?.let { out[k] = it } }
        } catch (e: Exception) {
            Log.w(TAG, "pending 记录损坏，重置", e)
        }
        return out
    }

    private fun rememberDownload(context: Context, id: Long, name: String) {
        val p = prefs(context)
        val obj = JSONObject(p.getString(KEY_PENDING, "{}") ?: "{}")
        obj.put(id.toString(), name)
        p.edit().putString(KEY_PENDING, obj.toString()).apply()
    }

    private fun markNotified(context: Context, id: Long) {
        val p = prefs(context)
        val set = (p.getStringSet(KEY_NOTIFIED, emptySet()) ?: emptySet()).toMutableSet()
        set.add(id.toString())
        p.edit().putStringSet(KEY_NOTIFIED, set).apply()
    }

    private fun forget(context: Context, id: Long) {
        val p = prefs(context)
        val obj = JSONObject(p.getString(KEY_PENDING, "{}") ?: "{}")
        obj.remove(id.toString())
        p.edit().putString(KEY_PENDING, obj.toString()).apply()
    }

    private fun notifiedSet(prefs: SharedPreferences): Set<String> =
        prefs.getStringSet(KEY_NOTIFIED, emptySet()) ?: emptySet()
}
