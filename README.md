# Openfront Clone

Gerçek zamanlı, çok oyunculu, tarayıcı tabanlı toprak fetih strateji oyunu. [Openfront.io](https://openfront.io)'dan ilham alınmış, özgün bir implementasyondur.

![Game Preview](https://img.shields.io/badge/status-Phase%201-blue) ![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue) ![Node.js](https://img.shields.io/badge/Node.js-20+-green) ![PixiJS](https://img.shields.io/badge/PixiJS-8.x-purple)

---

## Oyun Hakkında

Oyuncular dünya haritasında bir noktadan başlar ve komşu (bitişik) toprakları fethederek sınırlarını genişletir. Genişleme, nüfusa bağlı asker gücü harcar; arazi tipi ve yüksekliği fetih maliyetini etkiler.

**Galibiyet:** Toplam toprağın %80'ine ulaşmak.  
**Eleme:** Toprak oranının %0'a düşmesi.

---

## Teknoloji Yığını

| Katman | Teknoloji |
|--------|-----------|
| Frontend | TypeScript + Vite + PixiJS v8 |
| Backend | Node.js + Express + WebSocket (`ws`) |
| Paylaşılan Mantık | TypeScript (isomorphic `@openfront/core`) |
| Mimari | npm Workspaces Monorepo |

---

## Proje Yapısı

```
openfront-clone/
├── package.json              # Root workspace config
├── tsconfig.base.json        # Shared TypeScript config
└── packages/
    ├── core/                 # Paylaşılan oyun mantığı (server + client)
    │   └── src/
    │       ├── types.ts      # Tile, Player, GameState tipleri
    │       ├── map.ts        # Harita üretimi, bitişiklik, fetih maliyeti
    │       ├── game.ts       # Tick motoru, nüfus/ekonomi, galibiyet
    │       └── index.ts
    ├── server/               # Node.js + WebSocket oyun sunucusu
    │   └── src/
    │       ├── index.ts      # Express + WS sunucu başlatma
    │       └── gameRoom.ts   # Oyun odası: tick döngüsü, oyuncu yönetimi
    └── client/               # Vite + PixiJS tarayıcı istemcisi
        ├── index.html
        └── src/
            ├── main.ts       # Uygulama başlatma, UI yönetimi
            ├── renderer.ts   # PixiJS harita render, kamera, minimap
            └── gameClient.ts # WebSocket istemcisi
```

---

## Kurulum ve Çalıştırma

### Gereksinimler

- Node.js 20+
- npm 9+

### Bağımlılıkları Yükle

```bash
npm install
```

### Geliştirme Modunda Başlat

```bash
npm run dev
```

Sunucu `http://localhost:3001`, istemci `http://localhost:3000` adresinde başlar. Tarayıcıda `http://localhost:3000` adresini aç.

### Sadece Sunucu

```bash
npm run dev:server
```

### Sadece İstemci

```bash
npm run dev:client
```

### Prodüksiyon Build

```bash
npm run build
npm start
```

---

## Nasıl Oynanır

| Eylem | Kontrol |
|-------|---------|
| Haritayı kaydır | Sağ fare / Orta fare sürükle |
| Zoom | Fare tekerleği |
| Tile seç | Sol tık |
| Fetih başlat | Bitişik tile'a tıkla → asker yüzdesini ayarla → **Conquer** |

### Fetih Kuralları

- Yalnızca kendi toprağına **bitişik** tile'ları fethedersin.
- Fetih bir **asker maliyeti** harcar (arazi tipine + yüksekliğe göre değişir).
- **Ova (plains):** ×1.0 — **Yayla (highland):** ×1.5 — **Dağ (mountain):** ×2.5
- Su tile'ları (`ocean`, `lake`) fethedilemez.

### Ekonomi

- Nüfus zamanla büyür; büyüme sahip olunan toprak miktarıyla sınırlıdır (lojistik eğri).
- **Askerler:** Fetih ve savunma gücü.
- **İşçiler:** Her tick altın üretir.
- Asker/işçi oranı `troopRatio` ile kontrol edilir (varsayılan: %50).

---

## Mimari Notlar

### Deterministik Simülasyon

Tüm oyun mantığı `@openfront/core` paketinde sunucu ve istemci arasında paylaşılır. Sunucu **otoriter** kaynaktır; istemcilerden gelen her intent doğrulama kontrolünden geçirilir.

### Tick Tabanlı Senkronizasyon

Sunucu sabit 200ms aralıklarla tick çalıştırır:
- Her 5 tick'te tam `GameState` broadcast edilir.
- Arada sadece player verisi gönderilir (bant genişliği tasarrufu).
- Oyuncu komutları (`CONQUER`) anında işlenir ve tüm istemcilere yayınlanır.

### WebSocket Mesaj Formatları

```ts
// Sunucu → İstemci
{ type: 'PLAYER_JOIN', payload: { playerId, state } }
{ type: 'GAME_STATE',  payload: GameState }
{ type: 'TICK',        payload: { tick, players } }
{ type: 'ERROR',       payload: { message } }

// İstemci → Sunucu
{ type: 'CONQUER', payload: { tileId, percentage } }
```

---

## Geliştirme Fazları

- [x] **Faz 1** — Temel iskelet: harita üretimi, tek/çok oyunculu fetih, WebSocket senkronizasyonu, PixiJS renderer
- [ ] **Faz 2** — Çok oyunculu iyileştirmeler: client-side prediction, lobi sistemi, oda yönetimi
- [ ] **Faz 3** — Savaş mekaniği: saldırı yüzdesi formülü, savunma hesabı, eleme/galibiyet ekranı
- [ ] **Faz 4** — Binalar ve deniz: şehir, liman, ticaret gemisi, savunma karakolu
- [ ] **Faz 5** — Nükleer ve diplomasi: füze silosu, ittifak sistemi, quick chat, flare
- [ ] **Faz 6** — AI botlar ve lobi: kural tabanlı bot AI, harita seçimi, misafir modu
- [ ] **Faz 7** — Cilalama: ses efektleri, replay sistemi, mobil uyumluluk

---

## Lisans

Bu proje kendi özgün implementasyonudur. [Openfront.io (AGPL-3.0)](https://github.com/openfrontio/OpenFrontIO) projesinden ilham alınmış; kod doğrudan kopyalanmamıştır.
