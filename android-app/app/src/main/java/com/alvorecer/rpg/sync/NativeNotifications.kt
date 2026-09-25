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
import androidx.core.app.Person
import com.alvorecer.rpg.MainActivity
import com.alvorecer.rpg.R

object NativeNotifications {
    const val CHANNEL_GENERAL = "alvorecer_general_v2"
    const val CHANNEL_MESSAGES = "alvorecer_messages_v2"
    const val CHANNEL_CALLS = "alvorecer_calls_v2"

    fun createChannels(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java)

        manager.createNotificationChannels(
            listOf(
                NotificationChannel(
                    CHANNEL_MESSAGES,
                    "Mensagens",
                    NotificationManager.IMPORTANCE_HIGH,
                ).apply {
                    description = "Mensagens diretas e conversas do Alvorecer."
                    enableVibration(true)
                },
                NotificationChannel(
                    CHANNEL_CALLS,
                    "Ligações Arcanas",
                    NotificationManager.IMPORTANCE_HIGH,
                ).apply {
                    description = "Chamadas de voz recebidas no Alvorecer."
                    enableVibration(true)
                },
                NotificationChannel(
                    CHANNEL_GENERAL,
                    "Avisos do Alvorecer",
                    NotificationManager.IMPORTANCE_DEFAULT,
                ).apply {
                    description = "Menções, eventos, recompensas e outros avisos."
                    enableVibration(true)
                },
            ),
        )
    }

    private fun notificationsAllowed(context: Context): Boolean =
        Build.VERSION.SDK_INT < 33 ||
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) ==
                PackageManager.PERMISSION_GRANTED

    private fun openIntent(
        context: Context,
        requestCode: Int,
        conversationId: String = "",
        url: String = "/",
    ): PendingIntent {
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra("notification_url", url)
            if (conversationId.isNotBlank()) putExtra("open_chat", conversationId)
        }
        return PendingIntent.getActivity(
            context,
            requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    fun showMessage(
        context: Context,
        notificationKey: String,
        senderName: String,
        message: String,
        conversationId: String,
        url: String,
    ) {
        if (!notificationsAllowed(context)) return
        createChannels(context)

        val safeSender = senderName.ifBlank { "Alguém" }
        val safeMessage = message.ifBlank { "Nova mensagem." }
        val sender = Person.Builder().setName(safeSender).build()
        val style = NotificationCompat.MessagingStyle(
            Person.Builder().setName("Você").build(),
        )
            .setConversationTitle(safeSender)
            .addMessage(safeMessage, System.currentTimeMillis(), sender)

        val notification = NotificationCompat.Builder(context, CHANNEL_MESSAGES)
            .setSmallIcon(R.drawable.ic_stat_alvorecer)
            .setContentTitle(safeSender)
            .setContentText(safeMessage)
            .setStyle(style)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setAutoCancel(true)
            .setOnlyAlertOnce(false)
            .setContentIntent(
                openIntent(
                    context,
                    notificationKey.hashCode(),
                    conversationId,
                    url,
                ),
            )
            .build()

        NotificationManagerCompat.from(context).notify(
            ("message:" + conversationId.ifBlank { notificationKey }).hashCode(),
            notification,
        )
    }

    fun showCall(
        context: Context,
        notificationKey: String,
        senderName: String,
        conversationId: String,
        url: String,
    ) {
        if (!notificationsAllowed(context)) return
        createChannels(context)

        val safeSender = senderName.ifBlank { "Alguém" }
        val notification = NotificationCompat.Builder(context, CHANNEL_CALLS)
            .setSmallIcon(R.drawable.ic_stat_alvorecer)
            .setContentTitle("Ligação Arcana de $safeSender")
            .setContentText("Chamada de voz recebida.")
            .setStyle(
                NotificationCompat.BigTextStyle()
                    .bigText("Chamada de voz recebida. Toque para abrir o Alvorecer."),
            )
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setAutoCancel(true)
            .setContentIntent(
                openIntent(
                    context,
                    notificationKey.hashCode(),
                    conversationId,
                    url,
                ),
            )
            .build()

        NotificationManagerCompat.from(context)
            .notify(("call:" + notificationKey).hashCode(), notification)
    }

    fun showGeneral(
        context: Context,
        notificationKey: String = "",
        title: String = "Alvorecer",
        message: String = "Você recebeu uma nova notificação.",
        url: String = "/",
    ) {
        if (!notificationsAllowed(context)) return
        createChannels(context)

        val notification = NotificationCompat.Builder(context, CHANNEL_GENERAL)
            .setSmallIcon(R.drawable.ic_stat_alvorecer)
            .setContentTitle(title.ifBlank { "Alvorecer" })
            .setContentText(message)
            .setStyle(NotificationCompat.BigTextStyle().bigText(message))
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .setContentIntent(
                openIntent(
                    context,
                    notificationKey.ifBlank { message }.hashCode(),
                    url = url,
                ),
            )
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .build()

        val id =
            notificationKey.takeIf { it.isNotBlank() }?.hashCode()
                ?: (System.currentTimeMillis() and 0x7fffffff).toInt()
        NotificationManagerCompat.from(context).notify(id, notification)
    }
}
