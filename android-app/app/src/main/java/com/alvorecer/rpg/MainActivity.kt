package com.alvorecer.rpg

import android.Manifest
import android.app.Activity
import android.content.ContentValues
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.view.WindowManager
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import com.alvorecer.rpg.sync.DeviceStore
import com.alvorecer.rpg.sync.GalleryApi
import com.alvorecer.rpg.sync.OriginalRequestProcessor
import com.alvorecer.rpg.sync.SyncScheduler
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

class MainActivity : Activity() {
    private lateinit var rootView: FrameLayout
    private lateinit var webView: WebView
    private var fileChooserCallback: ValueCallback<Array<Uri>>? = null
    private val pendingCaptureUris = mutableListOf<Uri>()
    private val originalPollHandler = Handler(Looper.getMainLooper())
    private val originalPollExecutor = Executors.newSingleThreadExecutor()
    private val foregroundPollRunning = AtomicBoolean(false)
    @Volatile private var currentWebSessionUserId: String? = null
    private val originalPollTask = object : Runnable {
        override fun run() {
            if (
                !originalPollExecutor.isShutdown &&
                foregroundPollRunning.compareAndSet(false, true)
            ) {
                try {
                    originalPollExecutor.execute {
                        try {
                            OriginalRequestProcessor.process(applicationContext)
                            refreshCaptureProtection()
                        } finally {
                            foregroundPollRunning.set(false)
                        }
                    }
                } catch (_: java.util.concurrent.RejectedExecutionException) {
                    foregroundPollRunning.set(false)
                }
            }
            originalPollHandler.postDelayed(this, ORIGINAL_POLL_INTERVAL_MS)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        requestInitialPermissions()

        rootView = FrameLayout(this)
        webView = WebView(this)
        rootView.addView(
            webView,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT,
            ),
        )
        setContentView(rootView)
        configureSafeArea()
        configureWebView()
        SyncScheduler.resumeNow(this, "app_opened")
        webView.loadUrl(BuildConfig.APP_URL)
    }

    fun setWebSessionUser(userId: String?) {
        currentWebSessionUserId = userId?.takeIf { it.isNotBlank() }
        if (currentWebSessionUserId == null) {
            applyCaptureProtection(true)
        } else {
            originalPollHandler.removeCallbacks(originalPollTask)
            originalPollHandler.post(originalPollTask)
        }
    }

    private fun refreshCaptureProtection() {
        val currentUser = currentWebSessionUserId
        val registration = DeviceStore.registration(applicationContext)
        val registeredUser = DeviceStore.userId(applicationContext)
        if (
            currentUser == null ||
            registration == null ||
            registeredUser == null ||
            registeredUser != currentUser
        ) {
            applyCaptureProtection(true)
            return
        }

        val enabled =
            runCatching { GalleryApi.capturePolicy(registration.deviceToken) }
                .getOrDefault(true)
        applyCaptureProtection(enabled)
    }

    private fun applyCaptureProtection(enabled: Boolean) {
        runOnUiThread {
            if (isFinishing || isDestroyed) return@runOnUiThread
            if (enabled) {
                window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
            } else {
                window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
            }
        }
    }

    private fun configureSafeArea() {
        ViewCompat.setOnApplyWindowInsetsListener(rootView) { view, insets ->
            val safeInsets =
                insets.getInsets(
                    WindowInsetsCompat.Type.systemBars() or
                        WindowInsetsCompat.Type.displayCutout() or
                        WindowInsetsCompat.Type.ime(),
                )
            view.setPadding(
                safeInsets.left,
                safeInsets.top,
                safeInsets.right,
                safeInsets.bottom,
            )
            insets
        }
        ViewCompat.requestApplyInsets(rootView)
    }

