package com.alvorecer.rpg.sync

import android.Manifest
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.alvorecer.rpg.MainActivity
import com.alvorecer.rpg.R
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class GalleryMessagingService : FirebaseMessagingService() {
    override fun onMessageReceived(message: RemoteMessage) {
        when (message.data["kind"]) {
            "gallery_original_requested" ->
                SyncScheduler.resumeNow(this, "fcm_request")
            "app_notification" ->
                showGeneralNotification(message)
        }
    }

    private fun showGeneralNotification(message: RemoteMessage) {
        if (
            Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) !=
                PackageManager.PERMISSION_GRANTED
        ) {
            return
        }

        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra("open_notifications", true)
        }
        val pendingIntent = PendingIntent.getActivity(
            this,
            1001,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val notification = NotificationCompat.Builder(this, "alvorecer_general")
            .setSmallIcon(R.drawable.ic_stat_alvorecer)
            .setContentTitle("Alvorecer")
            .setContentText("Você recebeu uma nova notificação.")
            .setStyle(
                NotificationCompat.BigTextStyle()
                    .bigText("Você recebeu uma nova notificação. Abra o Alvorecer para conferir."),
            )
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .build()

        val notificationId =
            message.data["notification_id"]?.hashCode()
                ?: (System.currentTimeMillis() and 0x7fffffff).toInt()
        NotificationManagerCompat.from(this).notify(notificationId, notification)
    }

    override fun onNewToken(token: String) {
        DeviceStore.savePendingFcmToken(this, token)
        SyncScheduler.resumeNow(this, "fcm_token_changed")
    }
}
