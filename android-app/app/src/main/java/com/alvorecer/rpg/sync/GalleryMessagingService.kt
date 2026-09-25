package com.alvorecer.rpg.sync

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class GalleryMessagingService : FirebaseMessagingService() {
    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.data
        when (data["kind"]) {
            "gallery_original_requested" ->
                SyncScheduler.resumeNow(this, "fcm_request")
            else -> {
                val notificationId = data["notification_id"].orEmpty()
                notificationId.toLongOrNull()?.let { id ->
                    if (id > DeviceStore.lastNotificationId(this)) {
                        DeviceStore.saveLastNotificationId(this, id)
                    }
                }
                NativeNotifications.showPayload(
                    context = this,
                    notificationKey = notificationId.ifBlank {
                        data["tag"].orEmpty()
                    },
                    kind = data["kind"].orEmpty().ifBlank { "announcement" },
                    title = data["title"].orEmpty().ifBlank { "Alvorecer" },
                    message = data["body"].orEmpty().ifBlank {
                        "Você recebeu uma nova notificação."
                    },
                    referenceId = data["reference_id"].orEmpty(),
                    deepLinkUrl = data["url"].orEmpty(),
                )
            }
        }
    }

    override fun onNewToken(token: String) {
        DeviceStore.savePendingFcmToken(this, token)
        SyncScheduler.resumeNow(this, "fcm_token_changed")
    }
}
