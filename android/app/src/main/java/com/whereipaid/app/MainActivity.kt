package com.whereipaid.app

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebChromeClient.FileChooserParams
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat
import com.whereipaid.app.widget.BillWidgetProvider
import com.whereipaid.app.widget.WidgetStore

/**
 * 花哪儿了 · 安卓壳
 *
 * 设计要点（改之前先读这段）：
 * 1. 页面资源全部打在 APK 里的 assets/www/ 下，所以装完即可离线使用，不依赖任何线上地址。
 * 2. 必须用 WebViewAssetLoader 把 assets 映射到虚拟 https 域名
 *    https://appassets.androidplatform.net —— 不能用 file://。
 *    file:// 下 Service Worker 注册不了、localStorage 会落到奇怪的 origin、manifest 不生效。
 * 3. 这个域名同时也是 localStorage 的 origin，**一旦上线就不能再改**，
 *    改了等于换了数据目录，老用户的账本会「凭空消失」。
 * 4. domStorageEnabled 必须为 true，否则 localStorage 为 null，页面直接崩。
 */
class MainActivity : AppCompatActivity() {

    private lateinit var web: WebView

    /** 网页第一次加载完成之前，evaluateJavascript 打过去是没人接的 —— 先把要跳的页面存着 */
    private var pendingRoute: String? = null
    private var pageLoaded = false

    /** 正在等用户选文件的回调；选完/取消都要回一次，否则下次点击没反应 */
    private var filePathCallback: ValueCallback<Array<Uri>>? = null

    /** 系统文件选择器（ACTION_GET_CONTENT）。注册必须早于 onStart，所以放字段初始化。 */
    private val fileChooser = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { res ->
        val cb = filePathCallback
        filePathCallback = null
        if (cb == null) return@registerForActivityResult
        if (res.resultCode != Activity.RESULT_OK) {
            cb.onReceiveValue(null)   // 用户取消：也必须回，不然 WebView 会卡住
            return@registerForActivityResult
        }
        val data = res.data
        val uris = mutableListOf<Uri>()
        val clip = data?.clipData
        if (clip != null) {
            for (i in 0 until clip.itemCount) clip.getItemAt(i).uri?.let { uris.add(it) }
        } else {
            data?.data?.let { uris.add(it) }
        }
        cb.onReceiveValue(if (uris.isEmpty()) null else uris.toTypedArray())
    }

    // 注意：注释里别写「斜杠 + 星号」的组合（比如 image 通配那种写法），
    // Kotlin 的块注释可嵌套，写着写着会把后面整段代码注释掉，报一堆莫名的语法错。
    /** acceptTypes 可能是 image 通配，也可能是「.jpg」这种后缀 —— Android 只认 MIME */
    private fun buildPickIntent(params: FileChooserParams?): Intent {
        val raw = params?.acceptTypes?.filter { !it.isNullOrBlank() } ?: emptyList()
        val mimes = raw.filter { it.contains("/") }
        val intent = Intent(Intent.ACTION_GET_CONTENT)
        intent.addCategory(Intent.CATEGORY_OPENABLE)
        intent.type = if (mimes.size == 1) mimes[0] else "*/*"
        if (mimes.size > 1) intent.putExtra(Intent.EXTRA_MIME_TYPES, mimes.toTypedArray())
        if (mimes.isEmpty()) intent.type = "image/*"   // 识别导入只收图片
        return intent
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // assets/www/** -> https://appassets.androidplatform.net/assets/www/**
        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        web = WebView(this).apply {
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true            // localStorage 全靠它
                databaseEnabled = true
                allowFileAccess = false             // 不碰 file://，避免 origin 混乱
                allowContentAccess = false
                cacheMode = WebSettings.LOAD_DEFAULT
                // 让页面按设备宽度排版，而不是按 980px 虚拟宽度
                useWideViewPort = true
                loadWithOverviewMode = true
                // 支持双指缩放关闭（页面已做移动端适配），但保留文字自动调整
                setSupportZoom(false)
                builtInZoomControls = false
            }

            // Release 包关闭远程调试，Debug 包打开（配合 chrome://inspect 查白屏）
            WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)

