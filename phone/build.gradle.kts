// Jo for Android: a small native shell around the Jo web app (the same HUD as the PC version).
// The phone's speech recognizer, text-to-speech, notifications and full screen are offered
// to the page through a message channel that only Jo's own website can use.
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.karthik.jo.phone"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.karthik.jo"
        minSdk = 26
        targetSdk = 35
        versionCode = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()
        versionName = "2.0.${System.getenv("GITHUB_RUN_NUMBER") ?: "0"}"
    }

    // A fixed signing key lets each new build install over the old one (keeping settings).
    // CI provides it from repository secrets; without them the standard debug key is used.
    val keystoreFile = System.getenv("JO_KEYSTORE_FILE")?.let { file(it) }?.takeIf { it.exists() }
    signingConfigs {
        if (keystoreFile != null) {
            create("jo") {
                storeFile = keystoreFile
                storePassword = System.getenv("JO_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("JO_KEY_ALIAS") ?: "jo"
                keyPassword = System.getenv("JO_KEYSTORE_PASSWORD")
            }
        }
    }

    buildTypes {
        debug {
            if (keystoreFile != null) signingConfig = signingConfigs.getByName("jo")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.webkit:webkit:1.12.1")

    testImplementation("org.jetbrains.kotlin:kotlin-test-junit:2.1.0")
}
