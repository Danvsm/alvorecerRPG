plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val hasGoogleServices = file("google-services.json").exists()
if (hasGoogleServices) apply(plugin = "com.google.gms.google-services")

android {
    namespace = "com.alvorecer.rpg"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.alvorecer.rpg"
        minSdk = 26
        targetSdk = 35
        versionCode = 11
        versionName = "0.2.0"
        buildConfigField("String", "APP_URL", "\"https://alvorecer-rpg-vsm.vercel.app\"")
        buildConfigField("boolean", "FCM_CONFIGURED", hasGoogleServices.toString())
    }

    buildFeatures { buildConfig = true }
    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.activity:activity-ktx:1.10.0")
    implementation("androidx.work:work-runtime-ktx:2.10.0")
    implementation("androidx.security:security-crypto:1.1.0-alpha06")
    implementation("com.google.firebase:firebase-messaging:24.1.0")
}
