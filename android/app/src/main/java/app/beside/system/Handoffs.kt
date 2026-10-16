package app.beside.system

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.provider.AlarmClock
import android.provider.CalendarContract

/**
 * Opens other apps with things filled in. Beside never sends or saves on its own: she confirms
 * in the other app. Works offline (sending a WhatsApp message itself needs a connection).
 */
class Handoffs(private val context: Context) {
    private fun launch(intent: Intent): Boolean = try {
        context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        true
    } catch (_: ActivityNotFoundException) {
        false
    }

    private fun installed(pkg: String) = runCatching { context.packageManager.getPackageInfo(pkg, 0) }.isSuccess

    fun calendar(title: String, start: Long, end: Long) = launch(
        Intent(Intent.ACTION_INSERT).setData(CalendarContract.Events.CONTENT_URI)
            .putExtra(CalendarContract.Events.TITLE, title)
            .putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, start)
            .putExtra(CalendarContract.EXTRA_EVENT_END_TIME, end),
    )

    /** Returns the name of the app that opened, or null. */
    fun message(text: String, app: String): String? {
        val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text)
        if (app == "whatsapp") {
            for ((pkg, name) in listOf("com.whatsapp" to "WhatsApp", "com.whatsapp.w4b" to "WhatsApp Business"))
                if (installed(pkg) && launch(Intent(send).setPackage(pkg))) return name
        }
        if (app == "sms") {
            val sms = Intent(Intent.ACTION_SENDTO, android.net.Uri.parse("smsto:")).putExtra("sms_body", text)
            if (launch(sms)) return "Messages"
        }
        return if (launch(Intent.createChooser(send, "Send with"))) "the share menu" else null
    }

    fun alarm(hour: Int, minute: Int, label: String) = launch(
        Intent(AlarmClock.ACTION_SET_ALARM)
            .putExtra(AlarmClock.EXTRA_HOUR, hour)
            .putExtra(AlarmClock.EXTRA_MINUTES, minute)
            .putExtra(AlarmClock.EXTRA_MESSAGE, label)
            .putExtra(AlarmClock.EXTRA_SKIP_UI, true),
    )
}
