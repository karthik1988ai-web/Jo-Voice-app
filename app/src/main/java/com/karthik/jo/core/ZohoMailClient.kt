package com.karthik.jo.core

import okhttp3.FormBody
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Read-only Zoho Mail access.
 *
 * Auth uses a Zoho "Self Client": the user generates a one-time grant code in the
 * Zoho API Console, [exchangeGrantCode] swaps it for a long-lived refresh token,
 * and every later call refreshes a short-lived access token from that.
 */
class ZohoMailClient(
    private val region: String,          // "com", "in", "eu", "com.au", "jp"
    private val clientId: String,
    private val clientSecret: String,
    private val refreshToken: String,
    private val accountsBase: String = "https://accounts.zoho.$region",
    private val mailBase: String = "https://mail.zoho.$region/api",
) {

    private var accessToken: String? = null
    private var accessTokenExpiry = 0L
    private var accountId: String? = null

    data class Mail(
        val messageId: String,
        val folderId: String,
        val from: String,
        val subject: String,
        val summary: String,
        val received: Long,
        val unread: Boolean,
    )

    /** Unread inbox mail, newest first. */
    fun unread(limit: Int = 15): List<Mail> =
        listMessages(mapOf("status" to "unread", "limit" to limit.toString()))

    /** Recent mail of any status, newest first. */
    fun recent(limit: Int = 15): List<Mail> =
        listMessages(mapOf("limit" to limit.toString()))

    /**
     * Search mail. Plain words search everywhere; Zoho syntax such as
     * `subject:Britannia` or `sender:x@y.com` is passed through as-is.
     */
    fun search(query: String, limit: Int = 10): List<Mail> {
        val key = if (':' in query) query else "entire:$query"
        val url = "$mailBase/accounts/${account()}/messages/search".toHttpUrl().newBuilder()
            .addQueryParameter("searchKey", key)
            .addQueryParameter("limit", limit.toString())
            .build()
        return parseList(get(url.toString()))
    }

    /** Full text of one message (HTML stripped). */
    fun content(folderId: String, messageId: String): String {
        val body = get("$mailBase/accounts/${account()}/folders/$folderId/messages/$messageId/content")
        val html = JSONObject(body).optJSONObject("data")?.optString("content").orEmpty()
        return html.stripHtml()
    }

    private fun listMessages(params: Map<String, String>): List<Mail> {
        val url = "$mailBase/accounts/${account()}/messages/view".toHttpUrl().newBuilder().apply {
            params.forEach { (k, v) -> addQueryParameter(k, v) }
            addQueryParameter("sortorder", "false")
        }.build()
        return parseList(get(url.toString()))
    }

    private fun parseList(body: String): List<Mail> {
        val data = JSONObject(body).optJSONArray("data") ?: JSONArray()
        return (0 until data.length()).map { i ->
            val m = data.getJSONObject(i)
            Mail(
                messageId = m.optString("messageId"),
                folderId = m.optString("folderId"),
                from = m.optString("sender").ifBlank { m.optString("fromAddress") },
                subject = m.optString("subject"),
                summary = m.optString("summary").take(300),
                received = m.optString("receivedTime").toLongOrNull() ?: 0L,
                // Zoho reports status "0" for unread, "1" for read.
                unread = m.optString("status") == "0",
            )
        }
    }

    private fun account(): String {
        accountId?.let { return it }
        val data = JSONObject(get("$mailBase/accounts")).getJSONArray("data")
        if (data.length() == 0) throw IllegalStateException("No Zoho Mail account found")
        return data.getJSONObject(0).getString("accountId").also { accountId = it }
    }

    private fun get(url: String): String = Http.execute(
        Request.Builder().url(url)
            .header("Authorization", "Zoho-oauthtoken ${token()}")
            .build()
    )

    @Synchronized
    private fun token(): String {
        val now = System.currentTimeMillis()
        accessToken?.takeIf { now < accessTokenExpiry }?.let { return it }
        val json = postToken(
            "refresh_token" to refreshToken,
            "grant_type" to "refresh_token",
        )
        val token = json.optString("access_token")
        if (token.isBlank()) throw IllegalStateException(
            "Zoho login expired (${json.optString("error", "no token")}). Reconnect Zoho Mail in Settings."
        )
        accessToken = token
        accessTokenExpiry = now + (json.optLong("expires_in", 3600) - 120) * 1000
        return token
    }

    private fun postToken(vararg fields: Pair<String, String>): JSONObject =
        postToken(accountsBase, clientId, clientSecret, *fields)

    companion object {
        const val SCOPES = "ZohoMail.accounts.READ,ZohoMail.messages.READ,ZohoMail.folders.READ"

        /** Swaps a Self Client grant code for a refresh token. */
        fun exchangeGrantCode(region: String, clientId: String, clientSecret: String, code: String): String {
            val json = postToken(
                "https://accounts.zoho.$region", clientId, clientSecret,
                "code" to code.trim(),
                "grant_type" to "authorization_code",
            )
            return json.optString("refresh_token").ifBlank {
                throw IllegalStateException(
                    "Zoho said: ${json.optString("error", json.toString().take(200))}. " +
                        "Grant codes expire in a few minutes; generate a fresh one and try again."
                )
            }
        }

        private fun postToken(
            base: String, clientId: String, clientSecret: String, vararg fields: Pair<String, String>,
        ): JSONObject {
            val form = FormBody.Builder()
                .add("client_id", clientId.trim())
                .add("client_secret", clientSecret.trim())
                .apply { fields.forEach { (k, v) -> add(k, v) } }
                .build()
            return JSONObject(Http.execute(Request.Builder().url("$base/oauth/v2/token").post(form).build()))
        }
    }
}

fun ZohoMailClient.Mail.describe(): String {
    val time = if (received > 0) SimpleDateFormat("d MMM h:mm a", Locale.ENGLISH).format(Date(received)) else ""
    val flag = if (unread) "UNREAD " else ""
    return "- ${flag}[$time] From: $from | Subject: $subject | $summary (folderId=$folderId, messageId=$messageId)"
}

internal fun String.stripHtml(): String =
    replace(Regex("(?is)<(script|style)[^>]*>.*?</\\1>"), " ")
        .replace(Regex("(?i)<br\\s*/?>|</p>|</div>|</tr>"), "\n")
        .replace(Regex("<[^>]+>"), " ")
        .replace("&nbsp;", " ").replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
        .replace("&#39;", "'").replace("&quot;", "\"")
        .replace(Regex("[ \\t]+"), " ")
        .replace(Regex("\\n\\s*\\n+"), "\n")
        .trim()
