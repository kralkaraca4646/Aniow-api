# AniOW Login Backend (Cloudflare Workers + D1)

## Kurulum adımları

### 1. Wrangler CLI kur (bilgisayarında, terminal üzerinden)
```
npm install -g wrangler
wrangler login
```
Bu komut tarayıcı açıp Cloudflare hesabınla giriş yaptırır.

### 2. Bu proje klasörünü indir ve içine gir
```
cd aniow-worker
```

### 3. D1 veritabanı oluştur
```
wrangler d1 create aniow-db
```
Bu komut çalıştığında bir `database_id` verecek. Onu kopyalayıp
`wrangler.toml` dosyasındaki `BURAYA_D1_DATABASE_ID_YAPISTIR` yerine yapıştır.

### 4. Veritabanı şemasını uygula
```
wrangler d1 execute aniow-db --remote --file=./schema.sql
```

### 5. JWT secret'ı ayarla
Rastgele, tahmin edilemez uzun bir metin seç (örn. bir şifre üretici ile 40+ karakter):
```
wrangler secret put JWT_SECRET
```
Komut sana metni soracak, yapıştır ve enter'a bas.

### 6. Yerel test (opsiyonel)
```
wrangler dev
```
Bu, `http://localhost:8787` üzerinde test etmeni sağlar.

### 7. Yayına al (deploy)
```
wrangler deploy
```
Deploy sonrası sana `aniow-api.SENIN-HESAP-ADIN.workers.dev` adresi verilecek.

---

## API Kullanımı

### Kayıt ol
```
POST /api/register
Content-Type: application/json

{
  "username": "kullaniciadi",
  "email": "ornek@mail.com",
  "password": "en-az-8-karakter"
}
```
Cevap: `{ token, user }`

### Giriş yap
```
POST /api/login
Content-Type: application/json

{
  "email": "ornek@mail.com",
  "password": "sifre"
}
```
Cevap: `{ token, user }`

### Kendi bilgini al (oturum kontrolü)
```
GET /api/me
Authorization: Bearer <token>
```
Cevap: `{ user }`

---

## Notlar
- Şifreler asla düz metin olarak saklanmıyor — PBKDF2 (100.000 iterasyon, SHA-256) ile hash'leniyor.
- Token 30 gün geçerli, süresi dolunca kullanıcı tekrar login olmalı.
- `JWT_SECRET`'ı asla koda yazma veya paylaşma — sadece `wrangler secret put` ile sakla.
- Frontend'den bu API'ye istek atarken `app.aniow.is-pro.dev` gibi custom domain bağlarsan, CORS ayarını (`Access-Control-Allow-Origin`) o domain'e özel kısıtlamak isteyebilirsin — şu an herkese açık (`*`) bırakıldı, geliştirme kolaylığı için.
