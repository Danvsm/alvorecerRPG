package com.alvorecer.rpg.sync

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class GalleryMessagingService : FirebaseMessagingService() {
    override fun onMessageReceived(message: RemoteMessage) {
        val kind = message.data["kind"].orEmpty()

        if (kind == "gallery_original_requested") {
            SyncScheduler.resumeNow(this, "fcm_request")
            return
        }

        val key =
            message.data["notification_id"].orEmpty()
                .ifBlank { message.data["tag"].orEmpty() }
        val title = message.data["title"].orEmpty()
        val body = message.data["body"].orEmpty()
        val conversationId = message.data["conversation_id"].orEmpty()
        val url = message.data["url"].orEmpty().ifBlank { "/" }

        when (kind) {
            "chat_message", "group_message", "message" ->
                NativeNotifications.showMessage(
                    this,
                    notificationKey = key,
                    senderName = title,
                    message = body,
                    conversationId = conversationId,
                    url = url,
                )

            "call" ->
                NativeNotifications.showCall(
                    this,
                    notificationKey = key,
                    senderName =
                        title
                            .removePrefix("Ligação Arcana de ")
                            .removeSuffix(" está ligando"),
                    conversationId = conversationId,
                    url = url,
                )

            "mention", "announcement", "event", "reward", "warning", "cosmetic", "wallet" ->
                NativeNotifications.showGeneral(
                    this,
                    notificationKey = key,
                    title = title.ifBlank { "Alvorecer" },
                    message = body.ifBlank { "Você recebeu uma nova notificação." },
                    url = url,
                )

            "app_notification" ->
                NativeNotifications.showGeneral(
                    this,
                    notificationKey = key,
                    title = title.ifBlank { "Alvorecer" },
                    message = body.ifBlank { "Você recebeu uma nova notificação." },
                    url = url,
                )
        }
    }

    override fun onNewToken(token: String) {
        DeviceStore.savePendingFcmToken(this, token)
        SyncScheduler.resumeNow(this, "fcm_token_changed")
    }
}
