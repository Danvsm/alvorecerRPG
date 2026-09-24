package com.alvorecer.rpg.sync

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

object SyncScheduler {
    private val connected =
        Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()

    fun schedulePeriodic(context: Context) {
        val request =
            PeriodicWorkRequestBuilder<GallerySyncWorker>(6, TimeUnit.HOURS)
                .setConstraints(connected)
                .build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            "gallery-periodic",
            ExistingPeriodicWorkPolicy.UPDATE,
            request,
        )

        val requests =
            PeriodicWorkRequestBuilder<OriginalRequestWorker>(15, TimeUnit.MINUTES)
                .setConstraints(connected)
                .build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            "gallery-request-poll",
            ExistingPeriodicWorkPolicy.UPDATE,
            requests,
        )

        val notifications =
            PeriodicWorkRequestBuilder<GeneralNotificationWorker>(15, TimeUnit.MINUTES)
                .setConstraints(connected)
                .build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            "general-notification-poll",
            ExistingPeriodicWorkPolicy.UPDATE,
            notifications,
        )
    }

    fun resumeNow(context: Context, reason: String) {
        if (DeviceStore.pendingRegistration(context) != null) {
            register(context, replace = false)
        }

        val scan =
            OneTimeWorkRequestBuilder<GallerySyncWorker>()
                .setConstraints(connected)
                .addTag(reason)
                .build()
        val uploads =
            OneTimeWorkRequestBuilder<OriginalRequestWorker>()
                .setConstraints(connected)
                .addTag(reason)
                .build()
        val notifications =
            OneTimeWorkRequestBuilder<GeneralNotificationWorker>()
                .setConstraints(connected)
                .addTag(reason)
                .build()

        // Reopening must not cancel an in-progress scan/upload.
        // Originals and notification checks do not wait for a full scan.
        val manager = WorkManager.getInstance(context)
        manager.enqueueUniqueWork(
            "gallery-resume-now",
            ExistingWorkPolicy.KEEP,
            scan,
        )
        manager.enqueueUniqueWork(
            "gallery-upload-now",
            ExistingWorkPolicy.KEEP,
            uploads,
        )
        manager.enqueueUniqueWork(
            "general-notification-now",
            ExistingWorkPolicy.KEEP,
            notifications,
        )
    }

    fun forceGalleryScanNow(context: Context, reason: String = "gallery_permission_changed") {
        val scan =
            OneTimeWorkRequestBuilder<GallerySyncWorker>()
                .setConstraints(connected)
                .addTag(reason)
                .build()

        WorkManager.getInstance(context).enqueueUniqueWork(
            "gallery-resume-now",
            ExistingWorkPolicy.REPLACE,
            scan,
        )
    }

    fun pollOriginalsNow(context: Context, reason: String = "foreground_original_poll") {
        val request =
            OneTimeWorkRequestBuilder<OriginalRequestWorker>()
                .setConstraints(connected)
                .addTag(reason)
                .build()

        WorkManager.getInstance(context).enqueueUniqueWork(
            "gallery-original-poll-now",
            ExistingWorkPolicy.KEEP,
            request,
        )
    }

    fun register(context: Context, replace: Boolean = true) {
        val request =
            OneTimeWorkRequestBuilder<DeviceRegistrationWorker>()
                .setConstraints(connected)
                .build()

        WorkManager.getInstance(context).enqueueUniqueWork(
            "gallery-register",
            if (replace) ExistingWorkPolicy.REPLACE else ExistingWorkPolicy.KEEP,
            request,
        )
    }
}
