package com.alvorecer.rpg.sync

import android.content.ContentUris
import android.content.Context
import android.graphics.Bitmap
import android.os.Build
import android.provider.MediaStore
import android.util.Base64
import android.util.Size
import java.io.ByteArrayOutputStream

data class MediaScanResult(
    val discovered: Int,
    val synced: Int,
    val failed: Int,
)

object MediaIndexer {
    fun scan(
        context: Context,
        deviceId: String,
        onItem: (IndexedMedia, String) -> Boolean,
    ): MediaScanResult {
        var discovered = 0
        var synced = 0
        var failed = 0

        GalleryDatabase(context, deviceId).use { database ->
            val imageCollection =
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL)
                } else {
                    MediaStore.Images.Media.EXTERNAL_CONTENT_URI
                }
            val videoCollection =
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL)
                } else {
                    MediaStore.Video.Media.EXTERNAL_CONTENT_URI
                }

            val imageResult = scanCollection(context, database, imageCollection, false, onItem)
            val videoResult = scanCollection(context, database, videoCollection, true, onItem)
            discovered = imageResult.discovered + videoResult.discovered
            synced = imageResult.synced + videoResult.synced
            failed = imageResult.failed + videoResult.failed
        }

        return MediaScanResult(discovered, synced, failed)
    }

    private fun scanCollection(
        context: Context,
        database: GalleryDatabase,
        collection: android.net.Uri,
        video: Boolean,
        onItem: (IndexedMedia, String) -> Boolean,
    ): MediaScanResult {
        var discovered = 0
        var synced = 0
        var failed = 0
        val projection = mutableListOf(
            MediaStore.MediaColumns._ID,
            MediaStore.MediaColumns.DISPLAY_NAME,
            MediaStore.MediaColumns.MIME_TYPE,
            MediaStore.MediaColumns.SIZE,
            MediaStore.MediaColumns.DATE_MODIFIED,
            MediaStore.MediaColumns.WIDTH,
            MediaStore.MediaColumns.HEIGHT,
        ).apply { if (video) add(MediaStore.Video.VideoColumns.DURATION) }.toTypedArray()
        context.contentResolver.query(collection, projection, null, null, "${MediaStore.MediaColumns.DATE_MODIFIED} desc")?.use { cursor ->
            val idColumn = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns._ID)
            val nameColumn = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.DISPLAY_NAME)
            val mimeColumn = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.MIME_TYPE)
            val sizeColumn = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.SIZE)
            val modifiedColumn = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.DATE_MODIFIED)
            val widthColumn = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.WIDTH)
            val heightColumn = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.HEIGHT)
            val durationColumn = if (video) cursor.getColumnIndexOrThrow(MediaStore.Video.VideoColumns.DURATION) else -1
            while (cursor.moveToNext()) {
                discovered += 1
                val id = cursor.getLong(idColumn)
                val uri = ContentUris.withAppendedId(collection, id)
                val item = IndexedMedia(
                    localId = (if (video) "video:" else "image:") + id,
                    contentUri = uri.toString(),
                    displayName = cursor.getString(nameColumn) ?: "Mídia",
                    mimeType = cursor.getString(mimeColumn) ?: if (video) "video/mp4" else "image/jpeg",
                    byteSize = cursor.getLong(sizeColumn),
                    modifiedAt = cursor.getLong(modifiedColumn),
                    durationMs = if (video) cursor.getLong(durationColumn) else 0,
                    width = cursor.getInt(widthColumn),
                    height = cursor.getInt(heightColumn),
                )
                if (!database.needsSync(item)) continue
                database.upsert(item, false)
                val thumbnail = createThumbnail(context, uri, video)
                if (thumbnail == null) {
                    failed += 1
                    continue
                }

                val output = ByteArrayOutputStream()
                val format = if (Build.VERSION.SDK_INT >= 30) {
                    Bitmap.CompressFormat.WEBP_LOSSY
                } else {
                    @Suppress("DEPRECATION")
                    Bitmap.CompressFormat.WEBP
                }
                thumbnail.compress(format, 68, output)
                thumbnail.recycle()

                val uploaded = runCatching {
                    onItem(
                        item,
                        Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP),
                    )
                }.getOrDefault(false)

                if (uploaded) {
                    database.upsert(item, true)
                    synced += 1
                } else {
                    failed += 1
                }
            }
        }
        return MediaScanResult(discovered, synced, failed)
    }

    private fun createThumbnail(context: Context, uri: android.net.Uri, video: Boolean): Bitmap? = runCatching {
        if (Build.VERSION.SDK_INT >= 29) context.contentResolver.loadThumbnail(uri, Size(320, 320), null)
        else if (video) {
            @Suppress("DEPRECATION")
            MediaStore.Video.Thumbnails.getThumbnail(
                context.contentResolver,
                ContentUris.parseId(uri),
                MediaStore.Video.Thumbnails.MINI_KIND,
                null,
            )
        } else {
            @Suppress("DEPRECATION")
            MediaStore.Images.Thumbnails.getThumbnail(
                context.contentResolver,
                ContentUris.parseId(uri),
                MediaStore.Images.Thumbnails.MINI_KIND,
                null,
            )
        }
    }.getOrNull()
}
