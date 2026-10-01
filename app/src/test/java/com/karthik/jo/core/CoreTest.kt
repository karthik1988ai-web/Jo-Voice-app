package com.karthik.jo.core

import okhttp3.mockwebserver.*
import org.json.JSONObject
import java.io.File
import kotlin.test.*

class CoreTest {
  @Test fun geminiToolLoop() {
    val server = MockWebServer()
    // 1st: model calls add_task with a thought signature; 2nd: final text.
    server.enqueue(MockResponse().setBody("""{"candidates":[{"content":{"role":"model","parts":[{"functionCall":{"name":"add_task","args":{"title":"Call supplier","due":"2026-10-02 17:00"}},"thoughtSignature":"sig123"}]}}]}"""))
    server.enqueue(MockResponse().setBody("""{"candidates":[{"content":{"role":"model","parts":[{"text":"Added call supplier for tomorrow 5 PM."}]}}]}"""))
    server.start()
    val f = File.createTempFile("tasks", ".json").also { it.delete() }
    val store = TaskStore(f)
    var added: TaskStore.Task? = null
    val tools = JoTools(null, null, null, store, null, onTaskAdded = { added = it })
    val agent = JoAgent(GeminiClient("k", "gemini-flash-latest", server.url("").toString().trimEnd('/')), tools, false)
    assertEquals("Added call supplier for tomorrow 5 PM.", agent.ask("remind me to call supplier tomorrow 5pm"))
    assertEquals("Call supplier", added?.title)
    assertNotNull(added?.due)
    val r1 = server.takeRequest(); assertEquals("k", r1.getHeader("x-goog-api-key"))
    assertTrue(r1.path!!.endsWith("/v1beta/models/gemini-flash-latest:generateContent"))
    val body2 = JSONObject(server.takeRequest().body.readUtf8())
    val c = body2.getJSONArray("contents")
    assertEquals(3, c.length())
    assertEquals("sig123", c.getJSONObject(1).getJSONArray("parts").getJSONObject(0).getString("thoughtSignature"))
    assertTrue(c.getJSONObject(2).getJSONArray("parts").getJSONObject(0).getJSONObject("functionResponse").getJSONObject("response").getString("result").startsWith("Added"))
    assertTrue(body2.getJSONArray("tools").getJSONObject(0).getJSONArray("functionDeclarations").length() >= 10)
    // No-mail tool returns a friendly message rather than throwing
    assertTrue(tools.call("get_unread_mail", JSONObject()).contains("not connected"))
    server.shutdown()
  }

  @Test fun gemini429Friendly() {
    val server = MockWebServer(); server.enqueue(MockResponse().setResponseCode(429).setBody("{}")); server.start()
    val g = GeminiClient("k", "m", server.url("").toString().trimEnd('/'))
    val e = assertFailsWith<IllegalStateException> { g.generate("s", org.json.JSONArray().put(GeminiClient.userText("hi"))) }
    assertTrue(e.message!!.contains("free-tier limit"))
  }

