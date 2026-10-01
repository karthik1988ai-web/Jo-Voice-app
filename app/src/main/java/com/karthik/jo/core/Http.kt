package com.karthik.jo.core

import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import java.util.concurrent.TimeUnit

/** Shared HTTP client for Zoho, Kavery and Thirumal calls. */
object Http {
    val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    fun execute(request: Request): String =
        client.newCall(request).execute().use { resp -> resp.bodyOrThrow() }

    /** Like [execute] but also returns one response header (e.g. Content-Range). */
    fun executeWithHeader(request: Request, header: String): Pair<String, String?> =
        client.newCall(request).execute().use { resp -> resp.bodyOrThrow() to resp.header(header) }

    private fun Response.bodyOrThrow(): String {
        val text = body?.string().orEmpty()
        if (!isSuccessful) throw HttpException(code, text.take(300))
        return text
    }
}

class HttpException(val code: Int, body: String) : Exception("HTTP $code: $body")

/** Keeps tool results small so each Claude call stays cheap. */
fun String.clip(max: Int = 4000): String =
    if (length <= max) this else take(max) + "\n…(trimmed)"
