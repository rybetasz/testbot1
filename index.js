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

/* ---------------- LAVALINK NODE ---------------- */

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

/* ---------------- PLAYER HELPERS ---------------- */

async function playNext(guildId) {
  const data = queue.get(guildId);
  if (!data || !data.tracks.length) return;

  const track = data.tracks[0];

  const player = data.player;

  await player.playTrack({ track: track.encoded });
}

/* ---------------- SHOUKAKU EVENTS ---------------- */

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

  /* PLAY */
  if (cmd === "play") {
    const voice = message.member.voice.channel;
    if (!voice) return message.reply("Voice’a gir");

    const query = args.join(" ");
    if (!query) return message.reply("şarkı yaz");

    let node = client.shoukaku.getIdealNode();

    let player = client.shoukaku.players.get(message.guild.id);

    if (!player) {
      player = await node.joinVoiceChannel({
        guildId: message.guild.id,
        channelId: voice.id,
        shardId: 0,
      });

      queue.set(message.guild.id, {
        player,
        tracks: [],
      });

      player.on("end", () => {
        const data = queue.get(message.guild.id);
        if (!data) return;

        data.tracks.shift();
        playNext(message.guild.id);
      });
    }

    const result = await node.rest.resolve(query);

    if (!result || !result.data.length)
      return message.reply("bulunamadı");

    const track = result.data[0];

    const data = queue.get(message.guild.id);
    data.tracks.push(track);

    message.reply(`➕ eklendi: **${track.info.title}**`);

    if (data.tracks.length === 1) {
      playNext(message.guild.id);
    }
  }

  /* SKIP */
  if (cmd === "skip") {
    const player = client.shoukaku.players.get(message.guild.id);
    if (!player) return;
    player.stopTrack();
    message.reply("⏭ skip");
  }

  /* STOP */
  if (cmd === "stop") {
    const player = client.shoukaku.players.get(message.guild.id);
    if (!player) return;

    player.destroy();
    queue.delete(message.guild.id);

    message.reply("⛔ stop");
  }
});

client.login(process.env.TOKEN);
