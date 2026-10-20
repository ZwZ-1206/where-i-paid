import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// 签名口令从 keystore.properties 读（该文件已 gitignore），避免进代码库
val ksProps = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

android {
    namespace = "com.whereipaid.app"
    compileSdk = 36

    defaultConfig {
        // 包名 = 应用的身份，装了之后永远不能改（改了等于换一个 App，数据全丢）
        // 只能用小写字母、数字、下划线，段与段用点分隔 —— 连字符 "-" 是非法的
        applicationId = "com.whereipaid.app"
        minSdk = 24
        // 目标 SDK 固定 34：35+ 会强制 edge-to-edge，页面会被状态栏盖住，
        // 对一个「网页壳」来说收益为零、风险很大。侧载分发不看 Play 的 targetSdk 要求。
        targetSdk = 34
        versionCode = 11814
        versionName = "1.18.14"
    }

    signingConfigs {
        create("release") {
            // 注意：keystore.properties 里的路径是相对 android/ 根目录的，
            // 必须用 rootProject.file()，用 file() 会解析成 android/app/keystore/... 然后报 not found
            storeFile = rootProject.file(ksProps.getProperty("storeFile") ?: "keystore/whereipaid-release.jks")
            storePassword = ksProps.getProperty("storePassword") ?: System.getenv("KS_PASS")
            keyAlias = ksProps.getProperty("keyAlias") ?: "whereipaid"
            keyPassword = ksProps.getProperty("keyPassword") ?: System.getenv("KEY_PASS")
        }
    }

    buildFeatures {
        buildConfig = true   // AGP 8 默认关闭，MainActivity 里用了 BuildConfig.DEBUG
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            isShrinkResources = false
            signingConfig = signingConfigs.getByName("release")
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
        debug {
            applicationIdSuffix = ".debug"   // 调试包与正式包可共存
            versionNameSuffix = "-debug"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    lint {
        checkReleaseBuilds = false
        abortOnError = false
    }

    packaging {
        resources.excludes += setOf("META-INF/*.kotlin_module", "DebugProbesKt.bin", "kotlin-tooling-metadata.json")
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.webkit:webkit:1.12.1")
}