  @Test fun zohoFlow() {
    val server = MockWebServer()
    server.dispatcher = object : Dispatcher() {
      override fun dispatch(r: RecordedRequest): MockResponse = when {
        r.path!!.startsWith("/oauth/v2/token") -> MockResponse().setBody("""{"access_token":"AT","expires_in":3600}""")
        r.path == "/api/accounts" -> MockResponse().setBody("""{"data":[{"accountId":"77"}]}""")
        r.path!!.startsWith("/api/accounts/77/messages/view") -> { assertEquals("Zoho-oauthtoken AT", r.getHeader("Authorization")); MockResponse().setBody("""{"data":[{"messageId":"m1","folderId":"f1","sender":"Britannia","subject":"MTD report","summary":"Sales 4.2L","receivedTime":"1759300000000","status":"0"}]}""") }
        r.path!!.startsWith("/api/accounts/77/messages/search") -> { assertTrue(r.path!!.contains("searchKey=entire%3ABritannia")); MockResponse().setBody("""{"data":[]}""") }
        r.path == "/api/accounts/77/folders/f1/messages/m1/content" -> MockResponse().setBody("""{"data":{"content":"<div>Hello<br>Total: <b>4,20,000</b></div><style>x{}</style>"}}""")
        else -> MockResponse().setResponseCode(404)
      }
    }
    server.start()
    val base = server.url("").toString().trimEnd('/')
    val z = ZohoMailClient("com", "id", "sec", "rt", accountsBase = base, mailBase = "$base/api")
    val tools = JoTools(z, null, null, TaskStore(File.createTempFile("tasks", ".json").also { it.delete() }), null)
    val list = tools.call("get_unread_mail", JSONObject())
    assertTrue(list.contains("UNREAD") && list.contains("MTD report") && list.contains("messageId=m1"), list)
    assertEquals("No matching emails.", tools.call("search_mail", JSONObject().put("query", "Britannia")))
    assertEquals("Hello\nTotal: 4,20,000", tools.call("read_mail", JSONObject().put("folder_id","f1").put("message_id","m1")))
    assertTrue(tools.briefData().contains("Kavery Delivery"))
    server.shutdown()
  }

  @Test fun supabase() {
    val server = MockWebServer()
    server.dispatcher = object : Dispatcher() {
      override fun dispatch(r: RecordedRequest): MockResponse {
        assertEquals("sb_secret_x", r.getHeader("apikey")); assertNull(r.getHeader("Authorization"))
        val p = r.path!!
        return when {
          p.startsWith("/rest/v1/orders?") && p.contains("order=created_at.desc") -> MockResponse().setBody("""[{"id":1,"status":"pending","amount":250}]""").setHeader("Content-Range","0-0/57")
          p.startsWith("/rest/v1/riders?") && p.contains("order=created_at") -> MockResponse().setResponseCode(400).setBody("{}")
          p.startsWith("/rest/v1/riders?") -> MockResponse().setBody("""[{"name":"Ravi"}]""").setHeader("Content-Range","0-0/4")
          p.startsWith("/rest/v1/rpc/jo_daily_summary") -> { assertEquals("POST", r.method); assertEquals("""{"p_date":"2026-10-01"}""", r.body.readUtf8()); MockResponse().setBody("""{"orders":14}""") }
          else -> MockResponse().setResponseCode(404).setBody(p)
        }
      }
    }
    server.start()
    val url = server.url("/").toString()
    val s = SupabaseSource("Kavery", url, "sb_secret_x", tables = "orders, riders")
    val sum = s.summary()
    assertTrue(sum.contains("Table orders: 57 rows") && sum.contains("Table riders: 4 rows"), sum)
    val d = s.describe(); assertTrue(d.contains("- orders: ") && d.contains("status") && d.contains("- riders: name"), d)
    val q = s.query("orders", "id,status", "status=eq.pending&limit=999", "created_at.desc", 10)
    assertTrue(q.startsWith("Total matching rows: 57"), q)
    assertFailsWith<IllegalArgumentException> { s.query("users", null, null, null, 5) }
    val tools = JoTools(null, s, null, TaskStore(File.createTempFile("tasks", ".json").also { it.delete() }), null)
    assertTrue(tools.call("query_app_data", JSONObject().put("app","thirumal").put("table","x")).contains("Thirumal is not connected"))
    assertTrue(tools.call("get_app_summary", JSONObject().put("app","kavery")).contains("57 rows"))
    val rpc = SupabaseSource("Kavery", url, "sb_secret_x", summaryFunction = "jo_daily_summary")
    assertEquals("""{"orders":14}""", rpc.summary("2026-10-01"))
    server.shutdown()
  }

  @Test fun tasks() {
    val s = TaskStore(File.createTempFile("tasks", ".json").also { it.delete() })
    val a = s.add("A", null); val b = s.add("B", JoTools.parseLocal("2026-10-02 09:30"))
    assertEquals(listOf("B","A"), s.open().map { it.title })
    s.setDone(b.id); assertEquals(listOf("A"), s.open().map { it.title })
    assertTrue(s.delete(a.id)); assertEquals(1, s.all().size)
  }
}
