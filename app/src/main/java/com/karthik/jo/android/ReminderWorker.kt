package com.karthik.jo.android

import android.Manifest
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.karthik.jo.JoApp
import com.karthik.jo.R
import com.karthik.jo.ui.MainActivity
import java.util.concurrent.TimeUnit

/** Shows a notification when a task with a due time comes up. */
class ReminderWorker(context: Context, params: WorkerParameters) : Worker(context, params) {

    override fun doWork(): Result {
        val id = inputData.getString(KEY_ID) ?: return Result.success()
        // Skip if the task was completed or deleted in the meantime.
        val task = Jo.tasks(applicationContext).open().find { it.id == id } ?: return Result.success()
        if (android.os.Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(applicationContext, Manifest.permission.POST_NOTIFICATIONS)
            != PackageManager.PERMISSION_GRANTED
        ) return Result.success()

        val open = PendingIntent.getActivity(
            applicationContext, 2,
            Intent(applicationContext, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = NotificationCompat.Builder(applicationContext, JoApp.CHANNEL_REMINDER)
            .setSmallIcon(R.drawable.ic_jo)
            .setContentTitle("Reminder")
            .setContentText(task.title)
            .setContentIntent(open)
            .setAutoCancel(true)
            .build()
        NotificationManagerCompat.from(applicationContext).notify(id.hashCode(), notification)
        return Result.success()
    }

    companion object {
        private const val KEY_ID = "id"

        fun schedule(context: Context, id: String, title: String, due: Long) {
            val delay = due - System.currentTimeMillis()
            if (delay < 0) return
            val request = OneTimeWorkRequestBuilder<ReminderWorker>()
                .setInitialDelay(delay, TimeUnit.MILLISECONDS)
                .setInputData(workDataOf(KEY_ID to id, "title" to title))
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork("task-$id", ExistingWorkPolicy.REPLACE, request)
        }

        fun cancel(context: Context, id: String) {
            WorkManager.getInstance(context).cancelUniqueWork("task-$id")
        }
    }
}
