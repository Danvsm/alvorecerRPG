package com.alvorecer.rpg.sync

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.alvorecer.rpg.MainActivity
import com.alvorecer.rpg.R

object NativeNotifications {
    const val CHANNEL_ID = "alvorecer_general"

    fun createChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java)
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Notificações do Alvorecer",
            NotificationManager.IMPORTANCE_DEFAULT,
        ).apply {
            description = "Avisos gerais, mensagens, recompensas e acontecimentos do Alvorecer."
            enableVibration(true)
        }
        manager.createNotificationChannel(channel)
    }

    fun showGeneral(context: Context, count: Int = 1, notificationKey: String = "") {
        if (
            Build.VERSION.SDK_INT >= 33 &&
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) !=
                PackageManager.PERMISSION_GRANTED
        ) {
            return
        }

        createChannel(context)

        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra("open_notifications", true)
        }
        val pendingIntent = PendingIntent.getActivity(
            context,
            1001,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val body =
            if (count > 1) "Você recebeu $count novas notificações."
            else "Você recebeu uma nova notificação."

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_alvorecer)
            .setContentTitle("Alvorecer")
            .setContentText(body)
            .setStyle(
                NotificationCompat.BigTextStyle()
                    .bigText("$body Abra o Alvorecer para conferir."),
            )
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .build()

        val id =
            notificationKey.takeIf { it.isNotBlank() }?.hashCode()
                ?: (System.currentTimeMillis() and 0x7fffffff).toInt()
        NotificationManagerCompat.from(context).notify(id, notification)
    }
}
