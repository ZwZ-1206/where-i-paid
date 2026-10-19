# 花哪儿了 · APK 打包任务清单 v1

> **进度（2026-10-19 19:15）**：A-01 ~ A-08 已完成，产出 `dist-apk\whereipaid-v1.18.2.apk`（3.06 MB，v2 签名通过）。
> 剩余：A-09 / A-10 / A-12（真机验收，需要一台安卓手机）、A-11（官网换按钮）、A-14（发版手册已由《花哪儿了-双端打包操作手册.md》承担）。
> 执行细节与实际踩到的坑见 **`花哪儿了-双端打包操作手册.md`**。
>
> 前提：**已决定要 APK**，本文不再讨论"要不要"。只解决"怎么做、代价在哪、怎么验收"。
> 产品版本基线：v1.18.2（`sw.js` 的 `CACHE`）。
> 本机现状（2026-10-19 实测）：**无 JDK、无 Android SDK、无 Android Studio、无 adb**。从零开始。

---

## 0. 先接受三个事实

这三条不影响"能做"，但会影响"做成什么样"，必须先知道：

1. **APK 只解决安卓。** iOS 装不了 APK，也装不了 ipa（除了 $99/年 + 审核，或 7 天一续的免费签名）。所以最终形态是**不对称的**：安卓有安装包，iPhone 还是「添加到主屏幕」。这是常态，不是缺陷。
2. **鸿蒙 NEXT（HarmonyOS 5.x 起，Mate 70 及之后的纯血鸿蒙）不能装 APK。** 它只跑 `.hap`。鸿蒙 4.x 及更早（兼容安卓）可以。官网文案必须写「安卓 8.0+ / 鸿蒙 4.x 及以下」，不能笼统写"安卓都能装"。
3. **签名文件丢一次，后面所有升级都装不上。** 用户只能卸载重装，账目全丢。这是个人开发者最常见的翻车点，见 §6。

---

## 1. 三条路线怎么选

| 路线 | 怎么做 | 离线可用 | 无 Chrome 机型 | 更新方式 | 工期 | 能不能马上做 |
|---|---|---|---|---|---|---|
| **A · 内嵌 WebView 壳（推荐）** | 把 `dist/` 打进 APK，用 `WebViewAssetLoader` 以虚拟 https 域名提供 | ✅ 装完即离线 | ✅ 不依赖浏览器 | 重新打包覆盖安装（阶段二可做远端包热更） | 1–2 天 | ✅ 不需要线上地址 |
| B · TWA（Bubblewrap 套壳） | 用 `@bubblewrap/cli` 从线上 PWA 生成 | ⚠️ 依赖 Chrome 的 SW 缓存 | ❌ **必须有支持 TWA 的浏览器**，国产 ROM 常没有 | 改网页即更新，壳不用重发 | 0.5 天 | ❌ **必须先部署站点** |
| C · Capacitor | 和 A 类似，但带完整 npm 构建链 | ✅ | ✅ | 同 A | 2–3 天 | ✅ |

**选 A。** 理由：

- **B 的"改网页就更新"很诱人，但它在国内是瘸的**：TWA 本质是让系统浏览器以无地址栏模式打开你的站，设备上没有支持 TWA 的浏览器时，会退化成带地址栏的 Custom Tab（看起来就是个网页）甚至直接白屏。国产 ROM 预装的是厂商浏览器，Chrome 常常没有。
- **A 没有这个风险**：自己的 WebView 加载自己打的包，任何安卓机都一样。
- **A 的"不能热更"其实可以补**：阶段二加一个"检查远端包 → 下载 zip → 解压到应用私有目录 → 切换加载路径"，就同时拥有 B 的热更和 A 的稳定性。这是 §8 的内容，第一阶段先不做。

> **如果你只想最快看到一个 APK**：走 B，`npx @bubblewrap/cli init --manifest https://你的域名/manifest.webmanifest`，但它要求站点已上线。当前部署推迟在 M1 之后，所以 B 现在做不了——这也是选 A 的现实原因。

---

## 2. 环境准备（Windows，从零）

需要三样东西：**JDK 17**、**Android SDK（cmdline-tools）**、**Gradle**（用 wrapper 就行，不用单独装）。

### 2.1 JDK 17

```powershell
winget install --id EclipseAdoptium.Temurin.17.JDK -e
```

装完新开一个终端验证：

```powershell
java -version    # 应显示 17.x
echo $env:JAVA_HOME
```

