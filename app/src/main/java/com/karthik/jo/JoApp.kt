package com.karthik.jo

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import com.karthik.jo.android.BriefScheduler
import com.karthik.jo.android.Prefs

class JoApp : Application() {
    override fun onCreate() {
        super.onCreate()
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_BRIEF, "Morning brief", NotificationManager.IMPORTANCE_HIGH)
        )
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_REMINDER, "Task reminders", NotificationManager.IMPORTANCE_HIGH)
        )
        val prefs = Prefs(this)
        if (prefs.briefEnabled) BriefScheduler.schedule(this, prefs)
    }

    companion object {
        const val CHANNEL_BRIEF = "brief"
        const val CHANNEL_REMINDER = "reminders"
    }
}
