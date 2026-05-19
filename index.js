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
    url: "127.0.0.1:2333",
    auth: "youshallnotpass",
    secure: false,
  },
];

client.shoukaku = new Shoukaku(new Connectors.DiscordJS(client), Nodes);

// --- QUEUE (SIRA) SİSTEMİ ---
const queue = new Map();

// --- SIRADAKİ ŞARKIYA GEÇİŞ FONKSİYONU ---
async function playNext(guildId) {
  const data = queue.get(guildId);
  if (!data || data.tracks.length === 0) return;

  const nextTrack = data.tracks.shift();
  try {
    // Lavalink v4'ün beklediği JSON objesi yapısı
    await data.player.playTrack({ 
      track: { 
        encoded: nextTrack.encoded 
      } 
    });
  } catch (err) {
    console.error("Sıradaki şarkı çalınamadı:", err);
    playNext(guildId);
  }
}

// --- BOT OLAYLARI ---
client.once("ready", () => {
  console.log(`✅ Bot Aktif: ${client.user.tag}`);
});

client.shoukaku.on("ready", (name) => console.log(`✅ Lavalink Bağlandı: ${name}`));
client.shoukaku.on("error", (name, error) => console.error(`❌ Lavalink Hatası:`, error));

// --- KOMUTLAR ---
client.on("messageCreate", async (message) => {
  if (!message.guild || message.author.bot || !message.content.startsWith(prefix)) return;

  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const cmd = args.shift().toLowerCase();
  const guildId = message.guild.id;
  const voiceChannel = message.member.voice.channel;

  /* ---------------- PLAY KOMUTU ---------------- */
  if (cmd === "play") {
    if (!voiceChannel) return message.reply("Önce bir ses kanalına katılmalısın.");
    const query = args.join(" ");
    if (!query) return message.reply("Şarkı adı veya link girmelisin.");

    let data = queue.get(guildId);

    // Player yoksa oluştur ve bağlan
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

        // Şarkı bittiğinde sıradakine geç
        player.on("end", (reason) => {
          if (reason.reason === "replaced") return;
          playNext(guildId);
        });

        player.on("error", (err) => console.error("Player Hatası:", err));
      } catch (err) {
        return message.reply("❌ Ses kanalına bağlanılamadı.");
      }
    }

    // ARAMA (URL kontrolü)
    const isUrl = /^https?:\/\//.test(query);
    const searchIdentifier = isUrl ? query : `ytsearch:${query}`;
    
    let result;
    try {
      result = await data.player.node.rest.resolve(searchIdentifier);
    } catch (err) {
      return message.reply("❌ Lavalink arama hatası.");
    }

    if (!result || !result.data || (Array.isArray(result.data) && result.data.length === 0)) {
      return message.reply("❌ Sonuç bulunamadı.");
    }

    // Doğru track objesini seçme
    let track;
    if (result.loadType === "track") track = result.data;
    else if (result.loadType === "playlist") track = result.data.tracks[0];
    else if (result.loadType === "search") track = result.data[0];

    if (!track || !track.encoded) return message.reply("❌ Şarkı verisi alınamadı.");

    // OYNATMA (Loglardaki 400 hatasını çözen yapı)
    if (!data.player.track) {
      try {
        await data.player.playTrack({ 
          track: { 
            encoded: track.encoded 
          } 
        });
        message.reply(`🎵 Başlatıldı: **${track.info.title}**`);
      } catch (e) {
        console.error("400 Bad Request Çözülemedi:", e);
        message.reply("❌ Şarkı oynatılamadı. JSON format hatası oluştu.");
      }
    } else {
      data.tracks.push(track);
      message.reply(`➕ Sıraya eklendi: **${track.info.title}**`);
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
    if (!data) return;
    data.player.destroy();
    queue.delete(guildId);
    message.reply("⛔ Durduruldu ve kanaldan çıkıldı.");
  }
});

// Botun çökmesini önle
process.on("unhandledRejection", (error) => {
  console.error("Yakalanmayan Hata:", error);
});

client.login(process.env.TOKEN);
