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
import androidx.core.app.RemoteInput
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat
import com.alvorecer.rpg.MainActivity
import com.alvorecer.rpg.R
import org.json.JSONArray
import org.json.JSONObject

object NativeNotifications {
    const val CHANNEL_MESSAGES = "alvorecer_messages"
    const val CHANNEL_CALLS = "alvorecer_calls"
    const val CHANNEL_SOCIAL = "alvorecer_social"
    const val CHANNEL_WORLD = "alvorecer_world"
    const val CHANNEL_SYSTEM = "alvorecer_system"

    const val ACTION_REPLY = "com.alvorecer.rpg.NOTIFICATION_REPLY"
    const val ACTION_MARK_READ = "com.alvorecer.rpg.NOTIFICATION_MARK_READ"
    const val EXTRA_OPERATION = "operation"
    const val EXTRA_CONVERSATION_ID = "conversation_id"
    const val EXTRA_DEEP_LINK_URL = "deep_link_url"
    const val REMOTE_INPUT_REPLY = "quick_reply"

    private const val HISTORY_PREFS = "alvorecer_notification_history"
    private const val HISTORY_LIMIT = 6

    fun createChannel(context: Context) = createChannels(context)

    fun createChannels(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java)
        val channels = listOf(
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
                CHANNEL_SOCIAL,
                "Comunidade e menções",
                NotificationManager.IMPORTANCE_DEFAULT,
            ).apply {
                description = "Menções e acontecimentos da Comunidade."
                enableVibration(true)
            },
            NotificationChannel(
                CHANNEL_WORLD,
                "Eventos e recompensas",
                NotificationManager.IMPORTANCE_DEFAULT,
            ).apply {
                description = "Eventos, recompensas e acontecimentos da campanha."
                enableVibration(true)
            },
            NotificationChannel(
                CHANNEL_SYSTEM,
                "Sistema",
                NotificationManager.IMPORTANCE_DEFAULT,
            ).apply {
                description = "Avisos gerais do aplicativo Alvorecer."
            },
        )
        channels.forEach(manager::createNotificationChannel)
    }

    fun showPayload(
        context: Context,
        notificationKey: String,
        kind: String,
        title: String,
        message: String,
        referenceId: String = "",
        deepLinkUrl: String = "",
    ) {
        when {
            kind == "call" -> {
                val parsed = parseChatReference(referenceId)
                showCall(
                    context = context,
                    notificationKey = notificationKey,
                    senderName = title.removePrefix("Ligação Arcana de ").ifBlank { title },
                    deepLinkUrl = deepLinkUrl.ifBlank {
                        parsed?.second?.let { "/?chat=$it" } ?: "/"
                    },
                )
            }
            kind == "chat_message" || (kind == "message" && referenceId.startsWith("chat:")) -> {
                val parsed = parseChatReference(referenceId) ?: return showGeneral(
                    context,
                    notificationKey = notificationKey,
                    title = title,
                    message = message,
                    kind = "message",
                    deepLinkUrl = deepLinkUrl,
                )
                showMessage(
                    context = context,
                    notificationKey = notificationKey,
                    conversationId = parsed.first,
                    senderId = parsed.second,
                    senderName = title,
                    message = message,
                    deepLinkUrl = deepLinkUrl.ifBlank { "/?chat=${parsed.second}" },
                )
            }
            kind == "group_message" || (kind == "message" && referenceId.startsWith("group:")) -> {
                val parsed = parseGroupReference(referenceId) ?: return showGeneral(
                    context,
                    notificationKey = notificationKey,
                    title = title,
                    message = message,
                    kind = "message",
                    deepLinkUrl = deepLinkUrl,
                )
                val separator = message.indexOf(": ")
                val senderName =
                    if (separator > 0) message.substring(0, separator)
                    else "Alguém"
                val cleanMessage =
                    if (separator > 0) message.substring(separator + 2)
                    else message
                showGroupMessage(
                    context = context,
                    notificationKey = notificationKey,
                    groupId = parsed.first,
                    senderId = parsed.second,
                    groupName = title,
                    senderName = senderName,
                    message = cleanMessage,
                    deepLinkUrl = deepLinkUrl.ifBlank { "/?group=1" },
                )
            }
            else -> showGeneral(
                context = context,
                notificationKey = notificationKey,
                title = title,
                message = message,
                kind = kind,
                deepLinkUrl = deepLinkUrl,
            )
        }
    }

    fun showMessage(
        context: Context,
        notificationKey: String,
        conversationId: String,
        senderId: String,
        senderName: String,
        message: String,
        deepLinkUrl: String,
    ) {
        if (!canNotify(context)) return
        createChannels(context)

        val sender = Person.Builder()
            .setName(senderName.ifBlank { "Alguém" })
            .setKey(senderId.ifBlank { "sender-$conversationId" })
            .build()
        val me = Person.Builder().setName("Você").setKey("me").build()
        ensureConversationShortcut(
            context,
            conversationId,
            senderName,
            sender,
            deepLinkUrl,
        )

        val history = appendHistory(
            context,
            "chat:$conversationId",
            senderId,
            senderName,
            message,
        )
        val style = NotificationCompat.MessagingStyle(me)
            .setGroupConversation(false)
        history.forEach { item ->
            style.addMessage(
                item.text,
                item.timestamp,
                Person.Builder()
                    .setName(item.senderName)
                    .setKey(item.senderId)
                    .build(),
            )
        }

        val builder = NotificationCompat.Builder(context, CHANNEL_MESSAGES)
            .setSmallIcon(R.drawable.ic_stat_alvorecer)
            .setContentTitle(senderName)
            .setContentText(message)
            .setStyle(style)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setAutoCancel(true)
            .setOnlyAlertOnce(false)
            .setGroup("alvorecer_messages")
            .setShortcutId("chat-$conversationId")
            .setContentIntent(contentIntent(context, deepLinkUrl, conversationId.hashCode()))
            .addAction(replyAction(context, conversationId))
            .addAction(readAction(context, conversationId))

        NotificationManagerCompat.from(context).notify(
            conversationNotificationId(conversationId),
            builder.build(),
        )
    }

    fun showGroupMessage(
        context: Context,
        notificationKey: String,
        groupId: String,
        senderId: String,
        groupName: String,
        senderName: String,
        message: String,
        deepLinkUrl: String,
    ) {
        if (!canNotify(context)) return
        createChannels(context)

        val me = Person.Builder().setName("Você").setKey("me").build()
        val history = appendHistory(
            context,
            "group:$groupId",
            senderId,
            senderName,
            message,
        )
        val style = NotificationCompat.MessagingStyle(me)
            .setConversationTitle(groupName)
            .setGroupConversation(true)
        history.forEach { item ->
            style.addMessage(
                item.text,
                item.timestamp,
                Person.Builder()
                    .setName(item.senderName)
                    .setKey(item.senderId)
                    .build(),
            )
        }

        val notification = NotificationCompat.Builder(context, CHANNEL_MESSAGES)
            .setSmallIcon(R.drawable.ic_stat_alvorecer)
            .setContentTitle(groupName)
            .setContentText("$senderName: $message")
            .setStyle(style)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setAutoCancel(true)
            .setGroup("alvorecer_messages")
            .setContentIntent(contentIntent(context, deepLinkUrl, groupId.hashCode()))
            .build()

        NotificationManagerCompat.from(context).notify(
            ("group-$groupId").hashCode(),
            notification,
        )
    }

    fun showCall(
        context: Context,
        notificationKey: String,
        senderName: String,
        deepLinkUrl: String,
    ) {
        if (!canNotify(context)) return
        createChannels(context)

        val notification = NotificationCompat.Builder(context, CHANNEL_CALLS)
            .setSmallIcon(R.drawable.ic_stat_alvorecer)
            .setContentTitle("Ligação Arcana de $senderName")
            .setContentText("Chamada de voz recebida")
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setAutoCancel(true)
            .setContentIntent(contentIntent(context, deepLinkUrl, notificationKey.hashCode()))
            .addAction(
                R.drawable.ic_stat_alvorecer,
                "Abrir ligação",
                contentIntent(context, deepLinkUrl, notificationKey.hashCode() + 1),
            )
            .build()

        NotificationManagerCompat.from(context).notify(
            notificationKey.ifBlank { "call-$senderName" }.hashCode(),
            notification,
        )
    }

    fun showGeneral(
        context: Context,
        count: Int = 1,
        notificationKey: String = "",
        title: String = "Alvorecer",
        message: String? = null,
        kind: String = "announcement",
        deepLinkUrl: String = "",
    ) {
        if (!canNotify(context)) return
        createChannels(context)

        val body =
            message
                ?: if (count > 1) "Você recebeu $count novas notificações."
                else "Você recebeu uma nova notificação."
        val channel = when (kind) {
            "message", "chat_message", "group_message" -> CHANNEL_MESSAGES
            "call" -> CHANNEL_CALLS
            "mention" -> CHANNEL_SOCIAL
            "event", "reward", "announcement" -> CHANNEL_WORLD
            else -> CHANNEL_SYSTEM
        }
        val target = deepLinkUrl.ifBlank {
            if (kind == "mention") "/?community=1" else "/?notifications=1"
        }

        val notification = NotificationCompat.Builder(context, channel)
            .setSmallIcon(R.drawable.ic_stat_alvorecer)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(
                if (channel == CHANNEL_MESSAGES || channel == CHANNEL_CALLS)
                    NotificationCompat.PRIORITY_HIGH
                else NotificationCompat.PRIORITY_DEFAULT,
            )
            .setAutoCancel(true)
            .setContentIntent(contentIntent(context, target, notificationKey.hashCode()))
            .setCategory(
                if (channel == CHANNEL_MESSAGES) NotificationCompat.CATEGORY_MESSAGE
                else NotificationCompat.CATEGORY_STATUS,
            )
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .build()

        val id =
            notificationKey.takeIf { it.isNotBlank() }?.hashCode()
                ?: (System.currentTimeMillis() and 0x7fffffff).toInt()
        NotificationManagerCompat.from(context).notify(id, notification)
    }

    fun cancelConversation(context: Context, conversationId: String) {
        NotificationManagerCompat.from(context)
            .cancel(conversationNotificationId(conversationId))
        context.getSharedPreferences(HISTORY_PREFS, Context.MODE_PRIVATE)
            .edit()
            .remove("chat:$conversationId")
            .apply()
    }

    private fun canNotify(context: Context): Boolean =
        Build.VERSION.SDK_INT < 33 ||
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) ==
                PackageManager.PERMISSION_GRANTED

    private fun contentIntent(
        context: Context,
        deepLinkUrl: String,
        requestCode: Int,
    ): PendingIntent {
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra(EXTRA_DEEP_LINK_URL, deepLinkUrl.ifBlank { "/" })
        }
        return PendingIntent.getActivity(
            context,
            requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    private fun replyAction(
        context: Context,
        conversationId: String,
    ): NotificationCompat.Action {
        val input = RemoteInput.Builder(REMOTE_INPUT_REPLY)
            .setLabel("Responder")
            .build()
        val intent = Intent(context, NotificationActionReceiver::class.java).apply {
            action = ACTION_REPLY
            putExtra(EXTRA_OPERATION, "reply")
            putExtra(EXTRA_CONVERSATION_ID, conversationId)
        }
        val flags =
            PendingIntent.FLAG_UPDATE_CURRENT or
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S)
                    PendingIntent.FLAG_MUTABLE
                else 0
        val pending = PendingIntent.getBroadcast(
            context,
            ("reply-$conversationId").hashCode(),
            intent,
            flags,
        )
        return NotificationCompat.Action.Builder(
            R.drawable.ic_stat_alvorecer,
            "Responder",
            pending,
        )
            .addRemoteInput(input)
            .setAllowGeneratedReplies(true)
            .build()
    }

    private fun readAction(
        context: Context,
        conversationId: String,
    ): NotificationCompat.Action {
        val intent = Intent(context, NotificationActionReceiver::class.java).apply {
            action = ACTION_MARK_READ
            putExtra(EXTRA_OPERATION, "read")
            putExtra(EXTRA_CONVERSATION_ID, conversationId)
        }
        val pending = PendingIntent.getBroadcast(
            context,
            ("read-$conversationId").hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Action.Builder(
            R.drawable.ic_stat_alvorecer,
            "Marcar como lida",
            pending,
        ).build()
    }

    private fun ensureConversationShortcut(
        context: Context,
        conversationId: String,
        senderName: String,
        sender: Person,
        deepLinkUrl: String,
    ) {
        runCatching {
            val intent = Intent(context, MainActivity::class.java).apply {
                action = Intent.ACTION_VIEW
                putExtra(EXTRA_DEEP_LINK_URL, deepLinkUrl)
            }
            val shortcut = ShortcutInfoCompat.Builder(
                context,
                "chat-$conversationId",
            )
                .setShortLabel(senderName.take(40).ifBlank { "Conversa" })
                .setLongLived(true)
                .setPerson(sender)
                .setIcon(IconCompat.createWithResource(context, R.mipmap.ic_launcher))
                .setIntent(intent)
                .build()
            ShortcutManagerCompat.pushDynamicShortcut(context, shortcut)
        }
    }

    private fun appendHistory(
        context: Context,
        key: String,
        senderId: String,
        senderName: String,
        text: String,
    ): List<HistoryMessage> {
        val prefs = context.getSharedPreferences(HISTORY_PREFS, Context.MODE_PRIVATE)
        val array = runCatching {
            JSONArray(prefs.getString(key, "[]") ?: "[]")
        }.getOrElse { JSONArray() }
        array.put(
            JSONObject()
                .put("sender_id", senderId)
                .put("sender_name", senderName)
                .put("text", text)
                .put("timestamp", System.currentTimeMillis()),
        )
        while (array.length() > HISTORY_LIMIT) array.remove(0)
        prefs.edit().putString(key, array.toString()).apply()

        return (0 until array.length()).mapNotNull { index ->
            runCatching {
                val item = array.getJSONObject(index)
                HistoryMessage(
                    senderId = item.optString("sender_id"),
                    senderName = item.optString("sender_name", "Alguém"),
                    text = item.optString("text"),
                    timestamp = item.optLong("timestamp", System.currentTimeMillis()),
                )
            }.getOrNull()
        }
    }

    private fun parseChatReference(reference: String): Pair<String, String>? {
        val parts = reference.split(":")
        if (parts.size < 3 || parts[0] != "chat") return null
        if (parts[1].isBlank() || parts[2].isBlank()) return null
        return parts[1] to parts[2]
    }

    private fun parseGroupReference(reference: String): Pair<String, String>? {
        val parts = reference.split(":")
        if (parts.size < 3 || parts[0] != "group") return null
        if (parts[1].isBlank() || parts[2].isBlank()) return null
        return parts[1] to parts[2]
    }

    private fun conversationNotificationId(conversationId: String) =
        ("chat-$conversationId").hashCode()

    private data class HistoryMessage(
        val senderId: String,
        val senderName: String,
        val text: String,
        val timestamp: Long,
    )
}
