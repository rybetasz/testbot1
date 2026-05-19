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

// --- LAVALINK CONFIG ---
const Nodes = [
  {
    name: "Ana-Sunucu",
    url: "127.0.0.1:2333",
    auth: "youshallnotpass", // application.yml dosyasındaki şifreyle aynı olmalı
    secure: false,
  },
];

client.shoukaku = new Shoukaku(new Connectors.DiscordJS(client), Nodes);

// --- QUEUE STORAGE ---
const queue = new Map();

// --- PLAY NEXT FUNCTION ---
async function playNext(guildId) {
  const data = queue.get(guildId);
  if (!data) return;

  if (data.tracks.length === 0) {
    // Liste bittiğinde yapılacaklar (isteğe bağlı: kanaldan çıkış)
    // data.player.destroy();
    // queue.delete(guildId);
    return;
  }

  const nextTrack = data.tracks.shift();
  try {
    // Shoukaku v4: track objesinin kendisini veya encoded halini gönderiyoruz
    await data.player.playTrack({ track: nextTrack.encoded });
  } catch (err) {
    console.error("Çalma hatası:", err);
    playNext(guildId);
  }
}

// --- BOT EVENTS ---
client.once("ready", () => {
  console.log(`✅ Bot giriş yaptı: ${client.user.tag}`);
});

client.shoukaku.on("ready", (name) => console.log(`✅ Lavalink bağlandı: ${name}`));
client.shoukaku.on("error", (name, error) => console.error(`❌ Lavalink hatası (${name}):`, error));

// --- COMMANDS ---
client.on("messageCreate", async (message) => {
  if (!message.guild || message.author.bot || !message.content.startsWith(prefix)) return;

  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const cmd = args.shift().toLowerCase();
  const guildId = message.guild.id;
  const voiceChannel = message.member.voice.channel;

  // --- PLAY COMMAND ---
  if (cmd === "play") {
    if (!voiceChannel) return message.reply("Önce bir ses kanalına gir!");
    
    const query = args.join(" ");
    if (!query) return message.reply("Lütfen şarkı ismi veya link gir.");

    let data = queue.get(guildId);

    // Player yoksa oluştur ve bağlan
    if (!data) {
      try {
        const player = await client.shoukaku.joinVoiceChannel({
          guildId: message.guild.id,
          channelId: voiceChannel.id,
          shardId: message.guild.shardId ?? 0,
          deaf: true
        });

        data = { player, tracks: [] };
        queue.set(guildId, data);

        // Şarkı bittiğinde sıradakine geç
        player.on("end", (reason) => {
          if (reason.reason === "replaced") return;
          playNext(guildId);
        });

        player.on("error", (err) => console.error("Player Hatası:", err));
        
      } catch (err) {
        console.error(err);
        return message.reply("Ses kanalına bağlanırken hata oluştu.");
      }
    }

    // Arama yap (URL mi değil mi kontrol et)
    const isUrl = /^https?:\/\//.test(query);
    const searchIdentifier = isUrl ? query : `ytsearch:${query}`;
    
    let result;
    try {
      result = await data.player.node.rest.resolve(searchIdentifier);
    } catch (err) {
      return message.reply("❌ Arama başarısız oldu.");
    }

    if (!result || !result.data || (Array.isArray(result.data) && result.data.length === 0)) {
      return message.reply("❌ Hiçbir sonuç bulunamadı.");
    }

    // Gelen sonucun tipine göre (Track, Playlist veya Search) şarkıyı seç
    let track;
    if (result.loadType === "track") {
        track = result.data;
    } else if (result.loadType === "playlist") {
        track = result.data.tracks[0];
    } else if (result.loadType === "search") {
        track = result.data[0];
    }

    if (!track) return message.reply("❌ Şarkı yüklenemedi.");

    if (!data.player.track) {
      // Eğer şu an bir şey çalmıyorsa başlat
      await data.player.playTrack({ track: track.encoded });
      message.reply(`🎵 Başlatıldı: **${track.info.title}**`);
    } else {
      // Çalıyorsa sıraya ekle
      data.tracks.push(track);
      message.reply(`➕ Sıraya eklendi: **${track.info.title}**`);
    }
  }

  // --- SKIP COMMAND ---
  if (cmd === "skip") {
    const data = queue.get(guildId);
    if (!data || !data.player) return message.reply("Zaten bir şey çalmıyor.");
    
    data.player.stopTrack();
    message.reply("⏭️ Şarkı geçildi.");
  }

  // --- STOP COMMAND ---
  if (cmd === "stop") {
    const data = queue.get(guildId);
    if (!data) return;

    data.player.destroy();
    queue.delete(guildId);
    message.reply("⛔ Durduruldu ve temizlendi.");
  }

  // --- QUEUE COMMAND ---
  if (cmd === "queue") {
    const data = queue.get(guildId);
    if (!data || (!data.player.track && data.tracks.length === 0)) return message.reply("Sıra boş.");

    const current = data.player.track ? `▶️ Şu an: **${data.player.track.info.title}**\n\n` : "";
    const list = data.tracks.slice(0, 10).map((t, i) => `**${i + 1}.** ${t.info.title}`).join("\n");
    
    message.reply(`${current}**Sıradakiler:**\n${list || "Sırada başka şarkı yok."}`);
  }
});

// Hatalarda botun çökmesini engelle
process.on("unhandledRejection", (error) => {
  console.error("Beklenmedik Hata:", error);
});

client.login(process.env.TOKEN);
