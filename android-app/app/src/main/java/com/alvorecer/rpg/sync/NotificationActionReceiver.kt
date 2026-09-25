package com.alvorecer.rpg.sync

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.RemoteInput
import androidx.work.Constraints
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.workDataOf

class NotificationActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val conversationId =
            intent.getStringExtra(NativeNotifications.EXTRA_CONVERSATION_ID)
                ?.takeIf { it.isNotBlank() }
                ?: return
        val operation =
            intent.getStringExtra(NativeNotifications.EXTRA_OPERATION)
                ?.takeIf { it == "read" || it == "reply" }
                ?: return
        val reply =
            if (operation == "reply") {
                RemoteInput.getResultsFromIntent(intent)
                    ?.getCharSequence(NativeNotifications.REMOTE_INPUT_REPLY)
                    ?.toString()
                    ?.trim()
                    .orEmpty()
            } else ""

        if (operation == "reply" && reply.isBlank()) return

        val request =
            OneTimeWorkRequestBuilder<NotificationActionWorker>()
                .setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .build(),
                )
                .setInputData(
                    workDataOf(
                        "operation" to operation,
                        "conversation_id" to conversationId,
                        "message" to reply,
                    ),
                )
                .build()

        WorkManager.getInstance(context).enqueue(request)
        NativeNotifications.cancelConversation(context, conversationId)
    }
}
