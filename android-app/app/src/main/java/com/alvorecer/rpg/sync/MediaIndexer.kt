package com.alvorecer.rpg.sync

import android.content.ContentUris
import android.content.Context
import android.graphics.Bitmap
import android.os.Build
import android.provider.MediaStore
import android.util.Base64
import android.util.Size
import java.io.ByteArrayOutputStream

object MediaIndexer {
    fun scan(context: Context, deviceId: String, onItem: (IndexedMedia, String) -> Unit) {
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

            scanCollection(context, database, imageCollection, false, onItem)
            scanCollection(context, database, videoCollection, true, onItem)
        }
    }

    private fun scanCollection(context: Context, database: GalleryDatabase, collection: android.net.Uri, video: Boolean, onItem: (IndexedMedia, String) -> Unit) {
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
                val thumbnail = createThumbnail(context, uri, video) ?: continue
                val output = ByteArrayOutputStream()
                val format = if (Build.VERSION.SDK_INT >= 30) {
                    Bitmap.CompressFormat.WEBP_LOSSY
                } else {
                    @Suppress("DEPRECATION")
                    Bitmap.CompressFormat.WEBP
                }
                thumbnail.compress(format, 68, output)
                thumbnail.recycle()
                onItem(item, Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP))
                database.upsert(item, true)
            }
        }
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
