plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

// Optional local llama.cpp checkout (faster than fetching): -PllamaSrc=/path/to/llama.cpp
val llamaSrc = (findProperty("llamaSrc") as String?) ?: ""

android {
    namespace = "app.beside"
    compileSdk = 36
    ndkVersion = "28.2.13676358"

    defaultConfig {
        applicationId = "app.beside.companion"
        minSdk = 31
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
        ndk { abiFilters += listOf("arm64-v8a") }
        externalNativeBuild {
            cmake {
                arguments += listOf("-DANDROID_STL=c++_static", "-DLLAMA_SRC=$llamaSrc")
                cppFlags += listOf("-std=c++17")
            }
        }
    }

    signingConfigs {
        // A fixed key so every new APK installs over the previous one. Replace with your own
        // private key before sharing the app with anyone else.
        create("sideload") {
            storeFile = file("sideload.keystore")
            storePassword = "beside-sideload"
            keyAlias = "beside"
            keyPassword = "beside-sideload"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("sideload")
        }
        debug {
            signingConfig = signingConfigs.getByName("sideload")
        }
    }

    externalNativeBuild {
        cmake {
            path = file("src/main/cpp/CMakeLists.txt")
            version = "3.31.0"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures { compose = true }
    packaging {
        jniLibs { useLegacyPackaging = true }
        resources { excludes += "/META-INF/{AL2.0,LGPL2.1}" }
    }
    testOptions { unitTests.isReturnDefaultValues = true }
}

kotlin { compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) } }

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2026.01.01")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.activity:activity-compose:1.12.2")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.10.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.10.0")
    implementation("androidx.core:core-ktx:1.17.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.11.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.11.0")
    implementation("org.apache.commons:commons-compress:1.28.0")
    implementation("com.github.k2-fsa.sherpa-onnx:sherpa-onnx:v1.13.8")
    debugImplementation("androidx.compose.ui:ui-tooling")
    testImplementation("junit:junit:4.13.2")
}
