export async function onRequestPost({ request, env }) {
  // 1. 来源校验：只接受 ImprovMX webhook（固定 IP）
  const ip = request.headers.get("CF-Connecting-IP");
  if (ip !== "15.237.103.194") {
    return new Response("forbidden", { status: 403 });
  }

  try {
    const mail = await request.json();
    const sender = mail.from?.email;
    const subject = mail.subject || "";

    // 2. 防循环：不回复自己、无发件人跳过
    if (!sender || sender === env.DEFAULT_FROM) return new Response("skipped", { status: 200 });

    // 3. 跳过自动回复/退信
    if (/^(out of office|auto|autoreply|自动回复|undeliverable|delivery status|mail delivery)/i.test(subject.trim())) {
      return new Response("skipped", { status: 200 });
    }

    // 4. KV 去重：同一发件人 24 小时内只回一次（防对方也是机器人导致循环）
    const key = `replied:${sender}`;
    const last = await env.KV.get(key);
    if (last && Date.now() - Number(last) < 86400000) {
      return new Response("already replied", { status: 200 });
    }
    await env.KV.put(key, String(Date.now()), { expirationTtl: 86400 });

    // 5. 调 Resend 发自动回复
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.DEFAULT_FROM,
        to: [sender],
        subject: `Re: ${subject}`,
        text: `你好，\n\n我已收到你的邮件（主题：${subject}），会尽快回复。\n\n—— ${env.DEFAULT_FROM} 自动回复`,
      }),
    });
    return new Response(await res.text(), { status: res.status, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