            // 给页面的原生桥：更新时在 App 内直接下载 APK，不再把用户踢到浏览器。
            // 页面侧用法见 app.js 的 openApkDownload()：有 JZApp 就用它，没有就退回 location.href，
            // 所以老版本 App 和网页版都不受影响。
            addJavascriptInterface(UpdateBridge(), "JZApp")
            // 桌面小组件的数据桥：网页把聚合好的快照交给原生，见 widget/WidgetStore.kt
            addJavascriptInterface(WidgetBridge(), "JZWidget")

            webViewClient = object : WebViewClientCompat() {
                override fun shouldInterceptRequest(
                    view: WebView,
                    request: WebResourceRequest
                ): WebResourceResponse? = loader.shouldInterceptRequest(request.url)

                override fun onPageFinished(view: WebView, url: String) {
                    pageLoaded = true
                    val route = pendingRoute
                    if (!route.isNullOrBlank()) {
                        pendingRoute = null
                        // 晚一点点：App.js 的 boot() 在 DOMContentLoaded 才跑，
                        // 过早 evaluate 会是「对象已经存在、页面还没渲染」的空操作
                        view.postDelayed({ applyRoute(route) }, 400)
                    }
                }

                // 站外链接（反馈邮箱、官网）交给系统浏览器，不在壳里打转
                override fun shouldOverrideUrlLoading(
                    view: WebView,
                    request: WebResourceRequest
                ): Boolean {
                    val url: Uri = request.url
                    if (url.host == ASSET_HOST) return false
                    return openExternally(url)
                }
            }

