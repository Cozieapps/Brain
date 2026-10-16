package app.beside.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

@Immutable
data class Palette(
    val bg: Color,
    val surface: Color,
    val sidebar: Color,
    val text: Color,
    val muted: Color,
    val border: Color,
    val borderStrong: Color,
    val accent: Color,
    val onAccent: Color,
    val accentSoft: Color,
    val accentText: Color,
    val user: Color,
    val ok: Color,
    val okSoft: Color,
    val danger: Color,
    val dangerSoft: Color,
)

val LightPalette = Palette(
    bg = Color(0xFFFAF7F2), surface = Color.White, sidebar = Color(0xFFF3EEE7), text = Color(0xFF2B2622),
    muted = Color(0xFF6B625A), border = Color(0xFFE8E0D5), borderStrong = Color(0xFFD8CDBF),
    accent = Color(0xFFB5482D), onAccent = Color.White, accentSoft = Color(0xFFF7E6DC), accentText = Color(0xFF8F3A24),
    user = Color(0xFFEFE8DF), ok = Color(0xFF24693F), okSoft = Color(0xFFE4F2E8),
    danger = Color(0xFFB3261E), dangerSoft = Color(0xFFFBE9E7),
)

val DarkPalette = Palette(
    bg = Color(0xFF1C1A18), surface = Color(0xFF252220), sidebar = Color(0xFF161412), text = Color(0xFFEDE7E0),
    muted = Color(0xFFAAA096), border = Color(0xFF36312C), borderStrong = Color(0xFF4A433C),
    accent = Color(0xFFE07A5F), onAccent = Color(0xFF1C1A18), accentSoft = Color(0xFF3B2721), accentText = Color(0xFFF0A089),
    user = Color(0xFF302B27), ok = Color(0xFF6CC28E), okSoft = Color(0xFF1F3327),
    danger = Color(0xFFF08B80), dangerSoft = Color(0xFF3A211F),
)

val LocalPalette = staticCompositionLocalOf { LightPalette }

object Beside {
    val colors: Palette @Composable get() = LocalPalette.current
}

val Serif = FontFamily.Serif

@Composable
fun BesideTheme(theme: String = "system", textScale: Float = 1f, content: @Composable () -> Unit) {
    val dark = when (theme) {
        "dark" -> true
        "light" -> false
        else -> isSystemInDarkTheme()
    }
    val p = if (dark) DarkPalette else LightPalette
    val scheme = (if (dark) darkColorScheme() else lightColorScheme()).copy(
        primary = p.accent, onPrimary = p.onAccent, background = p.bg, onBackground = p.text,
        surface = p.surface, onSurface = p.text, surfaceVariant = p.user, onSurfaceVariant = p.muted,
        outline = p.border, outlineVariant = p.border, error = p.danger, secondaryContainer = p.accentSoft,
        onSecondaryContainer = p.accentText, surfaceContainer = p.surface, surfaceContainerHigh = p.surface,
        surfaceContainerLow = p.sidebar, surfaceContainerHighest = p.user,
    )
    val base = Typography()
    fun TextStyle.s() = copy(fontSize = fontSize * textScale, lineHeight = lineHeight * textScale)
    val type = Typography(
        displaySmall = TextStyle(fontFamily = Serif, fontWeight = FontWeight.Normal, fontSize = 38.sp, lineHeight = 44.sp).s(),
        headlineSmall = TextStyle(fontFamily = Serif, fontWeight = FontWeight.Normal, fontSize = 24.sp, lineHeight = 30.sp).s(),
        titleLarge = TextStyle(fontFamily = Serif, fontWeight = FontWeight.Medium, fontSize = 22.sp, lineHeight = 28.sp).s(),
        titleMedium = base.titleMedium.copy(fontWeight = FontWeight.SemiBold).s(),
        titleSmall = base.titleSmall.copy(fontWeight = FontWeight.SemiBold).s(),
        bodyLarge = TextStyle(fontSize = 17.sp, lineHeight = 27.sp).s(),
        bodyMedium = TextStyle(fontSize = 15.sp, lineHeight = 22.sp).s(),
        bodySmall = TextStyle(fontSize = 13.sp, lineHeight = 18.sp).s(),
        labelLarge = base.labelLarge.copy(fontWeight = FontWeight.SemiBold).s(),
        labelMedium = base.labelMedium.s(),
        labelSmall = base.labelSmall.copy(fontWeight = FontWeight.SemiBold, letterSpacing = 0.8.sp).s(),
    )
    CompositionLocalProvider(LocalPalette provides p) {
        MaterialTheme(colorScheme = scheme, typography = type, content = content)
    }
}