没有 `winget` 就去 https://adoptium.net/temurin/releases/?version=17 下 zip 版，解压到 `C:\Apps\jdk17`，然后设环境变量：

```powershell
[Environment]::SetEnvironmentVariable('JAVA_HOME','C:\Apps\jdk17','User')
[Environment]::SetEnvironmentVariable('Path', $env:Path + ';C:\Apps\jdk17\bin','User')
```

> **必须是 17**。AGP 8.x 不支持 JDK 8，JDK 21 也能用但 AGP 版本要对齐；17 是最稳的。

### 2.2 Android SDK（命令行版，不装 Studio）

1. 下载 command-line tools：https://developer.android.com/studio#command-tools
   取 `commandlinetools-win-*.zip`。
2. 解压到 `%LOCALAPPDATA%\Android\Sdk\cmdline-tools\latest`（**目录名必须是 `latest`**，否则 sdkmanager 报错）。
3. 设环境变量：

```powershell
[Environment]::SetEnvironmentVariable('ANDROID_HOME', "$env:LOCALAPPDATA\Android\Sdk", 'User')
[Environment]::SetEnvironmentVariable('Path', $env:Path + ";$env:LOCALAPPDATA\Android\Sdk\platform-tools;$env:LOCALAPPDATA\Android\Sdk\cmdline-tools\latest\bin", 'User')
```

4. 装平台与构建工具：

```powershell
sdkmanager --licenses
sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0"
```

> 下载量约 1–1.5 GB。国内网络慢就配镜像（腾讯/阿里云镜像站有 Android SDK 镜像），或先只装 `platform-tools` 验证通路。

### 2.3 验证

```powershell
adb version
sdkmanager --version
java -version
```

三条都出结果，环境就算好了。

---

## 3. 工程结构

**不要污染现有仓库根目录**。新建独立目录，和 App 源码并列：

```
C:\Code\Jizhang\
├── assets/  index.html  sw.js  ...        ← 现有 PWA，一行不改
├── build-dist.js                          ← 现有打包脚本，一行不改
└── android\                               ← 新建，整个 APK 工程
    ├── settings.gradle.kts
    ├── build.gradle.kts
    ├── gradle.properties
    ├── app\
    │   ├── build.gradle.kts
    │   ├── proguard-rules.pro
    │   └── src\main\
    │       ├── AndroidManifest.xml
    │       ├── java\com\whereipaid\app\MainActivity.kt
    │       ├── assets\www\                ← build 时把 dist/ 整个拷进来（gitignore）
    │       └── res\
    │           ├── mipmap-*\ic_launcher.png
    │           ├── mipmap-anydpi-v26\ic_launcher.xml
    │           └── values\styles.xml
    └── keystore\                          ← **绝不入 git**
        └── whereipaid-release.jks
```

`.gitignore` 追加：

```
android/app/src/main/assets/www/
android/keystore/
android/.gradle/
android/app/build/
```

> `assets/www/` 是构建产物，由脚本从 `dist/` 拷入，不要提交。

---

## 4. 壳的实现（核心只有一个文件）

### 4.1 `MainActivity.kt`

```kotlin
package com.whereipaid.app

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.webkit.*
import androidx.appcompat.app.AppCompatActivity
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat

class MainActivity : AppCompatActivity() {

    private lateinit var web: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        web = WebView(this).apply {
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true          // localStorage，必须开
                allowFileAccess = false           // 不碰 file://，避免 origin 混乱
                allowContentAccess = false
                cacheMode = WebSettings.LOAD_DEFAULT
            }
            webViewClient = object : WebViewClientCompat() {
                override fun shouldInterceptRequest(
                    view: WebView, request: WebResourceRequest
                ): WebResourceResponse? = loader.shouldInterceptRequest(request.url)

                // 站外链接交给系统浏览器，不在壳里打转
                override fun shouldOverrideUrlLoading(
                    view: WebView, request: WebResourceRequest
                ): Boolean {
                    val u = request.url
                    if (u.host == "appassets.androidplatform.net") return false
                    startActivity(Intent(Intent.ACTION_VIEW, u))
                    return true
                }
            }
        }
        setContentView(web)
        // 关键：虚拟 https 源，Service Worker / localStorage / manifest 才按正常 origin 工作
        web.loadUrl("https://appassets.androidplatform.net/assets/index.html")
    }

    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack() else super.onBackPressed()
    }
}
```

### 4.2 三个关键点（做错会出玄学 bug）

