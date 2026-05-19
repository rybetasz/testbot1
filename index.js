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

  const track = data.tracks[0];
  const player = data.player;

  await player.playTrack({
    track: track.encoded,
  });
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

  /* ---------------- PLAY ---------------- */
  if (cmd === "play") {
    if (!voice) return message.reply("Voice’a gir");

    const query = args.join(" ");
    if (!query) return message.reply("Şarkı yaz");

    let player = client.shoukaku.players.get(guildId);

    /* JOIN */
    if (!player) {
      player = await client.shoukaku.joinVoiceChannel({
        guildId,
        channelId: voice.id,
        shardId: 0,
      });

      queue.set(guildId, {
        player,
        tracks: [],
      });

      /* TRACK END */
      player.on("end", () => {
        const data = queue.get(guildId);
        if (!data) return;

        data.tracks.shift();
        playNext(guildId);
      });

      player.on("exception", (e) => {
        console.log("❌ Audio error:", e);
      });
    }

    /* SEARCH */
    const result = await player.node.rest.resolve(query);

    if (!result || !result.data.length)
      return message.reply("bulunamadı");

    const track = result.data[0];

    const data = queue.get(guildId);
    data.tracks.push(track);

    message.reply(`➕ eklendi: **${track.info.title}**`);

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
    if (!data || !data.tracks.length)
      return message.reply("boş");

    message.reply(
      data.tracks
        .map((t, i) => `${i + 1}. ${t.info.title}`)
        .join("\n")
    );
  }
});

client.login(process.env.TOKEN);
