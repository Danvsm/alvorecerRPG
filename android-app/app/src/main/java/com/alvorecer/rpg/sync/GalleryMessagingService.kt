package com.alvorecer.rpg.sync

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class GalleryMessagingService : FirebaseMessagingService() {
    override fun onMessageReceived(message: RemoteMessage) {
        when (message.data["kind"]) {
            "gallery_original_requested" ->
                SyncScheduler.resumeNow(this, "fcm_request")

            "app_notification" -> {
                val notificationKind = message.data["notification_kind"].orEmpty()
                val key = message.data["notification_id"].orEmpty()
                val title = message.data["title"].orEmpty()
                val body = message.data["body"].orEmpty()
                val conversationId = message.data["conversation_id"].orEmpty()
                val senderName = message.data["sender_name"].orEmpty()
                val url = message.data["url"].orEmpty().ifBlank { "/" }

                when (notificationKind) {
                    "message" ->
                        NativeNotifications.showMessage(
                            this,
                            notificationKey = key,
                            senderName = senderName.ifBlank { title },
                            message = body,
                            conversationId = conversationId,
                            url = url,
                        )

                    "call" ->
                        NativeNotifications.showCall(
                            this,
                            notificationKey = key,
                            senderName = senderName.ifBlank { title },
                            conversationId = conversationId,
                            url = url,
                        )

                    else ->
                        NativeNotifications.showGeneral(
                            this,
                            notificationKey = key,
                            title = title.ifBlank { "Alvorecer" },
                            message = body.ifBlank { "Você recebeu uma nova notificação." },
                            url = url,
                        )
                }
            }
        }
    }

    override fun onNewToken(token: String) {
        DeviceStore.savePendingFcmToken(this, token)
        SyncScheduler.resumeNow(this, "fcm_token_changed")
    }
}
