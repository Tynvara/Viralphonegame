# Methods called from JavaScript must survive minification.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
