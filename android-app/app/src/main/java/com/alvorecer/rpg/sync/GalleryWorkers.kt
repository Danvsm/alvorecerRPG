package com.alvorecer.rpg.sync

import android.content.Context
import android.net.Uri
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.BufferedInputStream
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.CancellationException

class DeviceRegistrationWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val pending = DeviceStore.pendingRegistration(applicationContext) ?: return@withContext Result.success()
        val expires = runCatching {
            val claims = String(android.util.Base64.decode(pending.accessToken.split(".")[1], android.util.Base64.URL_SAFE))
            org.json.JSONObject(claims).getLong("exp")
        }.getOrDefault(0L)
        if (expires <= System.currentTimeMillis() / 1000) {
            return@withContext Result.failure() // The web session supplies a refreshed token on resume.
        }
        try {
            val registration = GalleryApi.registerDevice(pending.campaignId, pending.accessToken,
                DeviceStore.installationId(applicationContext), pending.deviceName, DeviceStore.pendingFcmToken(applicationContext))
            if (DeviceStore.saveRegistration(applicationContext, registration, pending))
                SyncScheduler.resumeNow(applicationContext, "device_registered")
            Result.success()
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            Result.retry()
        }
    }
}

class GallerySyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val registration = DeviceStore.registration(applicationContext) ?: return@withContext Result.success()
        val token = registration.deviceToken
        runCatching {
            MediaIndexer.scan(applicationContext, registration.deviceId) { item, thumbnail ->
                runCatching {
                    GalleryApi.syncItem(token, item, thumbnail)
                    true
                }.getOrDefault(false)
            }
        }.fold(
            onSuccess = { scan ->
                if (scan.failed > 0) Result.retry() else Result.success()
            },
            onFailure = { Result.retry() },
        )
    }
}

object OriginalRequestProcessor {
    private val running = AtomicBoolean(false)

    private fun reportUnavailable(token: String, requestId: String): Boolean =
        runCatching {
            GalleryApi.unavailable(token, requestId)
            true
        }.getOrDefault(false)

    private fun reportFailure(token: String, requestId: String, code: String): Boolean =
        runCatching {
            GalleryApi.fail(token, requestId, code)
            true
        }.getOrDefault(false)

    fun process(context: Context): Boolean {
        if (!running.compareAndSet(false, true)) return true
        try {
            val registration = DeviceStore.registration(context) ?: return true
            val token = registration.deviceToken

            DeviceStore.pendingFcmToken(context)?.let { fcmToken ->
                runCatching {
                    GalleryApi.updateFcm(token, fcmToken)
                    DeviceStore.clearPendingFcmToken(context)
                }
            }

            val requests = try {
                GalleryApi.pending(token)
            } catch (_: Exception) {
                return false
            }

            var allHandled = true
            GalleryDatabase(context, registration.deviceId).use { database ->
                requests.forEach { request ->
                    // One unreadable photo must never block every other request in the queue.
                    val saved = runCatching { database.find(request.localMediaId) }.getOrNull()
                    val collection = when (request.localMediaId.substringBefore(":")) {
                        "image" -> android.provider.MediaStore.Images.Media.EXTERNAL_CONTENT_URI
                        "video" -> android.provider.MediaStore.Video.Media.EXTERNAL_CONTENT_URI
                        else -> null
                    }
                    val localId = request.localMediaId.substringAfter(":", "").toLongOrNull()
                    val uri = saved?.let { Uri.parse(it.contentUri) }
                        ?: if (collection != null && localId != null) {
                            android.content.ContentUris.withAppendedId(collection, localId)
                        } else {
                            null
                        }

                    if (uri == null) {
                        if (!reportUnavailable(token, request.id)) allHandled = false
                        return@forEach
                    }

                    // Claim the request before touching the local file. The master can now see
                    // that the phone received it instead of seeing "Solicitado" forever.
                    val target = try {
                        GalleryApi.prepareUpload(token, request.id)
                    } catch (_: Exception) {
                        // Cancellation or a transient server failure can race with this call.
                        allHandled = false
                        return@forEach
                    }

                    try {
                        context.contentResolver.openAssetFileDescriptor(uri, "r").use { descriptor ->
                            context.contentResolver.openInputStream(uri).use { stream ->
                                if (stream == null) {
                                    if (!reportUnavailable(token, request.id)) allHandled = false
                                    return@use
                                }
                                GalleryApi.upload(
                                    target,
                                    request.mimeType,
                                    BufferedInputStream(stream),
                                    descriptor?.length ?: request.byteSize,
                                )
                                GalleryApi.complete(token, request.id, target.path)
                            }
                        }
                    } catch (_: java.io.FileNotFoundException) {
                        if (!reportUnavailable(token, request.id)) allHandled = false
                    } catch (_: SecurityException) {
                        if (!reportFailure(token, request.id, "permission_denied")) allHandled = false
                    } catch (_: java.io.IOException) {
                        if (!reportFailure(token, request.id, "upload_failed")) allHandled = false
                    } catch (_: Exception) {
                        if (!reportFailure(token, request.id, "processing_failed")) allHandled = false
                    }
                }
            }
            return allHandled
        } finally {
            running.set(false)
        }
    }
}

class OriginalRequestWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        if (OriginalRequestProcessor.process(applicationContext)) Result.success() else Result.retry()
    }
}


class GeneralNotificationWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val registration =
            DeviceStore.registration(applicationContext)
                ?: return@withContext Result.success()

        val lastId = DeviceStore.lastNotificationId(applicationContext)

        try {
            val poll = GalleryApi.notificationPoll(registration.deviceToken, lastId)

            if (poll.latestId > lastId) {
                DeviceStore.saveLastNotificationId(applicationContext, poll.latestId)
            }

            if (lastId > 0L && poll.newCount > 0) {
                val isSingleMention =
                    poll.newCount == 1 && poll.latestKind == "mention"
                NativeNotifications.showGeneral(
                    applicationContext,
                    count = poll.newCount,
                    notificationKey = "notification-" + poll.latestId,
                    title =
                        if (isSingleMention) "Nova menção no Alvorecer"
                        else "Alvorecer",
                    message =
                        if (isSingleMention)
                            "Você recebeu uma nova menção na Comunidade."
                        else null,
                )
            }

            Result.success()
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            Result.retry()
        }
    }
}
