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
    }
}

rootProject.name = "Moonsling"
include(":app")

// Second game: Critter Merge (web game in critter-merge/web, Android wrapper in critter-merge/app)
include(":crittermerge")
project(":crittermerge").projectDir = file("critter-merge/app")
