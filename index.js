require("dotenv").config();
const { Client, GatewayIntentBits } = require("discord.js");
const { Shoukaku, Connectors } = require("shoukaku");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const prefix = "!";

/* ---------------- LAVALINK ---------------- */

const nodes = [
  {
    name: "main",
    url: "127.0.0.1:2333",
    auth: "youshallnotpass",
    secure: false,
  },
];

client.shoukaku = new Shoukaku(new Connectors.DiscordJS(client), nodes);

/* ---------------- QUEUE ---------------- */

const queue = new Map();

/* ---------------- READY ---------------- */

client.once("ready", () => {
  console.log(`${client.user.tag} hazır`);
});

/* ---------------- PLAY NEXT ---------------- */

async function playNext(guildId) {
  const data = queue.get(guildId);
  if (!data || !data.tracks.length) return;

  const player = data.player;
  const track = data.tracks[0];

  if (!player || !track) return;

  try {
    // 🔥 FIX: direct track object (NO {track: encoded})
    await player.playTrack(track);
  } catch (e) {
    console.log("PLAY ERROR:", e);
    data.tracks.shift();
    playNext(guildId);
  }
}

/* ---------------- EVENTS ---------------- */

client.shoukaku.on("ready", (name) => {
  console.log("✅ Lavalink bağlı:", name);
});

client.shoukaku.on("error", (name, error) => {
  console.log("❌ Lavalink hata:", error);
});

/* ---------------- COMMANDS ---------------- */

client.on("messageCreate", async (message) => {
  if (!message.guild || message.author.bot) return;
  if (!message.content.startsWith(prefix)) return;

  const args = message.content.slice(1).trim().split(/ +/);
  const cmd = args.shift().toLowerCase();

  const voice = message.member.voice.channel;
  const guildId = message.guild.id;

  const getData = () => {
    if (!queue.has(guildId)) {
      queue.set(guildId, { player: null, tracks: [] });
    }
    return queue.get(guildId);
  };

  /* ---------------- PLAY ---------------- */

  if (cmd === "play") {
    if (!voice) return message.reply("Voice’a gir");
    const query = args.join(" ");
    if (!query) return message.reply("Şarkı yaz");

    const data = getData();

    let player = client.shoukaku.players.get(guildId);

    /* JOIN */
    if (!player) {
      player = await client.shoukaku.joinVoiceChannel({
        guildId,
        channelId: voice.id,
        shardId: 0,
      });

      data.player = player;

      /* TRACK END */
      player.on("trackEnd", () => {
        const d = queue.get(guildId);
        if (!d) return;

        d.tracks.shift();
        playNext(guildId);
      });

      player.on("exception", (e) => {
        console.log("❌ audio error:", e);
      });
    }

    /* SEARCH */
    let result;

    try {
      result = await player.node.rest.resolve(`ytsearch:${query}`);
    } catch (e) {
      console.log(e);
      return message.reply("❌ search hatası");
    }

    if (!result?.tracks?.length) {
      return message.reply("❌ bulunamadı");
    }

    const track = result.tracks[0];

    if (!track?.encoded) {
      return message.reply("❌ track hatası");
    }

    data.tracks.push(track);

    message.reply(`➕ eklendi: **${track.info?.title || "unknown"}**`);

    if (data.tracks.length === 1) {
      playNext(guildId);
    }
  }

  /* ---------------- SKIP ---------------- */

  if (cmd === "skip") {
    const player = client.shoukaku.players.get(guildId);
    if (!player) return;

    player.stopTrack();
    message.reply("⏭ skip");
  }

  /* ---------------- STOP ---------------- */

  if (cmd === "stop") {
    const player = client.shoukaku.players.get(guildId);
    if (!player) return;

    player.destroy();
    queue.delete(guildId);

    message.reply("⛔ stop");
  }

  /* ---------------- QUEUE ---------------- */

  if (cmd === "queue") {
    const data = queue.get(guildId);

    if (!data?.tracks?.length) {
      return message.reply("boş");
    }

    message.reply(
      data.tracks
        .map((t, i) => `${i + 1}. ${t.info?.title || "unknown"}`)
        .join("\n")
    );
  }
});

client.login(process.env.TOKEN);
