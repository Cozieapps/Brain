package app.beside.system

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import app.beside.BesideApp
import app.beside.MainActivity
import app.beside.R
import app.beside.data.Reminder

/** Reminders use exact alarms, so they arrive on time even when Beside is closed. */
object Reminders {
    const val CHANNEL = "reminders"
    private const val EXTRA_ID = "id"
    private const val EXTRA_TEXT = "text"

    fun createChannel(context: Context) {
        val channel = NotificationChannel(CHANNEL, "Reminders and timers", NotificationManager.IMPORTANCE_HIGH)
            .apply { description = "Reminders and focus timers you asked Beside for" }
        context.getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    private fun pending(context: Context, id: String, text: String): PendingIntent {
        val intent = Intent(context, ReminderReceiver::class.java).putExtra(EXTRA_ID, id).putExtra(EXTRA_TEXT, text)
        return PendingIntent.getBroadcast(
            context, id.hashCode(), intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    fun schedule(context: Context, r: Reminder) {
        if (r.fired) return
        val alarms = context.getSystemService(AlarmManager::class.java)
        val pi = pending(context, r.id, r.text)
        val exact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarms.canScheduleExactAlarms()
        if (exact) alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, r.at, pi)
        else alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, r.at, pi)
    }

    fun cancel(context: Context, id: String) {
        context.getSystemService(AlarmManager::class.java).cancel(pending(context, id, ""))
    }

    fun notify(context: Context, id: String, text: String) {
        if (ContextCompat.checkSelfPermission(context, android.Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) return
        val open = PendingIntent.getActivity(
            context, 0, Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE,
        )
        val n = NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("Beside")
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(open)
            .build()
        NotificationManagerCompat.from(context).notify(id.hashCode(), n)
    }

    const val TIMER_ID = "focus-timer"
}

class ReminderReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val id = intent.getStringExtra("id") ?: return
        val text = intent.getStringExtra("text") ?: "Reminder"
        Reminders.notify(context, id, text)
        val app = context.applicationContext as BesideApp
        app.store.update { d -> d.copy(reminders = d.reminders.map { if (it.id == id) it.copy(fired = true) else it }) }
        app.events.tryEmit(AppEvent.ReminderFired(id, text))
    }
}

/** Alarms don't survive a restart; put the pending ones back. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        val app = context.applicationContext as BesideApp
        val now = System.currentTimeMillis()
        for (r in app.store.data.value.reminders) {
            if (r.fired) continue
            if (r.at <= now) Reminders.notify(context, r.id, r.text) else Reminders.schedule(context, r)
        }
    }
}

sealed interface AppEvent {
    data class ReminderFired(val id: String, val text: String) : AppEvent
}
