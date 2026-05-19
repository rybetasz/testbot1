require('dotenv').config({ path: '/home/ubuntu/testbot1/.env' });
const { Client, GatewayIntentBits } = require("discord.js");
const { Shoukaku, Connectors } = require("shoukaku");

/* ---------------- DISCORD CLIENT SETUP ---------------- */

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const prefix = "!";

/* ---------------- LAVALINK NODES & SHOUKAKU ---------------- */

const Nodes = [
  {
    name: "Ana-Sunucu",
    url: "127.0.0.1:2333", // application.yml'deki port ile aynı olmalı
    auth: "youshallnotpass",
    secure: false,
  },
];

const shoukakuOptions = {
  resume: true,
  resumeTimeout: 60,
  reconnectTries: 10,
  restTimeout: 20000, // Lavalink'in arama yapması için yeterli süre
};

client.shoukaku = new Shoukaku(new Connectors.DiscordJS(client), Nodes, shoukakuOptions);

/* ---------------- QUEUE SYSTEM ---------------- */

const queue = new Map();

/**
 * Sıradaki şarkıyı çalmaya yarayan fonksiyon
 */
async function playNext(guildId) {
  const data = queue.get(guildId);
  if (!data || data.tracks.length === 0) return;

  const nextTrack = data.tracks.shift();
  try {
    // Lavalink v4 için kesinleşmiş JSON yapısı
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

/* ---------------- EVENTS ---------------- */

client.once("ready", () => {
  console.log(`✅ Bot Aktif: ${client.user.tag}`);
});

client.shoukaku.on("ready", (name) => console.log(`✅ Lavalink Bağlandı: ${name}`));
client.shoukaku.on("error", (name, error) => console.error(`❌ Lavalink Hatası:`, error));

/* ---------------- COMMANDS ---------------- */

client.on("messageCreate", async (message) => {
  if (!message.guild || message.author.bot || !message.content.startsWith(prefix)) return;

  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const cmd = args.shift().toLowerCase();
  const guildId = message.guild.id;

  /* --- PLAY COMMAND --- */
  if (cmd === "play") {
    const voiceChannel = message.member.voice.channel;
    if (!voiceChannel) return message.reply("Önce bir ses kanalına girmelisin.");

    const query = args.join(" ");
    if (!query) return message.reply("Bir şarkı adı veya link girmelisin.");

    let data = queue.get(guildId);

    // Player yoksa oluştur ve bağlan
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

        player.on("end", (reason) => {
          if (reason.reason !== "replaced") playNext(guildId);
        });

        player.on("error", (err) => console.error("Player Hatası:", err));
        player.on("closed", () => queue.delete(guildId));

      } catch (err) {
        console.error("Bağlantı Hatası:", err);
        return message.reply("❌ Ses kanalına bağlanırken hata oluştu.");
      }
    }

    // --- ARAMA İŞLEMİ (KRİTİK DÜZELTME) ---
    try {
      const isUrl = /^https?:\/\//.test(query);
      // Shoukaku v4 rest.resolve yapısı
      const result = await data.player.node.rest.resolve(isUrl ? query : `ytsearch:${query}`);

      if (!result || !result.data) {
        return message.reply("❌ Arama başarısız oldu veya Lavalink yanıt vermedi.");
      }

      let track;
      // Gelen loadType'a göre track verisini doğru yerden alalım
      if (result.loadType === "track") {
        track = result.data;
      } else if (result.loadType === "playlist") {
        track = result.data.tracks[0];
      } else if (result.loadType === "search") {
        track = result.data[0];
      } else if (result.loadType === "empty") {
        return message.reply("❌ Hiçbir sonuç bulunamadı.");
      }

      if (!track || !track.encoded) {
        return message.reply("❌ Geçerli bir şarkı verisi alınamadı.");
      }

      // Şarkıyı çal veya sıraya ekle
      if (!data.player.track) {
        await data.player.playTrack({ track: { encoded: track.encoded } });
        message.reply(`🎵 Şu an çalıyor: **${track.info.title}**`);
      } else {
        data.tracks.push(track);
        message.reply(`➕ Sıraya eklendi: **${track.info.title}**`);
      }
    } catch (searchErr) {
      console.error("Arama Hatası:", searchErr);
      message.reply("❌ Arama sırasında bir hata oluştu veya bağlantı koptu.");
    }
  }

  /* --- SKIP COMMAND --- */
  if (cmd === "skip") {
    const data = queue.get(guildId);
    if (!data || !data.player) return;
    data.player.stopTrack();
    message.reply("⏭️ Şarkı geçildi.");
  }

  /* --- STOP COMMAND --- */
  if (cmd === "stop") {
    const data = queue.get(guildId);
    if (data) {
      data.player.destroy();
      queue.delete(guildId);
      message.reply("⛔ Durduruldu ve kanaldan çıkıldı.");
    }
  }
});

/* ---------------- GLOBAL ERROR HANDLING ---------------- */

process.on("unhandledRejection", (error) => {
  console.error("--- GLOBAL HATA YAKALANDI ---");
  console.error(error);
  console.error("-----------------------------");
});

client.login(process.env.TOKEN);
