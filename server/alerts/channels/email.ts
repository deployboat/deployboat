// A small SMTP client: enough to send a plain-text email through any provider.
// Port 465 = TLS from the start. Port 587 (or 25) = plain, then STARTTLS.
import net from "node:net";
import tls from "node:tls";
import { randomBytes } from "node:crypto";

export type EmailChannel = { type: "email"; host: string; port: number; user: string; pass: string; from: string; to: string };

// Reads SMTP replies. A reply can span lines ("250-…" … "250 …").
// Replies that arrive before anyone asks are kept until they're asked for.
function reader(sock: net.Socket) {
  let buf = "";
  type Reply = { code: number; text: string };
  const ready: Reply[] = [];
  const waiting: ((r: Reply) => void)[] = [];
  const onData = (d: Buffer) => {
    buf += d.toString();
    let m;
    while ((m = buf.match(/^(\d{3}) [^\r\n]*\r?\n/m))) {
      const end = buf.indexOf(m[0]) + m[0].length;
      const reply = { code: Number(m[1]), text: buf.slice(0, end).trim() };
      buf = buf.slice(end);
      const w = waiting.shift();
      w ? w(reply) : ready.push(reply);
    }
  };
  sock.on("data", onData);
  return {
    next: () => new Promise<Reply>((resolve) => { const r = ready.shift(); r ? resolve(r) : waiting.push(resolve); }),
    stop: () => sock.off("data", onData),
  };
}

export async function sendEmail(ch: EmailChannel, subject: string, body: string) {
  const host = ch.host.trim(), port = Number(ch.port) || 587;
  let sock: net.Socket = port === 465 ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });
  sock.setTimeout(20_000, () => sock.destroy(new Error("The email server didn't answer in time.")));
  const failed = new Promise<never>((_, reject) => sock.once("error", reject));
  let r = reader(sock);

  const expect = async (ok: number[]) => {
    const res = await Promise.race([r.next(), failed]);
    if (!ok.includes(res.code)) throw new Error(`Email server said: ${res.text.split("\n").pop()}`);
    return res;
  };
  const say = async (line: string, ok: number[]) => { sock.write(line + "\r\n"); return expect(ok); };

  try {
    await expect([220]);
    let hello = await say("EHLO deployboat", [250]);

    if (port !== 465) {
      if (!/STARTTLS/i.test(hello.text)) throw new Error("This email server doesn't support a secure connection on that port. Try port 465.");
      await say("STARTTLS", [220]);
      r.stop();
      sock = tls.connect({ socket: sock, servername: host });
      sock.once("error", () => {});
      await new Promise((ok, fail) => { sock.once("secureConnect", ok); sock.once("error", fail); });
      r = reader(sock);
      hello = await say("EHLO deployboat", [250]);
    }

    if (ch.user) {
      await say("AUTH LOGIN", [334]);
      await say(Buffer.from(ch.user).toString("base64"), [334]);
      await say(Buffer.from(ch.pass).toString("base64"), [235]);
    }

    const from = ch.from || ch.user;
    const address = (s: string) => s.match(/<([^>]+)>/)?.[1] ?? s.trim();
    await say(`MAIL FROM:<${address(from)}>`, [250]);
    for (const to of ch.to.split(",").map((x) => x.trim()).filter(Boolean)) await say(`RCPT TO:<${address(to)}>`, [250, 251]);
    await say("DATA", [354]);

    const encSubject = `=?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`;
    const message = [
      `From: ${from}`, `To: ${ch.to}`, `Subject: ${encSubject}`, `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${randomBytes(12).toString("hex")}@deployboat>`, "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: 8bit", "",
      // A line starting with "." must be doubled, or the server thinks the message ended.
      ...body.split("\n").map((l) => (l.startsWith(".") ? "." + l : l)),
    ].join("\r\n");
    sock.write(message + "\r\n.\r\n");
    await expect([250]);
    sock.write("QUIT\r\n");
  } finally {
    sock.end();
  }
}
