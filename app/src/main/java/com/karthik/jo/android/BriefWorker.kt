package com.karthik.jo.android

import android.Manifest
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.karthik.jo.JoApp
import com.karthik.jo.R
import com.karthik.jo.ui.MainActivity
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.Calendar
import java.util.concurrent.TimeUnit

/** Writes the morning brief in the background and posts a notification. */
class BriefWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val prefs = Prefs(applicationContext)
        val agent = Jo.agent(applicationContext, prefs) ?: run {
            notify("Jo needs setup", "Add your Gemini API key in Settings to get the morning brief.")
            return Result.success()
        }
        return try {
            val brief = withContext(Dispatchers.IO) { agent.morningBrief() }
            prefs.lastBrief = brief
            prefs.lastBriefTime = System.currentTimeMillis()
            notify("Your morning brief is ready", brief)
            Result.success()
        } catch (e: Exception) {
            if (runAttemptCount < 2) Result.retry()
            else { notify("Morning brief failed", e.message ?: "Unknown error"); Result.success() }
        }
    }

    private fun notify(title: String, text: String) {
        if (ContextCompat.checkSelfPermission(applicationContext, Manifest.permission.POST_NOTIFICATIONS)
            != PackageManager.PERMISSION_GRANTED && android.os.Build.VERSION.SDK_INT >= 33
        ) return
        val open = PendingIntent.getActivity(
            applicationContext, 1,
            Intent(applicationContext, MainActivity::class.java)
                .putExtra(MainActivity.EXTRA_PLAY_BRIEF, true)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = NotificationCompat.Builder(applicationContext, JoApp.CHANNEL_BRIEF)
            .setSmallIcon(R.drawable.ic_jo)
            .setContentTitle(title)
            .setContentText("Tap to listen")
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setContentIntent(open)
            .setAutoCancel(true)
            .build()
        NotificationManagerCompat.from(applicationContext).notify(BRIEF_NOTIFICATION_ID, notification)
    }

    private companion object {
        const val BRIEF_NOTIFICATION_ID = 1
    }
}

object BriefScheduler {
    private const val WORK_NAME = "morning-brief"

    /**
     * Runs the brief every 24 hours, starting at the configured time.
     * [reschedule] = false (app start) keeps an existing schedule, so a brief that is
     * about to run is never cancelled; true (settings saved) applies a new time.
     */
    fun schedule(context: Context, prefs: Prefs, reschedule: Boolean = false) {
        val next = Calendar.getInstance().apply {
            set(Calendar.HOUR_OF_DAY, prefs.briefHour)
            set(Calendar.MINUTE, prefs.briefMinute)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
            if (timeInMillis <= System.currentTimeMillis() + 60_000) add(Calendar.DAY_OF_YEAR, 1)
        }
        val request = PeriodicWorkRequestBuilder<BriefWorker>(24, TimeUnit.HOURS)
            .setInitialDelay(next.timeInMillis - System.currentTimeMillis(), TimeUnit.MILLISECONDS)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            WORK_NAME,
            if (reschedule) ExistingPeriodicWorkPolicy.CANCEL_AND_REENQUEUE else ExistingPeriodicWorkPolicy.KEEP,
            request,
        )
    }

    fun cancel(context: Context) = WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME)
}
