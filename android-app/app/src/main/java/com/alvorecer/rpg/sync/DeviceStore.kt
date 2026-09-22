package com.alvorecer.rpg.sync

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.util.UUID

data class DeviceRegistration(val deviceId: String, val deviceToken: String)

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

    fun saveRegistration(context: Context, registration: DeviceRegistration, campaignId: String) {
        prefs(context).edit()
            .putString("device_id", registration.deviceId)
            .putString("device_token", registration.deviceToken)
            .putString("campaign_id", campaignId)
            .apply()
    }

    fun deviceToken(context: Context) = prefs(context).getString("device_token", null)
    fun deviceId(context: Context) = prefs(context).getString("device_id", null)
    fun campaignId(context: Context) = prefs(context).getString("campaign_id", null)
    fun savePendingFcmToken(context: Context, token: String) {
        prefs(context).edit().putString("pending_fcm_token", token).apply()
    }
    fun pendingFcmToken(context: Context) = prefs(context).getString("pending_fcm_token", null)
    fun clearPendingFcmToken(context: Context) {
        prefs(context).edit().remove("pending_fcm_token").apply()
    }
}
