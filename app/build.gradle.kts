plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "com.karthik.jo"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.karthik.jo"
        minSdk = 26
        targetSdk = 35
        versionCode = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()
        versionName = "1.0.${System.getenv("GITHUB_RUN_NUMBER") ?: "0"}"
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
    buildFeatures { compose = true }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.12.01")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.work:work-runtime-ktx:2.10.0")
    implementation("androidx.security:security-crypto:1.0.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")

    testImplementation("org.jetbrains.kotlin:kotlin-test-junit:2.1.0")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
    testImplementation("org.json:json:20240303") // real org.json; Android's is a stub in unit tests
}
