package com.alvorecer.rpg

import android.os.Build
import android.util.Log
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

        val submitRegistration: (String?) -> Unit = { fcmToken ->
            executor.execute {
                var lastError: Throwable? = null
                val retryDelays = longArrayOf(0L, 1500L, 5000L)

                for (delay in retryDelays) {
                    if (delay > 0) Thread.sleep(delay)
                    try {
                        val registration = GalleryApi.registerDevice(
                            campaignId = campaignId,
                            accessToken = accessToken,
                            installationId = DeviceStore.installationId(activity),
                            deviceName = listOf(Build.MANUFACTURER, Build.MODEL)
                            .filter { it.isNotBlank() }
                            .joinToString(" ")
                            .ifBlank { deviceName }
                            .take(80),
                            fcmToken = fcmToken,
                        )
                        DeviceStore.saveRegistration(activity, registration, campaignId)
                        SyncScheduler.resumeNow(activity, "device_registered")
                        Log.i("AlvorecerGallery", "Master device registered")
                        return@execute
                    } catch (error: Throwable) {
                        lastError = error
                        Log.w("AlvorecerGallery", "Device registration attempt failed", error)
                    }
                }

                Log.e("AlvorecerGallery", "Device registration failed after retries", lastError)
            }
        }

        if (BuildConfig.FCM_CONFIGURED) {
            runCatching {
                FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
                    submitRegistration(if (task.isSuccessful) task.result else null)
                }
            }.onFailure {
                submitRegistration(null)
            }
        } else {
            submitRegistration(null)
        }
    }

    @JavascriptInterface
    fun resumeGalleryQueue() {
        WorkManager.getInstance(activity).cancelUniqueWork("gallery-resume-now")
        SyncScheduler.resumeNow(activity, "web_requested")
    }
}
