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

    // Resend webhook 只有元数据，正文要走 Received emails API 拉
    let full = {};
    const emailId = mail.email_id || mail.id || "";
    if (emailId) {
      try {
        const r = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, {
          headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}` },
        });
        if (r.ok) full = await r.json();
      } catch (e) { /* 拉取失败则存元数据 */ }
    }

    // 收件箱：把邮件存进 KV（附件只存元数据，不存文件内容）
    try {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await env.KV.put(`mail:${id}`, JSON.stringify({
        id,
        email_id: emailId,
        from: senderFull || sender,
        to: Array.isArray(mail.to) ? mail.to.join(", ") : (mail.to || ""),
        subject,
        text: (full.text || mail.text || "").slice(0, 50000),
        html: (full.html || mail.html || "").slice(0, 200000),
        date: (full.created_at || new Date()).toISOString?.() || new Date().toISOString(),
        attachments: Array.isArray(mail.attachments)
          ? mail.attachments.map((a) => ({
              filename: a.filename || "",
              contentType: a.content_type || a.contentType || "",
              size: 0,
            }))
          : [],
      }));
    } catch (e) {
      // 存储失败不影响自动回复
    }

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
    const replyText = (env.REPLY_TEXT || `已收到你的来信，自动触发李谨行家中核爆装置进行提醒，我将尽快回复你\n若有急事，请加微信：`)
      .replace(/\{subject\}/g, subject)
      .replace(/\{from\}/g, env.DEFAULT_FROM);

    // 可选：回复正文内联图片（REPLY_IMAGE_URL 环境变量）
    const imgUrl = env.REPLY_IMAGE_URL || "https://claw-oss-01.lhl.one/20260416/37fc9206d998eb69c564bfa2817bc004.png";
    const html = imgUrl
      ? `<p><b>【自动回复】</b></p>${replyText.split("\n").map((l) => (l ? `<p>${l}</p>` : "")).join("")}<p><img src="${imgUrl}" style="max-width:100%;border-radius:8px"></p>`
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
        subject: `[自动回复] ${subject}`,
        text: `【自动回复】\n\n${replyText}`,
        ...(html ? { html } : {}),
      }),
    });
    return new Response("ok", { status: 200 });
  } catch (e) {
    return new Response("error", { status: 500 });
  }
}
