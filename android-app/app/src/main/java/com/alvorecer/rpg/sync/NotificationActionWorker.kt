package com.alvorecer.rpg.sync

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class NotificationActionWorker(
    context: Context,
    params: WorkerParameters,
) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val registration =
            DeviceStore.registration(applicationContext)
                ?: return@withContext Result.failure()
        val operation = inputData.getString("operation").orEmpty()
        val conversationId = inputData.getString("conversation_id").orEmpty()
        val message = inputData.getString("message").orEmpty()

        if (
            conversationId.isBlank() ||
            (operation != "read" && operation != "reply") ||
            (operation == "reply" && message.isBlank())
        ) {
            return@withContext Result.failure()
        }

        try {
            GalleryApi.notificationAction(
                token = registration.deviceToken,
                operation = operation,
                conversationId = conversationId,
                message = message.takeIf { operation == "reply" },
            )
            Result.success()
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            Result.retry()
        }
    }
}
