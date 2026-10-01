package com.karthik.jo.android

import android.Manifest
import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.content.pm.PackageManager
import android.provider.CalendarContract
import androidx.core.content.ContextCompat
import com.karthik.jo.core.CalendarAccess
import java.util.TimeZone

/** Reads and adds events in the phone's calendars (which sync with Google Calendar). */
class CalendarRepo(private val context: Context) : CalendarAccess {

    fun hasPermission(): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.READ_CALENDAR) == PackageManager.PERMISSION_GRANTED

    override fun events(from: Long, to: Long): List<CalendarAccess.Event> {
        if (!hasPermission()) throw SecurityException("READ_CALENDAR not granted")
        val uri = CalendarContract.Instances.CONTENT_URI.buildUpon().also {
            ContentUris.appendId(it, from)
            ContentUris.appendId(it, to)
        }.build()
        val projection = arrayOf(
            CalendarContract.Instances.TITLE,
            CalendarContract.Instances.BEGIN,
            CalendarContract.Instances.END,
            CalendarContract.Instances.ALL_DAY,
            CalendarContract.Instances.EVENT_LOCATION,
        )
        val events = mutableListOf<CalendarAccess.Event>()
        context.contentResolver.query(
            uri, projection,
            "${CalendarContract.Instances.VISIBLE} = 1",
            null, "${CalendarContract.Instances.BEGIN} ASC",
        )?.use { c ->
            while (c.moveToNext()) {
                events += CalendarAccess.Event(
                    title = c.getString(0) ?: "(no title)",
                    start = c.getLong(1),
                    end = c.getLong(2),
                    allDay = c.getInt(3) == 1,
                    location = c.getString(4).orEmpty(),
                )
            }
        }
        return events
    }

    override fun add(title: String, start: Long, end: Long, location: String?): Boolean {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.WRITE_CALENDAR) != PackageManager.PERMISSION_GRANTED) {
            throw SecurityException("WRITE_CALENDAR not granted")
        }
        val calendarId = writableCalendarId() ?: return false
        val values = ContentValues().apply {
            put(CalendarContract.Events.CALENDAR_ID, calendarId)
            put(CalendarContract.Events.TITLE, title)
            put(CalendarContract.Events.DTSTART, start)
            put(CalendarContract.Events.DTEND, end)
            put(CalendarContract.Events.EVENT_TIMEZONE, TimeZone.getDefault().id)
            location?.let { put(CalendarContract.Events.EVENT_LOCATION, it) }
        }
        return context.contentResolver.insert(CalendarContract.Events.CONTENT_URI, values) != null
    }

    /** The primary visible calendar Jo may write to, else the first writable one. */
    private fun writableCalendarId(): Long? {
        val projection = arrayOf(CalendarContract.Calendars._ID, CalendarContract.Calendars.IS_PRIMARY)
        val selection = "${CalendarContract.Calendars.VISIBLE} = 1 AND " +
            "${CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL} >= ${CalendarContract.Calendars.CAL_ACCESS_CONTRIBUTOR}"
        var fallback: Long? = null
        context.contentResolver.query(CalendarContract.Calendars.CONTENT_URI, projection, selection, null, null)?.use { c ->
            while (c.moveToNext()) {
                if (c.getInt(1) == 1) return c.getLong(0)
                if (fallback == null) fallback = c.getLong(0)
            }
        }
        return fallback
    }
}
