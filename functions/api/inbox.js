// 收件箱 API：GET /api/inbox?token=xxx 列出，GET /api/inbox?token=xxx&id=xxx 读单封
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  if (token !== env.SITE_TOKEN) {
    return json({ error: "密码错误" }, 403);
  }

  const id = url.searchParams.get("id");
  if (id) {
    const raw = await env.KV.get(`mail:${id}`);
    if (!raw) return json({ error: "邮件不存在" }, 404);
    return json(JSON.parse(raw));
  }

  // 列表：KV list 按 key 字典序，mail: 前缀 + 时间戳 → 新的在前
  const list = await env.KV.list({ prefix: "mail:", limit: 200 });
  const keys = list.keys
    .map((k) => k.name)
    .sort((a, b) => b.localeCompare(a))
    .slice(0, 50);

  const mails = [];
  for (const name of keys) {
    const raw = await env.KV.get(name);
    if (raw) mails.push(JSON.parse(raw));
  }
  return json({ total: list.keys.length, mails });
}
