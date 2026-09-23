package com.alvorecer.rpg.sync

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class GalleryMessagingService : FirebaseMessagingService() {
    override fun onMessageReceived(message: RemoteMessage) {
        when (message.data["kind"]) {
            "gallery_original_requested" ->
                SyncScheduler.resumeNow(this, "fcm_request")
            "app_notification" ->
                NativeNotifications.showGeneral(
                    this,
                    count = 1,
                    notificationKey = message.data["notification_id"].orEmpty(),
                )
        }
    }

    override fun onNewToken(token: String) {
        DeviceStore.savePendingFcmToken(this, token)
        SyncScheduler.resumeNow(this, "fcm_token_changed")
    }
}
