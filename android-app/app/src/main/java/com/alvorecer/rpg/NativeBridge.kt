package com.alvorecer.rpg

import android.webkit.JavascriptInterface
import androidx.work.WorkManager
import com.alvorecer.rpg.sync.DeviceStore
import com.alvorecer.rpg.sync.GalleryApi
import com.alvorecer.rpg.sync.SyncScheduler
import com.google.firebase.messaging.FirebaseMessaging
import java.util.concurrent.Executors

class NativeBridge(private val activity: MainActivity) {
    private val executor = Executors.newSingleThreadExecutor()

    @JavascriptInterface
    fun registerMasterDevice(campaignId: String, accessToken: String, deviceName: String) {
        if (campaignId.isBlank() || accessToken.isBlank()) return
        executor.execute {
            val register: (String?) -> Unit = { fcmToken ->
                runCatching {
                    val registration = GalleryApi.registerDevice(
                        campaignId = campaignId,
                        accessToken = accessToken,
                        installationId = DeviceStore.installationId(activity),
                        deviceName = deviceName.take(80),
                        fcmToken = fcmToken,
                    )
                    DeviceStore.saveRegistration(activity, registration, campaignId)
                    SyncScheduler.resumeNow(activity, "device_registered")
                }
            }
            if (BuildConfig.FCM_CONFIGURED) {
                runCatching {
                    FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
                        register(if (task.isSuccessful) task.result else null)
                    }
                }.onFailure { register(null) }
            } else register(null)
        }
    }

    @JavascriptInterface
    fun resumeGalleryQueue() {
        WorkManager.getInstance(activity).cancelUniqueWork("gallery-resume-now")
        SyncScheduler.resumeNow(activity, "web_requested")
    }
}
