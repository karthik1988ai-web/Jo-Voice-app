package com.karthik.jo.core

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject

/**
 * Minimal Google Gemini REST client (generateContent + function calling).
 * Free API key: https://aistudio.google.com/apikey
 */
class GeminiClient(
    private val apiKey: String,
    private val model: String,
    private val baseUrl: String = "https://generativelanguage.googleapis.com",
) {

    /** One declared function Gemini may call. [params] maps name -> (type, description). */
    data class Function(
        val name: String,
        val description: String,
        val params: Map<String, Pair<String, String>> = emptyMap(),
        val required: List<String> = emptyList(),
    )

    /**
     * Sends the conversation and returns the model's content object (role "model").
     * Callers append it to [contents] unchanged: Gemini's thought signatures ride
     * along in its parts and must be sent back as-is on the next turn.
     */
    fun generate(system: String, contents: JSONArray, functions: List<Function> = emptyList()): JSONObject {
        val body = JSONObject().apply {
            put("systemInstruction", JSONObject().put("parts", JSONArray().put(JSONObject().put("text", system))))
            put("contents", contents)
            if (functions.isNotEmpty()) {
                put("tools", JSONArray().put(JSONObject().put("functionDeclarations", JSONArray().apply {
                    functions.forEach { put(it.toJson()) }
                })))
            }
        }
        val request = Request.Builder()
            .url("$baseUrl/v1beta/models/${model.trim()}:generateContent")
            .header("x-goog-api-key", apiKey.trim())
            .post(body.toString().toRequestBody("application/json".toMediaType()))
            .build()

        val response = try {
            JSONObject(Http.execute(request))
        } catch (e: HttpException) {
            throw IllegalStateException(friendlyError(e), e)
        }
        val candidate = response.optJSONArray("candidates")?.optJSONObject(0)
            ?: throw IllegalStateException(
                "Gemini gave no answer (${response.optJSONObject("promptFeedback")?.optString("blockReason") ?: "empty"})."
            )
        return candidate.optJSONObject("content")
            ?: JSONObject().put("role", "model").put("parts", JSONArray())
    }

    private fun friendlyError(e: HttpException): String = when (e.code) {
        400 -> "Gemini rejected the request. Check the model name in Settings. (${e.message})"
        401, 403 -> "Gemini API key is not valid. Check it in Settings."
        404 -> "Gemini model \"$model\" not found. Check the model name in Settings."
        429 -> "Gemini free-tier limit reached for now. Try again in a minute (daily limits reset at midnight Pacific time)."
        else -> "Gemini error ${e.code}. Try again shortly."
    }

    private fun Function.toJson() = JSONObject().apply {
        put("name", name)
        put("description", description)
        if (params.isNotEmpty()) {
            put("parameters", JSONObject().apply {
                put("type", "object")
                put("properties", JSONObject().apply {
                    params.forEach { (key, spec) ->
                        put(key, JSONObject().put("type", spec.first).put("description", spec.second))
                    }
                })
                if (required.isNotEmpty()) put("required", JSONArray(required))
            })
        }
    }

    companion object {
        const val DEFAULT_MODEL = "gemini-flash-latest"

        fun userText(text: String): JSONObject =
            JSONObject().put("role", "user").put("parts", JSONArray().put(JSONObject().put("text", text)))

        fun functionResponse(name: String, result: String): JSONObject = JSONObject()
            .put("functionResponse", JSONObject().put("name", name).put("response", JSONObject().put("result", result)))

        fun JSONObject.text(): String {
            val parts = optJSONArray("parts") ?: return ""
            return (0 until parts.length())
                .mapNotNull { parts.optJSONObject(it) }
                .filter { !it.optBoolean("thought") && it.has("text") }
                .joinToString("") { it.getString("text") }
                .trim()
        }

        fun JSONObject.functionCalls(): List<JSONObject> {
            val parts = optJSONArray("parts") ?: return emptyList()
            return (0 until parts.length()).mapNotNull { parts.optJSONObject(it)?.optJSONObject("functionCall") }
        }
    }
}
