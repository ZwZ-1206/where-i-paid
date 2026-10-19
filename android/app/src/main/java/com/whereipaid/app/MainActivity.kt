package com.whereipaid.app

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.util.Log
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat

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

            webViewClient = object : WebViewClientCompat() {
                override fun shouldInterceptRequest(
                    view: WebView,
                    request: WebResourceRequest
                ): WebResourceResponse? = loader.shouldInterceptRequest(request.url)

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
            }
        }

        setContentView(web)

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

    private fun openExternally(url: Uri): Boolean = try {
        startActivity(Intent(Intent.ACTION_VIEW, url))
        true
    } catch (e: Exception) {
        Log.w("Huanaer", "打不开外部链接: $url", e)
        true
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
        web.resumeTimers()
        web.onResume()
    }

    override fun onDestroy() {
        web.destroy()
        super.onDestroy()
    }

    companion object {
        /** 虚拟源域名，写死为常量。第一个正式版之后就不要再动它。 */
        private const val ASSET_HOST = "appassets.androidplatform.net"
        private const val START_URL = "https://$ASSET_HOST/assets/www/index.html"
    }
}
