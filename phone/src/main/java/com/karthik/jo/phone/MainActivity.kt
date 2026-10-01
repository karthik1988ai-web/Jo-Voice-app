package com.karthik.jo.phone

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.addCallback
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature

/** Shows the live Jo web app (so the phone always has the latest Jo) and connects it to [NativeBridge]. */
class MainActivity : ComponentActivity(), NativeBridge.Host {
    private lateinit var web: WebView
    private lateinit var bridge: NativeBridge

    // Android shows one permission dialog at a time, so requests wait in line.
    private val permissionQueue = ArrayDeque<Pair<String, (Boolean) -> Unit>>()
    private var asking: ((Boolean) -> Unit)? = null
    private val permissionLauncher = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        asking?.invoke(granted)
        asking = null
        askNext()
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(BG),
            navigationBarStyle = SystemBarStyle.dark(BG),
        )
        super.onCreate(savedInstanceState)

        web = WebView(this)
        web.setBackgroundColor(BG)
        setContentView(web)
        // Keep the page clear of the status bar, navigation bar and keyboard.
        ViewCompat.setOnApplyWindowInsetsListener(web) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            v.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
            WindowInsetsCompat.CONSUMED
        }

        with(web.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true // Jo keeps its settings in the page's local storage
            mediaPlaybackRequiresUserGesture = false // Gemini voice replies and the wake chime
            userAgentString = "$userAgentString JoApp/1"
            setSupportMultipleWindows(false)
        }

        bridge = NativeBridge(this, this)
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            web.loadDataWithBaseURL(null, page("Please update <b>Android System WebView</b> from the Play Store, then open Jo again."), "text/html", "utf-8", null)
            return
        }
        // Only Jo's own website can reach the phone's microphone, voice and notifications.
        WebViewCompat.addWebMessageListener(web, "JoNative", setOf(JoUrls.ORIGIN), bridge)

        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url.toString()
                if (JoUrls.isJo(url)) return false
                openOutside(request.url)
                return true
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) {
                    view.loadDataWithBaseURL(null, page("Jo needs the internet. Check your connection, then<br><a href=\"${JoUrls.HOME}\">try again</a>."), "text/html", "utf-8", null)
                }
            }

            override fun onRenderProcessGone(view: WebView, detail: android.webkit.RenderProcessGoneDetail): Boolean {
                recreate() // the page crashed or was cleared for memory: start fresh instead of closing
                return true
            }
        }

        onBackPressedDispatcher.addCallback(this) {
            // Back closes Jo's settings drawer if it's open; otherwise Jo goes to the background
            // (still running, so mail alerts and reminders keep working).
            web.evaluateJavascript(
                "(function(){var s=document.getElementById('settings');if(s&&!s.hidden){document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));return 1}return 0})()",
            ) { r -> if (r != "1") moveTaskToBack(true) }
        }

        web.loadUrl(JoUrls.HOME)
    }

    override fun onResume() {
        super.onResume()
        bridge.setPaused(false)
    }

    override fun onPause() {
        bridge.setPaused(true)
        super.onPause()
    }

    override fun onDestroy() {
        bridge.release()
        web.destroy()
        super.onDestroy()
    }

    // ---------- NativeBridge.Host ----------
    override val webView: WebView get() = web

    override fun requestPermission(permission: String, onResult: (Boolean) -> Unit) {
        if (ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED) { onResult(true); return }
        permissionQueue.addLast(permission to onResult)
        if (asking == null) askNext()
    }

    private fun askNext() {
        val (permission, onResult) = permissionQueue.removeFirstOrNull() ?: return
        asking = onResult
        permissionLauncher.launch(permission)
    }

    override fun setFullscreen(on: Boolean) {
        val controller = WindowCompat.getInsetsController(window, web)
        controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        if (on) controller.hide(WindowInsetsCompat.Type.systemBars()) else controller.show(WindowInsetsCompat.Type.systemBars())
    }

    private fun openOutside(uri: Uri) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (e: ActivityNotFoundException) {
            Toast.makeText(this, "No app can open this link.", Toast.LENGTH_SHORT).show()
        }
    }

    private fun page(message: String) = """
        <html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
        <body style="background:#030A16;color:#CFEFFF;font-family:sans-serif;display:flex;align-items:center;
        justify-content:center;height:90vh;text-align:center;padding:24px;font-size:18px;line-height:1.6">
        <div><div style="color:#3EE6FF;font-size:34px;letter-spacing:6px;margin-bottom:18px">J.O.</div>$message</div>
        <style>a{color:#3EE6FF}</style></body></html>
    """.trimIndent()

    companion object {
        private val BG = Color.parseColor("#030A16")
    }
}
