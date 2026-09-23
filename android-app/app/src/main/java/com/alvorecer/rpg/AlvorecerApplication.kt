package com.alvorecer.rpg

import android.app.Application
import com.alvorecer.rpg.sync.NativeNotifications
import com.alvorecer.rpg.sync.SyncScheduler

class AlvorecerApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        NativeNotifications.createChannel(this)
        SyncScheduler.schedulePeriodic(this)
    }
}