            webChromeClient = object : WebChromeClient() {
                override fun onConsoleMessage(msg: ConsoleMessage): Boolean {
                    if (BuildConfig.DEBUG) {
                        Log.d("HuanaerWeb", "${msg.message()} @${msg.lineNumber()} ${msg.sourceId()}")
                    }
                    return true
                }

                /**
                 * 网页里的 <input type="file"> 必须由壳来弹选择器。
                 * 不实现这个回调，WebView 收到点击后什么都不做 —— 表现就是
                 * 「识图导入 → 从相册选择」点了没反应（网页版是好的）。
                 */
                override fun onShowFileChooser(
                    view: WebView,
                    callback: ValueCallback<Array<Uri>>,
                    params: FileChooserParams
                ): Boolean {
                    // 上一次没走完的先释放，否则 WebView 会一直挂着等结果
                    filePathCallback?.onReceiveValue(null)
                    filePathCallback = callback
                    return try {
                        fileChooser.launch(Intent.createChooser(buildPickIntent(params), "选择图片"))
                        true
                    } catch (e: Exception) {
                        Log.w("Huanaer", "打不开文件选择器", e)
                        filePathCallback = null
                        false
                    }
                }
            }
        }

        setContentView(web)

        // 小组件带着「记一笔」进来时：热启动（singleTask）走这条，冷启动走上面 onPageFinished
        pendingRoute = intent?.getStringExtra(EXTRA_ROUTE)?.takeIf { it.isNotBlank() }

        if (savedInstanceState == null) {
            web.loadUrl(START_URL)
        } else {
            web.restoreState(savedInstanceState)
        }

        // 返回键：能回退就回退，回到首页再按才退出
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (web.canGoBack()) web.goBack() else finish()
            }
        })
    }

    /**
     * 小组件点了卡片上的按钮：把 App 拉到前台并直接落到那一页。
     * 注意 App 已经是 singleTask，系统会复用这个实例，所以这里一定能收到；
     * 页面还没起来的那份会留在 pendingRoute 里，由 onPageFinished 补。
     */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        val route = intent.getStringExtra(EXTRA_ROUTE)
        if (route.isNullOrBlank()) return
        if (pageLoaded) applyRoute(route) else pendingRoute = route
    }

    /** 把页面切到 route（add / report …）。只调 JS，不整页 reload —— reload 会先白一屏 */
    private fun applyRoute(route: String) {
        val safe = route.replace(Regex("[^A-Za-z0-9_-]"), "")
        if (safe.isEmpty()) return
        val js = "(function(){try{" +
            "if(window.Widget&&window.Widget.handleRoute){window.Widget.handleRoute('$safe');return;}" +
            "if(window.App&&window.App.go){window.App.go('$safe');}" +
            "}catch(e){}})()"
        web.evaluateJavascript(js, null)
    }

    // ------------------------------------------------------------
    // 桌面小组件：网页 → 原生的数据桥
    // ------------------------------------------------------------
    /**
     * 网页侧用法见 assets/js/widget.js。
     * 这里只做「落盘 + 通知桌面重画」两件事，**不做任何金额计算**：
     * 账目的口径（周期怎么切、退款怎么抵、红包算谁的）全在网页侧，
     * 原生再算一遍必然和 App 里看到的数对不上，那是最难查的一类 bug。
     */
    inner class WidgetBridge {
        /** @return 是否存下来了（false = 格式不对，网页侧会降级为「不推」） */
        @JavascriptInterface
        fun postSnapshot(json: String?): Boolean {
            val app = applicationContext
            val ok = WidgetStore.save(app, json)
            if (ok) runOnUiThread { BillWidgetProvider.updateAll(app) }
            return ok
        }

        /** 网页想知道「本机有没有已经存过的快照」（没数据就不必推） */
        @JavascriptInterface
        fun hasSnapshot(): Boolean = WidgetStore.hasSnapshot(applicationContext)
    }

    private fun openExternally(url: Uri): Boolean = try {
        startActivity(Intent(Intent.ACTION_VIEW, url))
        true
    } catch (e: Exception) {
        Log.w("Huanaer", "打不开外部链接: $url", e)
        true
    }

    // ------------------------------------------------------------
    // App 内更新：系统下载器 + 通知栏安装
    // ------------------------------------------------------------
    /**
     * 页面调用的桥。只暴露一个动作，而且**只允许下我们自己的域名**：
     * 这个接口要是能被任意页面调用，就成了「用你的流量下任意文件」的洞。
     */
    inner class UpdateBridge {
        @JavascriptInterface
        fun downloadApk(url: String) {
            if (!url.startsWith(APK_ALLOWED_PREFIX) || !url.endsWith(".apk")) {
                Log.w("Huanaer", "拒绝下载非官方安装包: $url")
                return
            }
            runOnUiThread { downloadWithNotifyPermission(url) }
        }

        /** 页面想知道自己装在哪个版本里时可以问（目前用包内 sw.js，不用这个） */
        @JavascriptInterface
        fun versionName(): String = BuildConfig.VERSION_NAME
    }

    /**
     * Android 13+ 没有 POST_NOTIFICATIONS 授权时，通知会被系统静默丢弃，
     * 用户就永远等不到「点通知安装」。所以下载前先要权限：给，就走 App 内
     * 下载；不给，退回系统浏览器（浏览器有自己的通知链路）。
     */
    private val notifyPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        val url = pendingDownloadUrl
        pendingDownloadUrl = null
        if (url == null) return@registerForActivityResult
        if (granted) UpdateInstaller.startDownload(this, url)
        else openExternally(Uri.parse(url))
    }

    private var pendingDownloadUrl: String? = null

    private fun downloadWithNotifyPermission(url: String) {
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            pendingDownloadUrl = url
            notifyPermission.launch(android.Manifest.permission.POST_NOTIFICATIONS)
            return
        }
        UpdateInstaller.startDownload(this, url)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    override fun onPause() {
        web.onPause()
        web.pauseTimers()
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        // 用户刚从系统设置里开「允许安装未知应用」回来：把验完货的下载补发成安装通知
        UpdateInstaller.resumePending(this)
        web.resumeTimers()
        web.onResume()
    }

    override fun onDestroy() {
        web.destroy()
        super.onDestroy()
    }

    companion object {
        /** 小组件 / 通知带来的落地页键；值取自 App.VIEWS 的键（add / report …） */
        const val EXTRA_ROUTE = "route"
        /** 虚拟源域名，写死为常量。第一个正式版之后就不要再动它。 */
        private const val ASSET_HOST = "appassets.androidplatform.net"
        private const val START_URL = "https://$ASSET_HOST/assets/www/index.html"
        /** 只允许从这个前缀下载安装包（官网），别的一律拒绝 */
        private const val APK_ALLOWED_PREFIX = "https://where-i-paid.pages.dev/download/"
    }
}
