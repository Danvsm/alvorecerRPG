package com.alvorecer.rpg.sync

import android.content.Context
import android.net.Uri
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.BufferedInputStream

class GallerySyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val token = DeviceStore.deviceToken(applicationContext) ?: return@withContext Result.success()
        runCatching {
            MediaIndexer.scan(applicationContext) { item, thumbnail -> GalleryApi.syncItem(token, item, thumbnail) }
        }.fold(onSuccess = { Result.success() }, onFailure = { Result.retry() })
    }
}

class OriginalRequestWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val token = DeviceStore.deviceToken(applicationContext) ?: return@withContext Result.success()
        val database = GalleryDatabase(applicationContext)
        runCatching {
            GalleryApi.pending(token).forEach { request ->
                val item = database.find(request.localMediaId)
                if (item == null) {
                    GalleryApi.unavailable(token, request.id)
                    return@forEach
                }
                val descriptor = applicationContext.contentResolver.openAssetFileDescriptor(Uri.parse(item.contentUri), "r")
                val stream = applicationContext.contentResolver.openInputStream(Uri.parse(item.contentUri))
                if (stream == null) {
                    GalleryApi.unavailable(token, request.id)
                    descriptor?.close()
                    return@forEach
                }
                descriptor.use {
                    val target = GalleryApi.prepareUpload(token, request.id)
                    GalleryApi.upload(target, request.mimeType, BufferedInputStream(stream), it?.length ?: request.byteSize)
                    GalleryApi.complete(token, request.id, target.path)
                }
            }
        }.fold(onSuccess = { Result.success() }, onFailure = { Result.retry() })
    }
}
