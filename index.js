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

// --- LAVALINK YAPILANDIRMASI (Shoukaku v4) ---
const Nodes = [{
  name: "Ana-Sunucu",
  url: "127.0.0.1:2333", 
  auth: "youshallnotpass",
  secure: false,
}];

client.shoukaku = new Shoukaku(new Connectors.DiscordJS(client), Nodes, {
  resume: true,
  resumeTimeout: 30,
  reconnectTries: 5,
});

const queue = new Map();

// --- OYNATMA FONKSİYONU ---
async function playNext(guildId) {
  const data = queue.get(guildId);
  if (!data || data.tracks.length === 0) return;

  const nextTrack = data.tracks.shift();
  try {
    // Lavalink v4 kesin JSON yapısı
    await data.player.playTrack({ track: { encoded: nextTrack.encoded } });
  } catch (err) {
    console.error(`[${guildId}] Oynatma hatası:`, err);
    playNext(guildId);
  }
}

// --- OLAYLAR ---
client.once("ready", () => console.log(`✅ ${client.user.tag} Aktif!`));
client.shoukaku.on("ready", (name) => console.log(`✅ Lavalink Bağlandı: ${name}`));
client.shoukaku.on("error", (name, error) => console.error(`❌ Lavalink Hatası:`, error));

// --- KOMUTLAR ---
client.on("messageCreate", async (message) => {
  if (!message.guild || message.author.bot || !message.content.startsWith(prefix)) return;

  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const cmd = args.shift().toLowerCase();
  const guildId = message.guild.id;

  /* ---------------- PLAY ---------------- */
  if (cmd === "play") {
    const voiceChannel = message.member.voice.channel;
    if (!voiceChannel) return message.reply("Önce bir ses kanalına girmelisin.");

    const query = args.join(" ");
    if (!query) return message.reply("Bir şarkı adı veya link girmelisin.");

    let data = queue.get(guildId);

    // Player yoksa oluştur
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

        player.on("end", (reason) => {
          if (reason.reason !== "replaced") playNext(guildId);
        });

        player.on("error", (err) => console.error("Player Hatası:", err));
      } catch (err) {
        return message.reply("❌ Ses kanalına bağlanılamadı.");
      }
    }

    // ARAMA MANTIĞI (Shoukaku v4 Düzenlemesi)
    const isUrl = /^https?:\/\//.test(query);
    const result = await data.player.node.rest.resolve(isUrl ? query : `ytsearch:${query}`);

    // Gelen veri yapısı kontrolü
    if (!result || !result.data) {
        return message.reply("❌ Arama başarısız oldu.");
    }

    let track;
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

    if (!data.player.track) {
      try {
        await data.player.playTrack({ track: { encoded: track.encoded } });
        message.reply(`🎵 Başlatıldı: **${track.info.title}**`);
      } catch (e) {
        console.error("400/1006 Hatası Önleyici:", e);
      }
    } else {
      data.tracks.push(track);
      message.reply(`➕ Sıraya eklendi: **${track.info.title}**`);
    }
  }

  /* ---------------- SKIP ---------------- */
  if (cmd === "skip") {
    const data = queue.get(guildId);
    if (!data || !data.player) return;
    data.player.stopTrack();
    message.reply("⏭️ Şarkı geçildi.");
  }

  /* ---------------- STOP ---------------- */
  if (cmd === "stop") {
    const data = queue.get(guildId);
    if (data) {
      data.player.destroy();
      queue.delete(guildId);
      message.reply("⛔ Durduruldu.");
    }
  }
});

// Botun çökmesini engelleyen global hata yakalayıcı
process.on("unhandledRejection", (error) => {
  console.error("Global Hata Yakalandı:", error);
});

client.login(process.env.TOKEN);
