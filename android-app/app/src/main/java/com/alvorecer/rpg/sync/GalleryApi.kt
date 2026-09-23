package com.alvorecer.rpg.sync

import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedInputStream
import java.net.HttpURLConnection
import java.net.URL

data class PendingRequest(val id: String, val localMediaId: String, val mimeType: String, val byteSize: Long)
data class UploadTarget(val url: String, val path: String)

object GalleryApi {
    private val endpoint = "https://wsihnbrnqdnmidjvjchn.supabase.co/functions/v1/alvorecer-api/mobile-gallery"

    fun registerDevice(campaignId: String, accessToken: String, installationId: String, deviceName: String, fcmToken: String?): DeviceRegistration {
        val result = post(
            JSONObject()
                .put("action", "register")
                .put("campaign_id", campaignId)
                .put("installation_id", installationId)
                .put("device_name", deviceName)
                .put("fcm_token", fcmToken ?: JSONObject.NULL),
            bearer = accessToken,
        )
        return DeviceRegistration(result.getString("device_id"), result.getString("device_token"))
    }

    fun syncItem(token: String, item: IndexedMedia, thumbnailBase64: String) {
        post(
            JSONObject()
                .put("action", "sync_item")
                .put("local_media_id", item.localId)
                .put("display_name", item.displayName)
                .put("mime_type", item.mimeType)
                .put("byte_size", item.byteSize)
                .put("modified_at", item.modifiedAt)
                .put("duration_ms", item.durationMs)
                .put("width", item.width)
                .put("height", item.height)
                .put("thumbnail", thumbnailBase64),
            deviceToken = token,
        )
    }

    fun capturePolicy(token: String): Boolean {
        val result = post(JSONObject().put("action", "capture_policy"), deviceToken = token)
        return result.optBoolean("flag_secure_enabled", true)
    }

    fun pending(token: String): List<PendingRequest> {
        val result = post(JSONObject().put("action", "pending"), deviceToken = token)
        val rows = result.optJSONArray("requests") ?: JSONArray()
        return (0 until rows.length()).map { index ->
            rows.getJSONObject(index).let {
                PendingRequest(it.getString("id"), it.getString("local_media_id"), it.getString("mime_type"), it.getLong("byte_size"))
            }
        }
    }

    fun prepareUpload(token: String, requestId: String): UploadTarget {
        val result = post(JSONObject().put("action", "prepare_upload").put("request_id", requestId), deviceToken = token)
        return UploadTarget(result.getString("signed_url"), result.getString("path"))
    }

    fun upload(target: UploadTarget, mimeType: String, stream: BufferedInputStream, length: Long) {
        val connection = URL(target.url).openConnection() as HttpURLConnection
        connection.requestMethod = "PUT"
        connection.doOutput = true
        connection.connectTimeout = 30_000
        connection.readTimeout = 120_000
        connection.setRequestProperty("Content-Type", mimeType)
        connection.setRequestProperty("x-upsert", "true")
        if (length in 1..Int.MAX_VALUE) connection.setFixedLengthStreamingMode(length)
        connection.outputStream.use { output -> stream.use { it.copyTo(output, 256 * 1024) } }
        if (connection.responseCode !in 200..299) throw IllegalStateException("Upload recusado: ${connection.responseCode}")
    }

    fun complete(token: String, requestId: String, path: String) {
        post(JSONObject().put("action", "complete").put("request_id", requestId).put("path", path), deviceToken = token)
    }

    fun unavailable(token: String, requestId: String) {
        post(JSONObject().put("action", "unavailable").put("request_id", requestId), deviceToken = token)
    }

    fun updateFcm(token: String, fcmToken: String) {
        post(JSONObject().put("action", "fcm_token").put("fcm_token", fcmToken), deviceToken = token)
    }

    private fun post(body: JSONObject, bearer: String? = null, deviceToken: String? = null): JSONObject {
        val connection = URL(endpoint).openConnection() as HttpURLConnection
        connection.requestMethod = "POST"
        connection.doOutput = true
        connection.connectTimeout = 20_000
        connection.readTimeout = 45_000
        connection.setRequestProperty("Content-Type", "application/json")
        connection.setRequestProperty("Accept", "application/json")
        if (bearer != null) connection.setRequestProperty("Authorization", "Bearer $bearer")
        if (deviceToken != null) connection.setRequestProperty("X-Device-Token", deviceToken)
        connection.outputStream.use { it.write(body.toString().toByteArray()) }

        val status = connection.responseCode
        val source = if (status in 200..299) connection.inputStream else connection.errorStream
        val text = source?.bufferedReader()?.use { it.readText() }.orEmpty()
        val json = runCatching { JSONObject(text.ifBlank { "{}" }) }.getOrNull()

        if (status !in 200..299) {
            val message = json?.optString("error")?.takeIf { it.isNotBlank() }
                ?: "Falha na galeria (HTTP $status)"
            throw IllegalStateException(message)
        }

        return json ?: throw IllegalStateException("Resposta inválida da galeria")
    }
}