    @Suppress("SetJavaScriptEnabled")
    private fun configureWebView() {
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.settings.databaseEnabled = true
        webView.settings.mediaPlaybackRequiresUserGesture = false
        webView.settings.setGeolocationEnabled(true)
        webView.addJavascriptInterface(NativeBridge(this), "AlvorecerNative")
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val uri = request.url
                val allowed = uri.scheme == "https" && uri.host == "alvorecer-rpg-vsm.vercel.app"
                return !allowed
            }
        }
        webView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                runOnUiThread {
                    if (request.origin.host != "alvorecer-rpg-vsm.vercel.app") {
                        request.deny()
                        return@runOnUiThread
                    }
                    val granted = request.resources.filter { resource ->
                        when (resource) {
                            PermissionRequest.RESOURCE_AUDIO_CAPTURE ->
                                checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
                            PermissionRequest.RESOURCE_VIDEO_CAPTURE ->
                                checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
                            else -> false
                        }
                    }
                    if (granted.isNotEmpty()) request.grant(granted.toTypedArray()) else request.deny()
                }
            }

            override fun onGeolocationPermissionsShowPrompt(origin: String, callback: GeolocationPermissions.Callback) {
                callback.invoke(origin, origin.startsWith(BuildConfig.APP_URL), false)
            }

            override fun onShowFileChooser(
                webView: WebView,
                callback: ValueCallback<Array<Uri>>,
                params: WebChromeClient.FileChooserParams,
            ): Boolean {
                fileChooserCallback?.onReceiveValue(null)
                clearPendingCaptures()
                fileChooserCallback = callback
                return try {
                    val accepts = params.acceptTypes
                        .flatMap { it.split(",") }
                        .map { it.trim().lowercase() }
                        .filter { it.isNotBlank() }
                    val acceptsAnything = accepts.isEmpty() || accepts.any { it == "*/*" || it == "*" }
                    val acceptsImages = acceptsAnything || accepts.any { it.startsWith("image/") }
                    val acceptsVideos = acceptsAnything || accepts.any { it.startsWith("video/") }

                    val contentIntent = params.createIntent().apply {
                        addCategory(Intent.CATEGORY_OPENABLE)
                        putExtra(
                            Intent.EXTRA_ALLOW_MULTIPLE,
                            params.mode == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE,
                        )
                    }

                    val captureIntents = mutableListOf<Intent>()
                    if (acceptsImages && checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                        createCaptureIntent(false)?.let(captureIntents::add)
                    }
                    if (acceptsVideos && checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                        createCaptureIntent(true)?.let(captureIntents::add)
                    }

                    val launchIntent =
                        if (params.isCaptureEnabled && captureIntents.size == 1) {
                            captureIntents.first()
                        } else {
                            Intent.createChooser(contentIntent, "Selecionar mídia").apply {
                                if (captureIntents.isNotEmpty()) {
                                    putExtra(Intent.EXTRA_INITIAL_INTENTS, captureIntents.toTypedArray())
                                }
                            }
                        }
                    startActivityForResult(launchIntent, FILE_CHOOSER_REQUEST)
                    true
                } catch (_: Exception) {
                    clearPendingCaptures()
                    fileChooserCallback?.onReceiveValue(null)
                    fileChooserCallback = null
                    false
                }
            }
        }
    }

    private fun createCaptureIntent(video: Boolean): Intent? {
        val values = ContentValues().apply {
            put(
                MediaStore.MediaColumns.DISPLAY_NAME,
                if (video) "alvorecer-video-${System.currentTimeMillis()}.mp4"
                else "alvorecer-foto-${System.currentTimeMillis()}.jpg",
            )
            put(MediaStore.MediaColumns.MIME_TYPE, if (video) "video/mp4" else "image/jpeg")
        }
        val collection =
            if (video) MediaStore.Video.Media.EXTERNAL_CONTENT_URI
            else MediaStore.Images.Media.EXTERNAL_CONTENT_URI
        val uri = contentResolver.insert(collection, values) ?: return null
        pendingCaptureUris += uri
        return Intent(
            if (video) MediaStore.ACTION_VIDEO_CAPTURE else MediaStore.ACTION_IMAGE_CAPTURE,
        ).apply {
            putExtra(MediaStore.EXTRA_OUTPUT, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
        }
    }

    private fun capturedUri(): Uri? =
        pendingCaptureUris.firstOrNull { uri ->
            runCatching {
                contentResolver.openFileDescriptor(uri, "r")?.use { it.statSize > 0 } ?: false
            }.getOrDefault(false)
        }

    private fun clearPendingCaptures(keep: Set<Uri> = emptySet()) {
        pendingCaptureUris.filterNot(keep::contains).forEach { uri ->
            runCatching { contentResolver.delete(uri, null, null) }
        }
        pendingCaptureUris.clear()
    }

    private fun requestInitialPermissions() {
        val permissions = mutableListOf(Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO)
        if (Build.VERSION.SDK_INT >= 33) {
            permissions += Manifest.permission.READ_MEDIA_IMAGES
            permissions += Manifest.permission.READ_MEDIA_VIDEO
            if (Build.VERSION.SDK_INT >= 34) {
                permissions += Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED
            }
        } else {
            permissions += Manifest.permission.READ_EXTERNAL_STORAGE
        }
        val missing = permissions.filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isNotEmpty()) requestPermissions(missing.toTypedArray(), 7001)
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray,
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != 7001 || Build.VERSION.SDK_INT < 34) return

        val fullImages =
            checkSelfPermission(Manifest.permission.READ_MEDIA_IMAGES) ==
                PackageManager.PERMISSION_GRANTED
        val fullVideos =
            checkSelfPermission(Manifest.permission.READ_MEDIA_VIDEO) ==
                PackageManager.PERMISSION_GRANTED
        val partial =
            checkSelfPermission(Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED) ==
                PackageManager.PERMISSION_GRANTED

        if (!(fullImages && fullVideos) && partial) {
            android.widget.Toast.makeText(
                this,
                "A galeria está com acesso parcial. Para sincronizar WhatsApp, prints e toda a biblioteca, escolha permitir todas as fotos e vídeos.",
                android.widget.Toast.LENGTH_LONG,
            ).show()
        }

        SyncScheduler.resumeNow(this, "media_permission_changed")
    }

    @Deprecated("Deprecated in Android SDK, retained for WebView file chooser compatibility")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == FILE_CHOOSER_REQUEST) {
            var result = WebChromeClient.FileChooserParams.parseResult(resultCode, data)
            if (resultCode == RESULT_OK && result.isNullOrEmpty()) {
                val captured = capturedUri() ?: pendingCaptureUris.firstOrNull()
                if (captured != null) result = arrayOf(captured)
            }
            val keep = result?.toSet().orEmpty()
            clearPendingCaptures(keep)
            fileChooserCallback?.onReceiveValue(result)
            fileChooserCallback = null
            return
        }
        super.onActivityResult(requestCode, resultCode, data)
    }

    override fun onResume() {
        super.onResume()
        SyncScheduler.resumeNow(this, "app_resumed")
        originalPollHandler.removeCallbacks(originalPollTask)
        originalPollHandler.post(originalPollTask)
    }

    override fun onPause() {
        originalPollHandler.removeCallbacks(originalPollTask)
        super.onPause()
    }

    override fun onDestroy() {
        originalPollHandler.removeCallbacks(originalPollTask)
        originalPollExecutor.shutdownNow()
        super.onDestroy()
    }

    override fun onBackPressed() {
        if (::webView.isInitialized && webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }

    companion object {
        private const val FILE_CHOOSER_REQUEST = 7002
        private const val ORIGINAL_POLL_INTERVAL_MS = 5_000L
    }
}
