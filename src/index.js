// ── Yardımcı fonksiyonlar ──────────────────────────────────────────

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      // Mobil/web frontend farklı origin'den istek atacağı için CORS açık
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}

function bufferToHex(buffer) {
  return [...new Uint8Array(buffer)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBuffer(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes.buffer;
}

// Şifreyi PBKDF2 ile hashler (bcrypt yerine Worker'ın native desteklediği yöntem)
async function hashPassword(password, saltHex) {
  const encoder = new TextEncoder();
  const salt = saltHex ? hexToBuffer(saltHex) : crypto.getRandomValues(new Uint8Array(16)).buffer;

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    256
  );

  return {
    hash: bufferToHex(derivedBits),
    salt: bufferToHex(salt),
  };
}

async function verifyPassword(password, storedHash, storedSalt) {
  const { hash } = await hashPassword(password, storedSalt);
  return hash === storedHash;
}

// Basit JWT oluşturma (HMAC-SHA256 imzalı)
function base64url(input) {
  return btoa(String.fromCharCode(...new Uint8Array(input)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function signJWT(payload, secret) {
  const encoder = new TextEncoder();
  const header = { alg: "HS256", typ: "JWT" };

  const headerB64 = base64url(encoder.encode(JSON.stringify(header)));
  const payloadB64 = base64url(encoder.encode(JSON.stringify(payload)));
  const data = `${headerB64}.${payloadB64}`;

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(data));

  return `${data}.${base64url(signature)}`;
}

async function verifyJWT(token, secret) {
  const [headerB64, payloadB64, signatureB64] = token.split(".");
  if (!headerB64 || !payloadB64 || !signatureB64) return null;

  const encoder = new TextEncoder();
  const data = `${headerB64}.${payloadB64}`;

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );

  const signature = Uint8Array.from(
    atob(signatureB64.replace(/-/g, "+").replace(/_/g, "/")),
    (c) => c.charCodeAt(0)
  );

  const valid = await crypto.subtle.verify("HMAC", key, signature, encoder.encode(data));
  if (!valid) return null;

  const payload = JSON.parse(atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/")));

  // süre kontrolü
  if (payload.exp && Date.now() / 1000 > payload.exp) return null;

  return payload;
}

function generateId() {
  return crypto.randomUUID();
}

// ── Route handler'lar ──────────────────────────────────────────────

async function handleRegister(request, env) {
  const { username, email, password } = await request.json();

  if (!username || !email || !password) {
    return jsonResponse({ error: "username, email ve password zorunlu" }, 400);
  }
  if (password.length < 8) {
    return jsonResponse({ error: "Şifre en az 8 karakter olmalı" }, 400);
  }

  // e-posta/kullanıcı adı zaten var mı kontrol et
  const existing = await env.DB.prepare(
    "SELECT id FROM users WHERE email = ? OR username = ?"
  )
    .bind(email, username)
    .first();

  if (existing) {
    return jsonResponse({ error: "Bu e-posta veya kullanıcı adı zaten kayıtlı" }, 409);
  }

  const { hash, salt } = await hashPassword(password);
  const id = generateId();

  await env.DB.prepare(
    "INSERT INTO users (id, username, email, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  )
    .bind(id, username, email, hash, salt, Date.now())
    .run();

  const token = await signJWT(
    { sub: id, username, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30 }, // 30 gün
    env.JWT_SECRET
  );

  return jsonResponse({ token, user: { id, username, email } }, 201);
}

async function handleLogin(request, env) {
  const { email, password } = await request.json();

  if (!email || !password) {
    return jsonResponse({ error: "email ve password zorunlu" }, 400);
  }

  const user = await env.DB.prepare(
    "SELECT id, username, email, password_hash, password_salt FROM users WHERE email = ?"
  )
    .bind(email)
    .first();

  if (!user) {
    return jsonResponse({ error: "E-posta veya şifre hatalı" }, 401);
  }

  const valid = await verifyPassword(password, user.password_hash, user.password_salt);
  if (!valid) {
    return jsonResponse({ error: "E-posta veya şifre hatalı" }, 401);
  }

  const token = await signJWT(
    { sub: user.id, username: user.username, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30 },
    env.JWT_SECRET
  );

  return jsonResponse({
    token,
    user: { id: user.id, username: user.username, email: user.email },
  });
}

async function handleMe(request, env) {
  const authHeader = request.headers.get("Authorization") || "";
  const token = authHeader.replace("Bearer ", "");

  if (!token) {
    return jsonResponse({ error: "Token gerekli" }, 401);
  }

  const payload = await verifyJWT(token, env.JWT_SECRET);
  if (!payload) {
    return jsonResponse({ error: "Geçersiz veya süresi dolmuş token" }, 401);
  }

  const user = await env.DB.prepare(
    "SELECT id, username, email, created_at FROM users WHERE id = ?"
  )
    .bind(payload.sub)
    .first();

  if (!user) {
    return jsonResponse({ error: "Kullanıcı bulunamadı" }, 404);
  }

  return jsonResponse({ user });
}

// ── Ana giriş noktası ───────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === "OPTIONS") {
      return jsonResponse({}, 204);
    }

    try {
      if (url.pathname === "/api/register" && request.method === "POST") {
        return await handleRegister(request, env);
      }
      if (url.pathname === "/api/login" && request.method === "POST") {
        return await handleLogin(request, env);
      }
      if (url.pathname === "/api/me" && request.method === "GET") {
        return await handleMe(request, env);
      }

      return jsonResponse({ error: "Endpoint bulunamadı" }, 404);
    } catch (err) {
      return jsonResponse({ error: "Sunucu hatası", detail: err.message }, 500);
    }
  },
};
