package com.alvorecer.rpg

import android.app.Application
import com.alvorecer.rpg.sync.DeviceStore
import com.alvorecer.rpg.sync.NativeNotifications
import com.alvorecer.rpg.sync.SyncScheduler
import com.google.firebase.messaging.FirebaseMessaging

class AlvorecerApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        NativeNotifications.createChannels(this)
        SyncScheduler.schedulePeriodic(this)

        if (BuildConfig.FCM_CONFIGURED) {
            FirebaseMessaging.getInstance().token
                .addOnSuccessListener { token ->
                    if (token.isNotBlank()) {
                        DeviceStore.savePendingFcmToken(this, token)
                        SyncScheduler.resumeNow(this, "fcm_token_ready")
                    }
                }
        }
    }
}
