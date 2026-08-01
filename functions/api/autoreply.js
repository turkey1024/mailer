export async function onRequestPost({ request, env }) {
  try {
    const mail = await request.json();
    const sender = mail.from?.email;
    const subject = mail.subject || "";

    // 防循环：无发件人、退信、自动回复主题，跳过
    if (!sender || /^(out of office|auto|autoreply|自动回复|undeliverable|delivery status|mail delivery)/i.test(subject.trim())) {
      return new Response("skipped", { status: 200 });
    }

    // 防循环：同一发件人 24h 内只回一次
    const last = await env.KV.get(`replied:${sender}`);
    if (last && Date.now() - Number(last) < 86400000) {
      return new Response("already replied", { status: 200 });
    }
    await env.KV.put(`replied:${sender}`, String(Date.now()), { expirationTtl: 86400 });

    // 发自动回复
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.DEFAULT_FROM,
        to: [sender],
        subject: `Re: ${subject}`,
        text: `你好，\n\n我已收到你的邮件（主题：${subject}），会尽快回复。\n\n—— ${env.DEFAULT_FROM}`,
      }),
    });
    return new Response("ok", { status: 200 });
  } catch (e) {
    return new Response("error", { status: 500 });
  }
}
