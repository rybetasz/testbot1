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

// --- LAVALINK YAPILANDIRMASI (Shoukaku v4 + Lavalink v4) ---
const Nodes = [{
  name: "Ana-Sunucu",
  url: "127.0.0.1:2333", 
  auth: "youshallnotpass",
  secure: false,
}];

// Shoukaku Seçenekleri - Bağlantı stabilitesi için önemli
const shoukakuOptions = {
  resume: true,
  resumeTimeout: 60,
  reconnectTries: 10,
  restTimeout: 20000, // Lavalink'in yanıt vermesi için 20 saniye tanıyalım
};

client.shoukaku = new Shoukaku(new Connectors.DiscordJS(client), Nodes, shoukakuOptions);

const queue = new Map();

// --- OYNATMA FONKSİYONU ---
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
    console.error(`[${guildId}] Oynatma hatası:`, err);
    playNext(guildId);
  }
}

// --- BOT OLAYLARI ---
client.once("ready", () => {
  console.log(`✅ Bot Aktif: ${client.user.tag}`);
});

client.shoukaku.on("ready", (name) => console.log(`✅ Lavalink Bağlantısı Kuruldu: ${name}`));
client.shoukaku.on("error", (name, error) => console.error(`❌ Lavalink Hatası:`, error));

// --- KOMUTLAR ---
client.on("messageCreate", async (message) => {
  if (!message.guild || message.author.bot || !message.content.startsWith(prefix)) return;

  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const cmd = args.shift().toLowerCase();
  const guildId = message.guild.id;

  /* ---------------- PLAY KOMUTU ---------------- */
  if (cmd === "play") {
    const voiceChannel = message.member.voice.channel;
    if (!voiceChannel) return message.reply("Önce bir ses kanalına girmelisin.");

    const query = args.join(" ");
    if (!query) return message.reply("Bir şarkı adı veya link girmelisin.");

    let data = queue.get(guildId);

    // Player yoksa oluştur ve kanala bağlan
    if (!data) {
      try {
        const player = await client.shoukaku.joinVoiceChannel({
          guildId,
          channelId: voiceChannel.id,
          shardId: message.guild.shardId ?? 0,
          deaf: true
        });

        data = { player, tracks: [] };
        queue.set(guildId, data);

        // Şarkı bittiğinde sıradakini çal
        player.on("end", (reason) => {
          if (reason.reason !== "replaced") playNext(guildId);
        });

        player.on("error", (err) => console.error("Player Hatası:", err));
        player.on("closed", () => queue.delete(guildId));

      } catch (err) {
        console.error("Bağlantı Hatası:", err);
        return message.reply("❌ Ses kanalına bağlanırken bir hata oluştu.");
      }
    }

    // ARAMA MANTIĞI (Shoukaku v4 için optimize edildi)
    try {
      const isUrl = /^https?:\/\//.test(query);
      const result = await data.player.node.rest.resolve(isUrl ? query : `ytsearch:${query}`);

      // Gelen veri yapısı kontrolü
      if (!result || !result.data) {
          return message.reply("❌ Arama başarısız oldu veya Lavalink yanıt vermedi.");
      }

      let track;
      // loadType'a göre track verisini ayıklama
      if (result.loadType === "track") {
          track = result.data;
      } else if (result.loadType === "playlist") {
          track = result.data.tracks[0];
      } else if (result.loadType === "search") {
          track = result.data[0];
      } else if (result.loadType === "empty") {
          return message.reply("❌ Hiçbir sonuç bulunamadı.");
      }

      if (!track) return message.reply("❌ Şarkı verisi yüklenemedi.");

      // Şarkıyı başlat veya sıraya ekle
      if (!data.player.track) {
        await data.player.playTrack({ track: { encoded: track.encoded } });
        message.reply(`🎵 Şu an çalıyor: **${track.info.title}**`);
      } else {
        data.tracks.push(track);
        message.reply(`➕ Sıraya eklendi: **${track.info.title}**`);
      }
    } catch (searchErr) {
      console.error("Arama sırasında hata:", searchErr);
      message.reply("❌ Arama işlemi sırasında bir sorun oluştu.");
    }
  }

  /* ---------------- SKIP KOMUTU ---------------- */
  if (cmd === "skip") {
    const data = queue.get(guildId);
    if (!data || !data.player) return message.reply("Çalan bir şey yok.");
    data.player.stopTrack();
    message.reply("⏭️ Şarkı geçildi.");
  }

  /* ---------------- STOP KOMUTU ---------------- */
  if (cmd === "stop") {
    const data = queue.get(guildId);
    if (data) {
      data.player.destroy();
      queue.delete(guildId);
      message.reply("⛔ Durduruldu ve odadan çıkıldı.");
    }
  }
});

// KRİTİK: Botun çökmesini engelleyen global hata yakalayıcı
process.on("unhandledRejection", (error) => {
  console.error("--- GLOBAL HATA YAKALANDI ---");
  console.error(error);
  console.error("-----------------------------");
});

client.login(process.env.TOKEN);
