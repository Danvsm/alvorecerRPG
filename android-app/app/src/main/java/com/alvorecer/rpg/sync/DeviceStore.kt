package com.alvorecer.rpg.sync

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.util.UUID

data class DeviceRegistration(val deviceId: String, val deviceToken: String)
data class PendingRegistration(val campaignId: String, val userId: String, val accessToken: String, val deviceName: String)

object DeviceStore {
    private fun prefs(context: Context) = EncryptedSharedPreferences.create(
        context,
        "alvorecer-device",
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    fun installationId(context: Context): String {
        val p = prefs(context)
        return p.getString("installation_id", null) ?: UUID.randomUUID().toString().also {
            p.edit().putString("installation_id", it).apply()
        }
    }

    @Synchronized
    fun saveRegistration(context: Context, registration: DeviceRegistration, pending: PendingRegistration): Boolean {
        if (pendingRegistration(context) != pending) return false
        prefs(context).edit()
            .putString("device_id", registration.deviceId)
            .putString("device_token", registration.deviceToken)
            .putString("campaign_id", pending.campaignId)
            .putString("user_id", pending.userId)
            .remove("registration_pending")
            .remove("last_notification_id")
            .commit()
        return true
    }

    @Synchronized
    fun queueRegistration(context: Context, pending: PendingRegistration): Boolean {
        val p = prefs(context)
        if (isRegistered(context, pending.campaignId, pending.userId)) return false
        if (pendingRegistration(context) == pending) return false
        p.edit().putString("registration_pending", org.json.JSONObject()
            .put("campaign", pending.campaignId).put("user", pending.userId)
            .put("token", pending.accessToken).put("name", pending.deviceName).toString()).commit()
        return true
    }

    fun pendingRegistration(context: Context): PendingRegistration? {
        val raw = prefs(context).getString("registration_pending", null) ?: return null
        return runCatching {
            val row = org.json.JSONObject(raw)
            PendingRegistration(row.getString("campaign"), row.getString("user"), row.getString("token"), row.getString("name"))
        }.getOrNull()
    }

    fun isRegistered(context: Context, campaignId: String, userId: String): Boolean {
        val p = prefs(context)
        return p.getString("campaign_id", null) == campaignId && p.getString("user_id", null) == userId &&
            p.getString("device_token", null) != null && p.getString("registration_pending", null) == null
    }

    @Synchronized
    fun clearPendingRegistration(context: Context, pending: PendingRegistration) {
        if (pendingRegistration(context) == pending) prefs(context).edit().remove("registration_pending").commit()
    }

    @Synchronized
    fun registration(context: Context): DeviceRegistration? {
        if (pendingRegistration(context) != null) return null
        val p = prefs(context)
        return DeviceRegistration(p.getString("device_id", null) ?: return null,
            p.getString("device_token", null) ?: return null)
    }

    fun deviceToken(context: Context) = prefs(context).getString("device_token", null)
    fun deviceId(context: Context) = prefs(context).getString("device_id", null)
    fun campaignId(context: Context) = prefs(context).getString("campaign_id", null)
    fun userId(context: Context) = prefs(context).getString("user_id", null)
    fun savePendingFcmToken(context: Context, token: String) {
        prefs(context).edit().putString("pending_fcm_token", token).apply()
    }
    fun pendingFcmToken(context: Context) = prefs(context).getString("pending_fcm_token", null)
    fun clearPendingFcmToken(context: Context) {
        prefs(context).edit().remove("pending_fcm_token").apply()
    }

    fun lastNotificationId(context: Context): Long =
        prefs(context).getLong("last_notification_id", 0L)

    fun saveLastNotificationId(context: Context, id: Long) {
        prefs(context).edit().putLong("last_notification_id", id).apply()
    }
}
