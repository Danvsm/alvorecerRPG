package com.alvorecer.rpg

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import com.alvorecer.rpg.sync.SyncScheduler

class AlvorecerApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        SyncScheduler.schedulePeriodic(this)
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(NotificationManager::class.java)
        val channel = NotificationChannel(
            "alvorecer_general",
            "Notificações do Alvorecer",
            NotificationManager.IMPORTANCE_DEFAULT,
        ).apply {
            description = "Avisos gerais, mensagens, recompensas e acontecimentos do Alvorecer."
            enableVibration(true)
        }
        manager.createNotificationChannel(channel)
    }
}
