require("dotenv").config();
const { Client, GatewayIntentBits } = require("discord.js");
const { Shoukaku, Connectors } = require("shoukaku");

// --- DISCORD CLIENT ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const prefix = "!";

// --- LAVALINK YAPILANDIRMASI ---
const Nodes = [
  {
    name: "Ana-Sunucu",
    url: "127.0.0.1:2333", // application.yml ile aynı olmalı
    auth: "youshallnotpass",
    secure: false,
  },
];

// Shoukaku Seçenekleri
const shoukakuOptions = {
  resume: true,
  resumeTimeout: 30,
  reconnectTries: 5,
  restTimeout: 10000,
};

client.shoukaku = new Shoukaku(new Connectors.DiscordJS(client), Nodes, shoukakuOptions);

// --- QUEUE (SIRA) YÖNETİMİ ---
const queue = new Map();

// --- ŞARKI OYNATMA FONKSİYONU (KRİTİK GÜNCELLEME) ---
async function playNext(guildId) {
  const data = queue.get(guildId);
  if (!data || data.tracks.length === 0) return;

  const nextTrack = data.tracks.shift();
  
  try {
    // Lavalink v4'ün beklediği kesin JSON yapısı:
    await data.player.playTrack({ 
      track: { 
        encoded: nextTrack.encoded 
      } 
    });
  } catch (err) {
    console.error(`[${guildId}] Oynatma hatası:`, err.message);
    playNext(guildId);
  }
}

// --- BOT OLAYLARI ---
client.once("ready", () => {
  console.log(`✅ Bot giriş yaptı: ${client.user.tag}`);
});

client.shoukaku.on("ready", (name) => console.log(`✅ Lavalink aktif: ${name}`));
client.shoukaku.on("error", (name, error) => console.error(`❌ Lavalink hatası:`, error));

// --- KOMUT İŞLEYİCİ ---
client.on("messageCreate", async (message) => {
  if (!message.guild || message.author.bot || !message.content.startsWith(prefix)) return;

  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const cmd = args.shift().toLowerCase();
  const guildId = message.guild.id;

  /* --- PLAY KOMUTU --- */
  if (cmd === "play") {
    const voiceChannel = message.member.voice.channel;
    if (!voiceChannel) return message.reply("Önce bir ses kanalına girmelisin!");

    const query = args.join(" ");
    if (!query) return message.reply("Şarkı adı veya link girmelisin.");

    let data = queue.get(guildId);

    // Player oluşturma
    if (!data) {
      try {
        const player = await client.shoukaku.joinVoiceChannel({
          guildId: message.guild.id,
          channelId: voiceChannel.id,
          shardId: message.guild.shardId ?? 0,
          deaf: true,
        });

        data = { player, tracks: [] };
        queue.set(guildId, data);

        // Olaylar
        player.on("end", (reason) => {
          if (reason.reason !== "replaced") playNext(guildId);
        });

        player.on("error", (err) => console.error("Player hatası:", err));
        player.on("closed", () => queue.delete(guildId));

      } catch (err) {
        console.error("Bağlantı hatası:", err);
        return message.reply("❌ Ses kanalına bağlanırken bir sorun oluştu.");
      }
    }

    // Arama yap
    const isUrl = /^https?:\/\//.test(query);
    const result = await data.player.node.rest.resolve(isUrl ? query : `ytsearch:${query}`);

    if (!result?.data || (Array.isArray(result.data) && result.data.length === 0)) {
      return message.reply("❌ Hiçbir sonuç bulunamadı.");
    }

    // Gelen veri yapısını düzenleme
    let track;
    if (result.loadType === "track") track = result.data;
    else if (result.loadType === "playlist") track = result.data.tracks[0];
    else track = result.data[0];

    if (!track) return message.reply("❌ Şarkı yüklenemedi.");

    if (!data.player.track) {
      await data.player.playTrack({ track: { encoded: track.encoded } });
      message.reply(`🎵 Şu an çalıyor: **${track.info.title}**`);
    } else {
      data.tracks.push(track);
      message.reply(`➕ Sıraya eklendi: **${track.info.title}**`);
    }
  }

  /* --- SKIP KOMUTU --- */
  if (cmd === "skip") {
    const data = queue.get(guildId);
    if (!data || !data.player) return message.reply("Zaten bir şey çalmıyor.");
    data.player.stopTrack();
    message.reply("⏭️ Şarkı geçildi.");
  }

  /* --- STOP KOMUTU --- */
  if (cmd === "stop") {
    const data = queue.get(guildId);
    if (!data) return;
    data.player.destroy();
    queue.delete(guildId);
    message.reply("⛔ Müzik durduruldu ve odadan çıkıldı.");
  }
});

// KRİTİK: Botun çökmesini engelleyen global hata yakalayıcı
process.on("unhandledRejection", (reason, promise) => {
  console.error("--- Beklenmedik Bir Hata Oluştu ---");
  console.error(reason);
  console.error("---------------------------------");
});

client.login(process.env.TOKEN);
