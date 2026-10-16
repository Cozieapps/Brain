package app.beside

import android.app.Application
import app.beside.data.Store
import app.beside.system.AppEvent
import app.beside.system.Reminders
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableSharedFlow

class BesideApp : Application() {
    val scope = CoroutineScope(SupervisorJob())
    lateinit var store: Store
        private set
    val events = MutableSharedFlow<AppEvent>(extraBufferCapacity = 8)

    override fun onCreate() {
        super.onCreate()
        store = Store(filesDir, scope)
        Reminders.createChannel(this)
    }
}
