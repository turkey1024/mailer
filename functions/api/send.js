export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();

    // 密码校验（密码只在 Cloudflare Secret 里，前端看不到）
    if (body.token !== env.SITE_TOKEN) {
      return new Response(JSON.stringify({ error: "密码错误" }), { status: 403, headers: { "Content-Type": "application/json" } });
    }
    if (!body.to || !body.subject) {
      return new Response(JSON.stringify({ error: "收件人和主题必填" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: body.from || env.DEFAULT_FROM,
        to: [body.to],
        subject: body.subject,
        text: body.text || "",
      }),
    });

    return new Response(await res.text(), { status: res.status, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
