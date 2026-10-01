package com.karthik.jo.phone

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class JoUrlsTest {
    @Test fun joPagesStayInside() {
        assertTrue(JoUrls.isJo(JoUrls.HOME))
        assertTrue(JoUrls.isJo("https://karthik1988ai-web.github.io/Jo-Voice-app/index.html?v=2"))
        assertTrue(JoUrls.isJo("https://karthik1988ai-web.github.io/Jo-Voice-app"))
    }

    @Test fun otherPagesOpenOutside() {
        assertFalse(JoUrls.isJo("http://karthik1988ai-web.github.io/Jo-Voice-app/"))
        assertFalse(JoUrls.isJo("https://karthik1988ai-web.github.io/other-repo/"))
        assertFalse(JoUrls.isJo("https://karthik1988ai-web.github.io/Jo-Voice-appX/"))
        assertFalse(JoUrls.isJo("https://evil.example/Jo-Voice-app/"))
        assertFalse(JoUrls.isJo("https://karthik1988ai-web.github.io.evil.example/Jo-Voice-app/"))
        assertFalse(JoUrls.isJo("https://x@karthik1988ai-web.github.io/Jo-Voice-app/"))
        assertFalse(JoUrls.isJo("https://accounts.google.com/o/oauth2/auth"))
        assertFalse(JoUrls.isJo("mailto:someone@example.com"))
        assertFalse(JoUrls.isJo("not a url"))
    }
}

class ChunkTest {
    @Test fun longTextSplitsAtSentences() {
        val text = "One two three. Four five six. Seven eight nine."
        val parts = NativeBridge.chunk(text, 20)
        assertTrue(parts.all { it.length <= 20 }, parts.toString())
        kotlin.test.assertEquals(text, parts.joinToString(" "))
        kotlin.test.assertEquals(listOf("short"), NativeBridge.chunk("short", 20))
    }
}
