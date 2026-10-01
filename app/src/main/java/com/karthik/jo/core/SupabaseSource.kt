package com.karthik.jo.core

import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Read-only access to one of Karthik's Supabase projects (Kavery Delivery, Thirumal accounts)
 * through its REST API. Jo only ever reads: GET on tables, or POST to the optional
 * summary function (a SQL function the project owner writes; see README).
 */
class SupabaseSource(
    val name: String,
    projectUrl: String,
    private val key: String,
    private val summaryFunction: String = "",
    tables: String = "",                       // comma-separated tables Jo may read; blank = discover
) {
    private val rest = projectUrl.trim().trimEnd('/') + "/rest/v1"
    private val allowedTables = tables.split(',').map { it.trim() }.filter { it.isNotEmpty() }

    /**
     * Today's (or [date]'s) summary. Uses the summary function when configured; otherwise
     * a row count plus the latest rows of each table, which is enough for Gemini to describe.
     */
    fun summary(date: String? = null): String {
        val day = date?.takeIf { it.isNotBlank() } ?: SimpleDateFormat("yyyy-MM-dd", Locale.ENGLISH).format(Date())
        if (summaryFunction.isNotBlank()) {
            val body = JSONObject().put("p_date", day).toString()
            return Http.execute(request("$rest/rpc/${summaryFunction.trim()}".toHttpUrl()).post(body.toRequestBody(JSON)).build())
                .clip(6000)
        }
        return tables().take(8).joinToString("\n\n") { table ->
            try {
                val (rows, total) = latestRows(table, 3)
                "Table $table: ${total ?: "?"} rows. Latest: ${rows.clip(1200)}"
            } catch (e: Exception) {
                "Table $table: unavailable (${e.message?.take(120)})"
            }
        }.ifBlank { "No tables configured for $name. Add table names in Settings." }
    }

    /** Lists readable tables with their column names (from one sample row). */
    fun describe(): String = tables().joinToString("\n") { table ->
        val cols = runCatching {
            JSONArray(latestRows(table, 1).first).optJSONObject(0)?.keys()?.asSequence()?.joinToString(", ")
        }.getOrNull()
        "- $table: ${cols ?: "(empty or not readable)"}"
    }.ifBlank { "No tables configured for $name. Add table names in Settings." }

    /**
     * Reads rows with PostgREST filters, e.g.
     * filters = "status=eq.pending&created_at=gte.2026-10-01", order = "created_at.desc".
     */
    fun query(table: String, select: String?, filters: String?, order: String?, limit: Int): String {
        require(allowedTables.isEmpty() || table in allowedTables) {
            "Table \"$table\" is not in the allowed list for $name: ${allowedTables.joinToString()}"
        }
        val url = "$rest/${table.trim()}".toHttpUrl().newBuilder().apply {
            addQueryParameter("select", select?.takeIf { it.isNotBlank() } ?: "*")
            filters?.split('&')?.map { it.trim() }?.filter { '=' in it }?.forEach {
                val (k, v) = it.split('=', limit = 2)
                // select/limit/order are set from their own arguments, never from filters
                if (k !in setOf("select", "limit", "order", "offset")) addQueryParameter(k, v)
            }
            order?.takeIf { it.isNotBlank() }?.let { addQueryParameter("order", it) }
            addQueryParameter("limit", limit.coerceIn(1, 50).toString())
        }.build()
        val (body, range) = Http.executeWithHeader(
            request(url).header("Prefer", "count=exact").build(), "Content-Range"
        )
        val total = range?.substringAfter('/', "")?.takeIf { it.isNotBlank() && it != "*" }
        return (if (total != null) "Total matching rows: $total\n" else "") + body.clip(5000)
    }

    private fun latestRows(table: String, n: Int): Pair<String, String?> {
        fun fetch(order: Boolean): Pair<String, String?> {
            val url = "$rest/$table".toHttpUrl().newBuilder()
                .addQueryParameter("select", "*")
                .addQueryParameter("limit", n.toString())
                .apply { if (order) addQueryParameter("order", "created_at.desc") }
                .build()
            val (body, range) = Http.executeWithHeader(request(url).header("Prefer", "count=exact").build(), "Content-Range")
            return body to range?.substringAfter('/', "")?.takeIf { it.isNotBlank() && it != "*" }
        }
        // Most Supabase tables have created_at; fall back to unordered if this one doesn't.
        return try { fetch(order = true) } catch (e: HttpException) { if (e.code == 400) fetch(order = false) else throw e }
    }

    /** Configured tables, or the ones the REST schema exposes (needs a key allowed to read it). */
    private fun tables(): List<String> {
        if (allowedTables.isNotEmpty()) return allowedTables
        return runCatching {
            val spec = JSONObject(Http.execute(request("$rest/".toHttpUrl()).build()))
            spec.optJSONObject("definitions")?.keys()?.asSequence()?.toList().orEmpty()
        }.getOrDefault(emptyList())
    }

    private fun request(url: HttpUrl) = Request.Builder().url(url).apply {
        header("apikey", key.trim())
        // Legacy anon/service_role keys are JWTs and also go in Authorization;
        // the newer sb_publishable_/sb_secret_ keys must only be sent as apikey.
        if (key.trim().startsWith("eyJ")) header("Authorization", "Bearer ${key.trim()}")
        header("Accept", "application/json")
    }

    private companion object {
        val JSON = "application/json".toMediaType()
    }
}