1. **必须用 `WebViewAssetLoader` 的 `https://appassets.androidplatform.net`**，不要用 `file:///android_asset/`。
   - `file://` 下 Service Worker 注册不了、`localStorage` 落在奇怪的 origin、`manifest` 不生效。
   - 虚拟 https 源下，App 在浏览器里的那套逻辑**原样跑**，包括 SW 缓存。
2. **`domStorageEnabled = true`** —— 不开的话 `localStorage` 直接是 `null`，App 一进去就崩。
3. **所有数据会存在 `appassets.androidplatform.net` 这个 origin 下。** 一旦定了就**不能再改**（改了等于换数据目录，老用户账本"消失"）。要改就在第一个正式版之前改。

### 4.3 `AndroidManifest.xml` 要点

```xml
<uses-permission android:name="android.permission.INTERNET" />
<application
    android:allowBackup="true"
    android:icon="@mipmap/ic_launcher"
    android:roundIcon="@mipmap/ic_launcher_round"
    android:label="花哪儿了"
    android:theme="@style/Theme.WhereIPaid"
    android:usesCleartextTraffic="false">
    <activity android:name=".MainActivity"
        android:exported="true"
        android:configChanges="orientation|screenSize|keyboardHidden"
        android:windowSoftInputMode="adjustResize">
        <intent-filter>
            <action android:name="android.intent.action.MAIN" />
            <category android:name="android.intent.category.LAUNCHER" />
        </intent-filter>
    </activity>
</application>
```

- `INTERNET` 现在用不上（资源全在包里），但阶段二热更和将来双人同步要，先加上。
- `adjustResize` 必须：记账键盘弹起时页面要缩，否则输入框被挡。
- `allowBackup="true"` 让系统备份带上 WebView 数据（换机可恢复）。

---

## 5. 图标与启动屏

| 项 | 做法 |
|---|---|
| 图标 | 拿现有 `assets/icons/icon-512.png` 生成 48/72/96/144/192 五档，放 `mipmap-*` |
| 自适应图标 | 前景用 icon 主体、背景用品牌渐变 `#5B8CFF → #7C5CFF`，`mipmap-anydpi-v26/ic_launcher.xml` |
| 圆角图标 | 同名 `ic_launcher_round` |
| 主题色 | `styles.xml` 的 `colorPrimary` = `#4F7CFF`，启动主题背景 `#F4F6FB`，避免白闪 |
| 启动屏 | Android 12+ 走系统的 SplashScreen API，图标居中，**不要做假进度条** |

> 生成图标可以用 Android Studio 的 Image Asset，也可以用 ImageMagick 批量缩。**不要**直接拿 512 的图丢进 drawable（会 OOM）。

---

## 6. 签名与 keystore（本文档最重要的一节）

### 6.1 生成一次，终身保管

```powershell
keytool -genkeypair -v `
  -keystore android\keystore\whereipaid-release.jks `
  -alias whereipaid `
  -keyalg RSA -keysize 2048 -validity 10000 `
  -storepass <你的口令> -keypass <你的口令> `
  -dname "CN=Hua Na Er, OU=Dev, O=Personal, L=Beijing, ST=Beijing, C=CN"
