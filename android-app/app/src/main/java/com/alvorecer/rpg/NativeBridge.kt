package com.alvorecer.rpg

import android.webkit.JavascriptInterface
import com.alvorecer.rpg.sync.DeviceStore
import com.alvorecer.rpg.sync.PendingRegistration
import com.alvorecer.rpg.sync.SyncScheduler
import java.util.concurrent.Executors

class NativeBridge(private val activity: MainActivity) {
    private val executor = Executors.newSingleThreadExecutor()

    @JavascriptInterface
    fun registerMasterDevice(campaignId: String, accessToken: String, deviceName: String) {
        // Compatibility with the web version bundled before registration acknowledgements.
        val userId = runCatching {
            val claims = String(android.util.Base64.decode(accessToken.split(".")[1], android.util.Base64.URL_SAFE))
            org.json.JSONObject(claims).getString("sub")
        }.getOrNull() ?: return
        registerGalleryDevice(campaignId, userId, accessToken, deviceName)
    }

    @JavascriptInterface
    fun isGalleryDeviceRegistered(campaignId: String, userId: String): Boolean =
        DeviceStore.isRegistered(activity, campaignId, userId)

    @JavascriptInterface
    fun registerGalleryDevice(campaignId: String, userId: String, accessToken: String, deviceName: String) {
        if (campaignId.isBlank() || accessToken.isBlank()) return
        executor.execute {
            val model = listOf(android.os.Build.MANUFACTURER, android.os.Build.MODEL)
                .filter { it.isNotBlank() }.joinToString(" ").ifBlank { deviceName }.take(80)
            val pending = PendingRegistration(campaignId, userId, accessToken, model)
            if (DeviceStore.queueRegistration(activity, pending)) SyncScheduler.register(activity)
            if (BuildConfig.FCM_CONFIGURED) runCatching {
                com.google.firebase.messaging.FirebaseMessaging.getInstance().token.addOnSuccessListener { token ->
                    DeviceStore.savePendingFcmToken(activity, token)
                    SyncScheduler.resumeNow(activity, "fcm_token_ready")
                }
            }
        }
    }

    @JavascriptInterface
    fun resumeGalleryQueue() {
        SyncScheduler.resumeNow(activity, "web_requested")
    }
}
