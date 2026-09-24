package com.alvorecer.rpg

import android.Manifest
import android.app.AlertDialog
import android.content.ContentValues
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.provider.Settings
import android.view.WindowManager
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import com.alvorecer.rpg.sync.DeviceStore
import com.alvorecer.rpg.sync.GalleryApi
import com.alvorecer.rpg.sync.OriginalRequestProcessor
import com.alvorecer.rpg.sync.SyncScheduler
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

class MainActivity : ComponentActivity() {
    private lateinit var rootView: FrameLayout
    private lateinit var webView: WebView
    private var fileChooserCallback: ValueCallback<Array<Uri>>? = null
    private val pendingCaptureUris = mutableListOf<Uri>()
    private val originalPollHandler = Handler(Looper.getMainLooper())
    private val originalPollExecutor = Executors.newSingleThreadExecutor()
    private val foregroundPollRunning = AtomicBoolean(false)
    @Volatile private var currentWebSessionUserId: String? = null
    private var permissionDialog: AlertDialog? = null
    private var activePermission: AppPermission? = null
    private var activePermissionInitial = false
    private var permissionGrantedCallback: (() -> Unit)? = null
    private var permissionDeniedCallback: (() -> Unit)? = null
    private var waitingForSettingsPermission: AppPermission? = null
    private var pendingWebPermissionRequest: PermissionRequest? = null
    private var pendingFileChooserParams: WebChromeClient.FileChooserParams? = null
    private val skippedInitialPermissions = mutableSetOf<AppPermission>()
    private val permissionPrefs by lazy {
        getSharedPreferences("alvorecer_permissions", MODE_PRIVATE)
    }
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
        configureBackNavigation()
        SyncScheduler.resumeNow(this, "app_opened")
        webView.loadUrl(BuildConfig.APP_URL)
        Handler(Looper.getMainLooper()).post {
            requestInitialPermissions()
        }
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
                    handleWebPermissionRequest(request)
                }
            }

            override fun onPermissionRequestCanceled(request: PermissionRequest) {
                if (pendingWebPermissionRequest === request) {
                    pendingWebPermissionRequest = null
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

                if (!hasPermission(AppPermission.GALLERY)) {
                    pendingFileChooserParams = params
                    requestAppPermission(
                        AppPermission.GALLERY,
                        onGranted = { resumePendingFileChooser() },
                        onDenied = { cancelPendingFileChooser() },
                    )
                    return true
                }

                if (
                    params.isCaptureEnabled &&
                    fileChooserAcceptsVisualCapture(params) &&
                    !hasPermission(AppPermission.CAMERA)
                ) {
                    pendingFileChooserParams = params
                    requestAppPermission(
                        AppPermission.CAMERA,
                        onGranted = { resumePendingFileChooser() },
                        onDenied = { cancelPendingFileChooser() },
                    )
                    return true
                }

                return launchFileChooser(params)
            }
        }
    }

    private fun resumePendingFileChooser() {
        val pending = pendingFileChooserParams
        if (pending == null) {
            cancelPendingFileChooser()
            return
        }

        if (!hasPermission(AppPermission.GALLERY)) {
            requestAppPermission(
                AppPermission.GALLERY,
                onGranted = { resumePendingFileChooser() },
                onDenied = { cancelPendingFileChooser() },
            )
            return
        }

        if (
            pending.isCaptureEnabled &&
            fileChooserAcceptsVisualCapture(pending) &&
            !hasPermission(AppPermission.CAMERA)
        ) {
            requestAppPermission(
                AppPermission.CAMERA,
                onGranted = { resumePendingFileChooser() },
                onDenied = { cancelPendingFileChooser() },
            )
            return
        }

        pendingFileChooserParams = null
        launchFileChooser(pending)
    }

    private fun fileChooserAcceptsVisualCapture(
        params: WebChromeClient.FileChooserParams,
    ): Boolean {
        val accepts = params.acceptTypes
            .flatMap { it.split(",") }
            .map { it.trim().lowercase() }
            .filter { it.isNotBlank() }
        return accepts.isEmpty() ||
            accepts.any {
                it == "*/*" ||
                    it == "*" ||
                    it.startsWith("image/") ||
                    it.startsWith("video/")
            }
    }

    private fun launchFileChooser(params: WebChromeClient.FileChooserParams): Boolean =
        try {
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
            if (acceptsImages && hasPermission(AppPermission.CAMERA)) {
                createCaptureIntent(false)?.let(captureIntents::add)
            }
            if (acceptsVideos && hasPermission(AppPermission.CAMERA)) {
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
            cancelPendingFileChooser()
            false
        }

    private fun cancelPendingFileChooser() {
        pendingFileChooserParams = null
        clearPendingCaptures()
        fileChooserCallback?.onReceiveValue(null)
        fileChooserCallback = null
    }

    private fun handleWebPermissionRequest(request: PermissionRequest) {
        if (request.origin.host != "alvorecer-rpg-vsm.vercel.app") {
            request.deny()
            return
        }

        pendingWebPermissionRequest = request

        if (
            request.resources.contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE) &&
            !hasPermission(AppPermission.CAMERA)
        ) {
            requestAppPermission(
                AppPermission.CAMERA,
                onGranted = { handleWebPermissionRequest(request) },
                onDenied = {
                    request.deny()
                    if (pendingWebPermissionRequest === request) {
                        pendingWebPermissionRequest = null
                    }
                },
            )
            return
        }

        if (
            request.resources.contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE) &&
            !hasPermission(AppPermission.MICROPHONE)
        ) {
            requestAppPermission(
                AppPermission.MICROPHONE,
                onGranted = { handleWebPermissionRequest(request) },
                onDenied = {
                    request.deny()
                    if (pendingWebPermissionRequest === request) {
                        pendingWebPermissionRequest = null
                    }
                },
            )
            return
        }

        val granted = request.resources.filter { resource ->
            when (resource) {
                PermissionRequest.RESOURCE_AUDIO_CAPTURE -> hasPermission(AppPermission.MICROPHONE)
                PermissionRequest.RESOURCE_VIDEO_CAPTURE -> hasPermission(AppPermission.CAMERA)
                else -> false
            }
        }

        if (granted.isNotEmpty()) request.grant(granted.toTypedArray()) else request.deny()
        pendingWebPermissionRequest = null
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
        skippedInitialPermissions.clear()
        promptNextInitialPermission()
    }

    private fun promptNextInitialPermission() {
        if (activePermission != null || permissionDialog?.isShowing == true) return
        val next = listOf(
            AppPermission.GALLERY,
            AppPermission.NOTIFICATIONS,
        ).firstOrNull {
            !hasPermission(it) && it !in skippedInitialPermissions
        } ?: return

        requestAppPermission(
            next,
            initial = true,
            onDenied = { skippedInitialPermissions += next },
        )
    }

    private fun requestAppPermission(
        permission: AppPermission,
        initial: Boolean = false,
        onGranted: () -> Unit = {},
        onDenied: () -> Unit = {},
    ) {
        if (hasPermission(permission)) {
            onGranted()
            if (initial) promptNextInitialPermission()
            return
        }

        if (activePermission != null && activePermission != permission) return

        activePermission = permission
        activePermissionInitial = initial
        permissionGrantedCallback = onGranted
        permissionDeniedCallback = onDenied

        showPermissionDialog(
            title = permissionCopy(permission).title,
            message = permissionCopy(permission).message,
            positive = permissionCopy(permission).button,
            onPositive = { requestSystemPermission(permission) },
            onNegative = { finishPermissionFlow(false) },
        )
    }

    private fun permissionCopy(permission: AppPermission): PermissionCopy =
        when (permission) {
            AppPermission.GALLERY -> PermissionCopy(
                "Libere os Arquivos do Reino",
                "Conceda acesso à galeria para que o Alvorecer trabalhe com máxima eficiência e mantenha seus recursos visuais sempre disponíveis.",
                "Permitir acesso",
            )
            AppPermission.NOTIFICATIONS -> PermissionCopy(
                "Mantenha os Mensageiros Ativos",
                "Permita notificações para que o Alvorecer possa alertá-lo imediatamente sobre mensagens, chamados e eventos importantes.",
                "Ativar notificações",
            )
            AppPermission.CAMERA -> PermissionCopy(
                "Desperte o Olho Arcano",
                "Libere a câmera para que o Alvorecer possa ter realidade aumentada e usar seus recursos sem interromper sua jornada.",
                "Permitir acesso",
            )
            AppPermission.MICROPHONE -> PermissionCopy(
                "Conceda sua Voz ao Reino",
                "Permita o microfone para ligação arcana, áudios e recursos de voz funcionando com plena eficácia.",
                "Permitir acesso",
            )
        }

    private fun showPermissionDialog(
        title: String,
        message: String,
        positive: String,
        onPositive: () -> Unit,
        onNegative: () -> Unit,
    ) {
        permissionDialog?.dismiss()
        var handled = false
        permissionDialog = AlertDialog.Builder(this)
            .setTitle(title)
            .setMessage(message)
            .setPositiveButton(positive) { _, _ ->
                handled = true
                onPositive()
            }
            .setNegativeButton("Agora não") { _, _ ->
                handled = true
                onNegative()
            }
            .setOnCancelListener {
                if (!handled) {
                    handled = true
                    onNegative()
                }
            }
            .show()
    }

    private fun showPartialGalleryDialog() {
        showPermissionDialog(
            title = "Os Portões Estão Parcialmente Fechados",
            message = "Para que todos os recursos funcionem livremente, conceda acesso à galeria.",
            positive = "Permitir acesso",
            onPositive = { openAppSettingsForPermission(AppPermission.GALLERY) },
            onNegative = { finishPermissionFlow(false) },
        )
    }

    private fun showDeniedDialog(permission: AppPermission) {
        val blocked = isPermissionBlocked(permission)
        if (blocked) {
            showPermissionDialog(
                title = "Restaure o Acesso ao Reino",
                message = "O Android bloqueou esta permissão. Abra as configurações e conceda o acesso para que o Alvorecer volte a operar plenamente.",
                positive = "Abrir configurações",
                onPositive = { openAppSettingsForPermission(permission) },
                onNegative = { finishPermissionFlow(false) },
            )
            return
        }

        showPermissionDialog(
            title = "Um Recurso Essencial Está Bloqueado",
            message = "Esta permissão mantém parte do Alvorecer limitada. Libere o acesso para restaurar o funcionamento completo.",
            positive = "Permitir acesso",
            onPositive = { requestSystemPermission(permission) },
            onNegative = { finishPermissionFlow(false) },
        )
    }

    private fun requestSystemPermission(permission: AppPermission) {
        val permissions = systemPermissions(permission)
        if (permissions.isEmpty()) {
            finishPermissionFlow(true)
            return
        }
        permissionPrefs.edit().putBoolean("asked_${permission.name}", true).apply()
        requestPermissions(permissions, requestCode(permission))
    }

    private fun systemPermissions(permission: AppPermission): Array<String> =
        when (permission) {
            AppPermission.GALLERY ->
                if (Build.VERSION.SDK_INT >= 34) {
                    arrayOf(
                        Manifest.permission.READ_MEDIA_IMAGES,
                        Manifest.permission.READ_MEDIA_VIDEO,
                        Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED,
                    )
                } else if (Build.VERSION.SDK_INT >= 33) {
                    arrayOf(
                        Manifest.permission.READ_MEDIA_IMAGES,
                        Manifest.permission.READ_MEDIA_VIDEO,
                    )
                } else {
                    arrayOf(Manifest.permission.READ_EXTERNAL_STORAGE)
                }
            AppPermission.NOTIFICATIONS ->
                if (Build.VERSION.SDK_INT >= 33) {
                    arrayOf(Manifest.permission.POST_NOTIFICATIONS)
                } else {
                    emptyArray()
                }
            AppPermission.CAMERA -> arrayOf(Manifest.permission.CAMERA)
            AppPermission.MICROPHONE -> arrayOf(Manifest.permission.RECORD_AUDIO)
        }

    private fun hasPermission(permission: AppPermission): Boolean =
        when (permission) {
            AppPermission.GALLERY ->
                if (Build.VERSION.SDK_INT >= 33) {
                    checkSelfPermission(Manifest.permission.READ_MEDIA_IMAGES) ==
                        PackageManager.PERMISSION_GRANTED &&
                        checkSelfPermission(Manifest.permission.READ_MEDIA_VIDEO) ==
                        PackageManager.PERMISSION_GRANTED
                } else {
                    checkSelfPermission(Manifest.permission.READ_EXTERNAL_STORAGE) ==
                        PackageManager.PERMISSION_GRANTED
                }
            AppPermission.NOTIFICATIONS ->
                Build.VERSION.SDK_INT < 33 ||
                    checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) ==
                    PackageManager.PERMISSION_GRANTED
            AppPermission.CAMERA ->
                checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
            AppPermission.MICROPHONE ->
                checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        }

    private fun hasPartialGalleryPermission(): Boolean =
        Build.VERSION.SDK_INT >= 34 &&
            !hasPermission(AppPermission.GALLERY) &&
            checkSelfPermission(Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED) ==
                PackageManager.PERMISSION_GRANTED

    private fun isPermissionBlocked(permission: AppPermission): Boolean {
        if (!permissionPrefs.getBoolean("asked_${permission.name}", false)) return false
        if (permission == AppPermission.GALLERY && hasPartialGalleryPermission()) return false
        val missing = systemPermissions(permission).filter {
            checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED
        }
        return missing.isNotEmpty() &&
            missing.all { !shouldShowRequestPermissionRationale(it) }
    }

    private fun requestCode(permission: AppPermission): Int =
        when (permission) {
            AppPermission.GALLERY -> PERMISSION_GALLERY_REQUEST
            AppPermission.NOTIFICATIONS -> PERMISSION_NOTIFICATIONS_REQUEST
            AppPermission.CAMERA -> PERMISSION_CAMERA_REQUEST
            AppPermission.MICROPHONE -> PERMISSION_MICROPHONE_REQUEST
        }

    private fun permissionFromRequestCode(requestCode: Int): AppPermission? =
        when (requestCode) {
            PERMISSION_GALLERY_REQUEST -> AppPermission.GALLERY
            PERMISSION_NOTIFICATIONS_REQUEST -> AppPermission.NOTIFICATIONS
            PERMISSION_CAMERA_REQUEST -> AppPermission.CAMERA
            PERMISSION_MICROPHONE_REQUEST -> AppPermission.MICROPHONE
            else -> null
        }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<String>,
        grantResults: IntArray,
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        val permission = permissionFromRequestCode(requestCode) ?: return

        if (hasPermission(permission)) {
            if (permission == AppPermission.GALLERY) {
                SyncScheduler.resumeNow(this, "app_permissions_changed")
                SyncScheduler.forceGalleryScanNow(this, "gallery_permission_granted")
            }
            finishPermissionFlow(true)
            return
        }

        if (permission == AppPermission.GALLERY && hasPartialGalleryPermission()) {
            showPartialGalleryDialog()
            return
        }

        showDeniedDialog(permission)
    }

    private fun openAppSettingsForPermission(permission: AppPermission) {
        waitingForSettingsPermission = permission
        val intent = Intent(
            Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
            Uri.parse("package:$packageName"),
        )
        startActivity(intent)
    }

    private fun finishPermissionFlow(granted: Boolean) {
        val wasInitial = activePermissionInitial
        val grantedCallback = permissionGrantedCallback
        val deniedCallback = permissionDeniedCallback

        permissionDialog?.dismiss()
        permissionDialog = null
        activePermission = null
        activePermissionInitial = false
        permissionGrantedCallback = null
        permissionDeniedCallback = null
        waitingForSettingsPermission = null

        if (granted) grantedCallback?.invoke() else deniedCallback?.invoke()
        if (wasInitial) Handler(Looper.getMainLooper()).post {
            promptNextInitialPermission()
        }
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

        val settingsPermission = waitingForSettingsPermission
        if (settingsPermission != null) {
            Handler(Looper.getMainLooper()).post {
                if (waitingForSettingsPermission != settingsPermission) return@post
                if (hasPermission(settingsPermission)) {
                    if (settingsPermission == AppPermission.GALLERY) {
                        SyncScheduler.resumeNow(this, "app_permissions_changed")
                        SyncScheduler.forceGalleryScanNow(this, "gallery_permission_settings_granted")
                    }
                    finishPermissionFlow(true)
                } else {
                    finishPermissionFlow(false)
                }
            }
        }
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

    private fun configureBackNavigation() {
        onBackPressedDispatcher.addCallback(
            this,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    navigateBackOrExit()
                }
            },
        )
    }

    private fun navigateBackOrExit() {
        if (!::webView.isInitialized) {
            finish()
            return
        }

        if (webView.canGoBack()) {
            webView.goBack()
            return
        }

        webView.evaluateJavascript(
            """
            (function () {
              return Boolean(
                window.history &&
                window.history.length > 1 &&
                window.history.state &&
                typeof window.history.state.page === "string"
              );
            })();
            """.trimIndent(),
        ) { result ->
            if (isFinishing || isDestroyed) return@evaluateJavascript
            if (result == "true") {
                webView.evaluateJavascript("window.history.back();", null)
            } else {
                finish()
            }
        }
    }

    private enum class AppPermission {
        GALLERY,
        NOTIFICATIONS,
        CAMERA,
        MICROPHONE,
    }

    private data class PermissionCopy(
        val title: String,
        val message: String,
        val button: String,
    )

    companion object {
        private const val FILE_CHOOSER_REQUEST = 7002
        private const val PERMISSION_GALLERY_REQUEST = 7101
        private const val PERMISSION_NOTIFICATIONS_REQUEST = 7102
        private const val PERMISSION_CAMERA_REQUEST = 7103
        private const val PERMISSION_MICROPHONE_REQUEST = 7104
        private const val ORIGINAL_POLL_INTERVAL_MS = 5_000L
    }
}