```

- `validity 10000` 天 ≈ 27 年，够用。Play 要求至少到 2033 年。
- **同一包名 + 同一签名 = 可以覆盖安装、数据保留。** 换了签名，系统直接拒绝安装（`INSTALL_FAILED_UPDATE_INCOMPATIBLE`）。

### 6.2 必须做的三件备份

1. `.jks` 文件本身；
2. 口令（写在密码管理器里，不要只存脑子里）；
3. **签名指纹**（下面这条命令的输出，抄进 README 和密码库）：

```powershell
keytool -list -v -keystore android\keystore\whereipaid-release.jks -alias whereipaid
# 抄下 SHA-256 指纹，将来做 TWA / 上架 / 换机器都要它
```

> **丢了怎么办**：没有任何官方途径找回。只能换包名重新发布，老用户必须卸载重装（账本丢失）。这就是为什么它比代码重要。

### 6.3 口令不要进代码库

`app/build.gradle.kts` 里的 `storePassword` 从 `keystore.properties`（已 gitignore）或环境变量读：

```kotlin
val ksProps = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
signingConfigs {
    create("release") {
        storeFile = file(ksProps.getProperty("storeFile") ?: "keystore/whereipaid-release.jks")
        storePassword = ksProps.getProperty("storePassword") ?: System.getenv("KS_PASS")
        keyAlias = ksProps.getProperty("keyAlias") ?: "whereipaid"
        keyPassword = ksProps.getProperty("keyPassword") ?: System.getenv("KEY_PASS")
    }
}
```

---

## 7. 版本号与升级规则

| 字段 | 规则 | 例（v1.17.7） |
|---|---|---|
| `versionName` | 与 `sw.js` 的 `CACHE` 保持一致，去掉 `jizhang-v` 前缀 | `1.17.7` |
| `versionCode` | `major*10000 + minor*100 + patch` | `11707` |
| 递增要求 | 每次发版 **必须** 比上一版大，否则覆盖安装失败 | — |

- 每次发版：先跑 `node build-dist.js`（会升 `sw.js` 的 CACHE 和所有 `?v=`），再把 `dist/` 拷进 `assets/www/`，再改 `versionCode/versionName`。
- **三处版本号必须一致**：`sw.js` 的 `CACHE`、`build.gradle.kts` 的 `versionName`、官网下载卡上写的版本号。
- 建议写一个 `android/sync-www.ps1`：读 `sw.js` 的版本 → 清空 `assets/www/` → 拷 `dist/` → 替换 `build.gradle.kts` 里的版本 → 输出"可以 build 了"。

---

## 8. 更新策略

### 阶段一（先做这个，够用）

**覆盖安装。** 用户从官网下载新 APK，点安装，系统问"是否更新"，确认即可，**数据不丢**（同签名）。

封面要写清楚这一点，否则用户以为要卸载重装。

### 阶段二（可选，想"像 App 一样自动更新"再做）

壳里加一个更新检查：启动时 `GET https://官网/download/latest.json` → 比对 `versionCode` → 有新版就提示 → 下载 zip → 校验 sha256 → 解压到 `filesDir/www-v{n}` → 下次启动从新目录加载。

- 好处：不用重新走系统安装器，体验接近热更。
- 代价：约 1–2 天，要处理"下载中断/校验失败/回滚"。
- **不要**用 Tinker/Bugly 那类 dex 热更——那是另一套东西，且风险高。

> 阶段二不做也不影响"能用"。**先有阶段一，再谈阶段二。**

---

## 9. 官网要跟着改

APK 一旦可用，官网的 Android 卡从「下载离线包 zip」换成「下载 APK」：

| 项 | 改前（v1.2） | 改后 |
|---|---|---|
| Android 卡按钮 | 下载离线包（zip） | **下载 APK（v1.17.7，8.4 MB）** |
| 三步说明 | 下载 → 解压 → Chrome 打开 | 下载 → 允许"未知来源" → 安装 |
| 小字 | "不是安装包，没有离线缓存" | "安卓 8.0+ / 鸿蒙 4.x 及以下；鸿蒙 NEXT 暂不支持" |
| zip 位置 | Android 主入口 | 降级为"电脑上用"的次入口 |
| iOS 卡 | 添加到主屏幕 | **不变** |

- 文件名：`whereipaid-v1.17.7.apk`，带版本号，方便用户区分。
- 下载页要有一句：「首次安装会提示『未知来源』，这是安卓对非商店应用的统一提示，允许一次即可。」
- **不要**写「官方版」「正版」这类容易踩广告法的词。

---

## 10. 验收清单

### 必过（缺一条就不算完成）

- [ ] **飞行模式**下首次启动能打开、能记一笔（证明资源真打进包里了）
- [ ] 记一笔 → 强行停止 App → 重开，账还在（证明 localStorage 落在虚拟源下且持久）
- [ ] 覆盖安装新版 APK（`versionCode` +1）→ 账还在
- [ ] 记账键盘弹起时，输入框没被挡住（`adjustResize` 生效）
- [ ] 返回键：子页面返回上一页，首页再按退出（不是直接白屏退出）
- [ ] 图标是自适应图标，不是白底方块；启动无白闪
- [ ] 系统深色模式切换，App 跟着变（App 自己支持，确认在 WebView 里也生效）
- [ ] 站外链接（如反馈邮箱）用系统浏览器打开，不在壳里打转
- [ ] 在**至少一台国产 ROM**（小米/华为/OPPO/vivo 任一）上装成功，观察是否被"纯净模式"拦
- [ ] 鸿蒙 4.x 机型能装；鸿蒙 NEXT 明确不支持（文案已写）

### 建议

- [ ] APK 大小 ≤ 12 MB（现在 dist 是 ~1.2 MB，加上 WebView 壳和图标应在 3–6 MB）
- [ ] `aapt dump badging` 确认 `versionName/versionCode/package` 正确
- [ ] 用 `apksigner verify` 确认签名有效

