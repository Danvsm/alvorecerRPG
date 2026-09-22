package com.alvorecer.rpg.sync

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class GalleryMessagingService : FirebaseMessagingService() {
    override fun onMessageReceived(message: RemoteMessage) {
        if (message.data["kind"] == "gallery_original_requested") SyncScheduler.resumeNow(this, "fcm_request")
    }

    override fun onNewToken(token: String) {
        val deviceToken = DeviceStore.deviceToken(this) ?: return
        runCatching { GalleryApi.updateFcm(deviceToken, token) }
    }
}
