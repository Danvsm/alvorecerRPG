package com.alvorecer.rpg.sync

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

data class IndexedMedia(
    val localId: String,
    val contentUri: String,
    val displayName: String,
    val mimeType: String,
    val byteSize: Long,
    val modifiedAt: Long,
    val durationMs: Long,
    val width: Int,
    val height: Int,
)

class GalleryDatabase(context: Context, deviceId: String) : SQLiteOpenHelper(context, "gallery-${java.util.UUID.fromString(deviceId)}.db", null, 1) {
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            """create table media_index(
                local_id text primary key,
                content_uri text not null,
                display_name text not null,
                mime_type text not null,
                byte_size integer not null,
                modified_at integer not null,
                duration_ms integer not null default 0,
                width integer not null default 0,
                height integer not null default 0,
                synced_modified_at integer,
                active integer not null default 1
            )""",
        )
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) = Unit

    fun needsSync(item: IndexedMedia): Boolean {
        readableDatabase.rawQuery(
            "select synced_modified_at from media_index where local_id=?",
            arrayOf(item.localId),
        ).use { cursor ->
            return !cursor.moveToFirst() || cursor.isNull(0) || cursor.getLong(0) != item.modifiedAt
        }
    }

    fun upsert(item: IndexedMedia, synced: Boolean) {
        val values = ContentValues().apply {
            put("local_id", item.localId)
            put("content_uri", item.contentUri)
            put("display_name", item.displayName)
            put("mime_type", item.mimeType)
            put("byte_size", item.byteSize)
            put("modified_at", item.modifiedAt)
            put("duration_ms", item.durationMs)
            put("width", item.width)
            put("height", item.height)
            put("active", 1)
            if (synced) put("synced_modified_at", item.modifiedAt)
        }
        writableDatabase.insertWithOnConflict("media_index", null, values, SQLiteDatabase.CONFLICT_REPLACE)
    }

    fun find(localId: String): IndexedMedia? {
        readableDatabase.rawQuery(
            "select local_id,content_uri,display_name,mime_type,byte_size,modified_at,duration_ms,width,height from media_index where local_id=? and active=1",
            arrayOf(localId),
        ).use { cursor ->
            if (!cursor.moveToFirst()) return null
            return IndexedMedia(
                cursor.getString(0), cursor.getString(1), cursor.getString(2), cursor.getString(3),
                cursor.getLong(4), cursor.getLong(5), cursor.getLong(6), cursor.getInt(7), cursor.getInt(8),
            )
        }
    }
}
