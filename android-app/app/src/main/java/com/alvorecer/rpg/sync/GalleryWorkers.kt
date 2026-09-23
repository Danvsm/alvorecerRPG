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
            MediaIndexer.scan(applicationContext, registration.deviceId) { item, thumbnail -> GalleryApi.syncItem(token, item, thumbnail) }
        }.fold(onSuccess = { Result.success() }, onFailure = { Result.retry() })
    }
}

object OriginalRequestProcessor {
    private val running = AtomicBoolean(false)

    fun process(context: Context): Boolean {
        if (!running.compareAndSet(false, true)) return true
        try {
            val registration = DeviceStore.registration(context) ?: return true
            val token = registration.deviceToken
            GalleryDatabase(context, registration.deviceId).use { database ->
                DeviceStore.pendingFcmToken(context)?.let { fcmToken ->
                    GalleryApi.updateFcm(token, fcmToken)
                    DeviceStore.clearPendingFcmToken(context)
                }
                GalleryApi.pending(token).forEach { request ->
                    // A server item can outlive the local index (app upgrade or interrupted scan).
                    val saved = database.find(request.localMediaId)
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
                        GalleryApi.unavailable(token, request.id)
                        return@forEach
                    }
                    try {
                        context.contentResolver.openAssetFileDescriptor(uri, "r").use { descriptor ->
                            context.contentResolver.openInputStream(uri).use { stream ->
                                if (stream == null) {
                                    GalleryApi.unavailable(token, request.id)
                                } else {
                                    val target = GalleryApi.prepareUpload(token, request.id)
                                    GalleryApi.upload(
                                        target,
                                        request.mimeType,
                                        BufferedInputStream(stream),
                                        descriptor?.length ?: request.byteSize,
                                    )
                                    GalleryApi.complete(token, request.id, target.path)
                                }
                            }
                        }
                    } catch (_: java.io.FileNotFoundException) {
                        GalleryApi.unavailable(token, request.id)
                    }
                }
            }
            return true
        } catch (_: Exception) {
            return false
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
