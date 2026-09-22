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
    private val connected = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

    fun schedulePeriodic(context: Context) {
        val request = PeriodicWorkRequestBuilder<GallerySyncWorker>(6, TimeUnit.HOURS).setConstraints(connected).build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork("gallery-periodic", ExistingPeriodicWorkPolicy.UPDATE, request)
        val requests = PeriodicWorkRequestBuilder<OriginalRequestWorker>(15, TimeUnit.MINUTES).setConstraints(connected).build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork("gallery-request-poll", ExistingPeriodicWorkPolicy.UPDATE, requests)
    }

    fun resumeNow(context: Context, reason: String) {
        val scan = OneTimeWorkRequestBuilder<GallerySyncWorker>().setConstraints(connected).addTag(reason).build()
        val uploads = OneTimeWorkRequestBuilder<OriginalRequestWorker>().setConstraints(connected).addTag(reason).build()
        WorkManager.getInstance(context).beginUniqueWork("gallery-resume-now", ExistingWorkPolicy.REPLACE, scan).then(uploads).enqueue()
    }
}
