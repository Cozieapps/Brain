pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
        // sherpa-onnx (the on-device voice) is published to JitPack by its authors.
        maven("https://jitpack.io") { content { includeGroup("com.github.k2-fsa.sherpa-onnx") } }
    }
}
rootProject.name = "Beside"
include(":app")