---

## 11. 风险

| 风险 | 可能性 | 对策 |
|---|---|---|
| **keystore 丢失** | 中 | 三处备份 + 指纹抄进 README（§6.2） |
| 国产 ROM「纯净模式」拦安装 | **高** | 官网写清"允许未知来源"；准备一张安卓设置路径图（各家不同） |
| 鸿蒙 NEXT 装不了 | 高（新机） | 文案写清支持范围；鸿蒙用户引导回 PWA |
| WebView 版本过旧导致白屏 | 低 | 要求 `minSdk 24`（Android 7.0）；`WebView` 由系统组件更新，一般没问题 |
| 虚拟源域名写错/后期改动 | 低但致命 | `appassets.androidplatform.net` 写死成常量，第一个正式版后不再动 |
| 覆盖安装时签名不一致 | 中 | CI/脚本固定用同一个 jks；换机器前先备份 |
| 上架应用商店 | — | 需软著 + APP 备案（备案要求境内服务器），本阶段不做 |

---

## 12. 任务清单

| ID | 任务 | 依赖 | 产出 | 验收 |
|---|---|---|---|---|
| **A-01** | 装 JDK 17 + Android SDK cmdline-tools + 许可证 | — | 可用的 `java`/`sdkmanager`/`adb` | 三条命令都出版本号 |
| **A-02** | 建 `android/` 工程骨架（Gradle 8.x + AGP 8.x + Kotlin） | A-01 | 能 `assembleDebug` 的空壳 | 空壳装到真机能启动 |
| **A-03** | 写 `MainActivity.kt` + `WebViewAssetLoader`（§4） | A-02 | 能加载 `assets/www/index.html` | 页面出来，`localStorage` 不为 null |
| **A-04** | `sync-www.ps1`：`build-dist.js` → 拷 `dist/` → 改版本号 | A-02 | 一键同步脚本 | 跑一次后 `versionName` 与 `sw.js` 一致 |
| **A-05** | 图标五档 + 自适应图标 + 圆角图标 | A-02 | `mipmap-*` | 桌面图标不是白底方块 |
| **A-06** | 主题与启动屏（`styles.xml` + SplashScreen） | A-02 | 无白闪 | 冷启动看到品牌色，不是白屏 |
| **A-07** | 生成 keystore + 三处备份 + 指纹入 README | A-02 | `.jks` + 文档 | `keytool -list` 能出指纹 |
| **A-08** | 配 `signingConfigs`，出 release APK | A-07 | `app-release.apk` | `apksigner verify` 通过 |
| **A-09** | 真机跑 §10 必过清单 | A-08 | 测试记录 | 全绿 |
| **A-10** | 国产 ROM 纯净模式兼容性验证 | A-09 | 记录（机型 + 拦截提示截图） | 给出"怎么允许"的一句话说明 |
| **A-11** | 官网 Android 卡改 APK（§9） | A-08 | 改后的 S5 | 按钮能下到带版本号的 apk |
| **A-12** | 卸载/重装/覆盖安装三种场景验证 | A-08 | 记录 | 覆盖安装数据不丢；卸载重装数据丢失（预期） |
| **A-13** | （阶段二）远端 bundle 热更 | A-11 | 更新检查 + 下载校验 | 断网回滚正常 |
| **A-14** | 写 `android/README.md`：怎么发一版 | A-08 | 一页操作手册 | 半年后照着能做出来 |

---

## 13. 一页速查

1. **装环境**（A-01）：JDK 17 + SDK cmdline-tools，约 1.5 GB 下载。
2. **建壳**（A-02/03）：一个 `MainActivity` + `WebViewAssetLoader`，虚拟 https 源是命门。
3. **同步资源**（A-04）：`dist/` → `assets/www/`，版本号三处对齐。
4. **签名**（A-07）：生成一次，备份三处，指纹抄下来。
5. **打包**（A-08）：`gradlew assembleRelease`。
6. **真机验**（A-09/10）：飞行模式能开、覆盖安装不丢账、国产 ROM 能装。
7. **换官网按钮**（A-11）：Android 卡从 zip 改成 APK。
8. **写发版手册**（A-14）：否则下次发版要重新读这篇。

> 一句话：**这个 APK 的成本不在写代码（一个文件），在环境、签名和国产 ROM 的兼容性验证上。** 前者是一次性的，后者每次发版都要过一遍。
