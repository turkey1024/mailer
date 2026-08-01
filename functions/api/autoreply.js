export async function onRequestPost({ request, env }) {
  try {
    const payload = await request.json();

    // 只处理 Resend inbound 的收件事件
    if (payload.type !== "email.received") {
      return new Response("ignored", { status: 200 });
    }

    const mail = payload.data || {};
    // Resend 格式：from 是 "名字 <email>"
    const senderFull = mail.from || "";
    const m = senderFull.match(/<([^>]+)>/);
    const sender = m ? m[1] : senderFull;
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

    // 发自动回复（文案来自环境变量 REPLY_TEXT，支持 {subject} 占位符）
    const replyText = (env.REPLY_TEXT || `你好，\n\n我已收到你的邮件，会尽快回复。\n\n—— ${env.DEFAULT_FROM}`)
      .replace(/\{subject\}/g, subject)
      .replace(/\{from\}/g, env.DEFAULT_FROM);

    // 可选：回复正文内联图片（REPLY_IMAGE_URL 环境变量）
    const html = env.REPLY_IMAGE_URL
      ? `${replyText.split("\n").map((l) => (l ? `<p>${l}</p>` : "")).join("")}<p><img src="${env.REPLY_IMAGE_URL}" style="max-width:100%;border-radius:8px"></p>`
      : undefined;

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
        text: replyText,
        ...(html ? { html } : {}),
      }),
    });
    return new Response("ok", { status: 200 });
  } catch (e) {
    return new Response("error", { status: 500 });
  }
}
